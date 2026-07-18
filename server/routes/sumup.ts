import { Router, Request, Response } from 'express';
import { pool, query } from '../db';
import { adjustGlobalStock } from '../lib/stock';

const router = Router();

interface PendingRow {
  id: string;
  sumup_transaction_id: string;
  session_id: string | null;
  amount: string;
  currency: string;
  sumup_timestamp: string;
  card_type: string | null;
  status: string;
  created_at: string;
}

// GET /pending — list pending SumUp transactions, newest first.
// Optionally scoped to a specific session via ?session_id=.
router.get('/pending', async (req: Request, res: Response) => {
  try {
    const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : null;
    const sql = sessionId
      ? `SELECT * FROM pending_transactions
         WHERE status = 'pending' AND (session_id = $1 OR session_id IS NULL)
         ORDER BY sumup_timestamp DESC`
      : `SELECT * FROM pending_transactions WHERE status = 'pending' ORDER BY sumup_timestamp DESC`;
    const result = sessionId
      ? await query<PendingRow>(sql, [sessionId])
      : await query<PendingRow>(sql);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing pending transactions:', err);
    res.status(500).json({ error: 'Failed to list pending transactions' });
  }
});

// POST /allocate/:id — turn a pending row into one or more sale rows in a
// single grouped transaction. Body: { session_id, items: [{product_id, quantity, price_charged}] }.
router.post('/allocate/:id', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { session_id, items } = req.body as {
      session_id: string;
      items: Array<{ product_id: string; quantity: number; price_charged: number }>;
    };
    if (!session_id || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'session_id and at least one item required' });
      return;
    }

    await client.query('BEGIN');

    const pending = await client.query<PendingRow>(
      `SELECT * FROM pending_transactions WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [id]
    );
    if (pending.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Pending transaction not found or already resolved' });
      return;
    }
    const p = pending.rows[0];

    // Items total must equal the SumUp amount (within £0.01) — guards against
    // typos like £10 charged but £8 of products allocated.
    const itemsTotal = items.reduce(
      (sum, it) => sum + Number(it.quantity) * Number(it.price_charged),
      0
    );
    if (Math.abs(itemsTotal - parseFloat(p.amount)) > 0.01) {
      await client.query('ROLLBACK');
      res.status(400).json({
        error: `Items total £${itemsTotal.toFixed(2)} doesn't match SumUp amount £${parseFloat(p.amount).toFixed(2)}`,
      });
      return;
    }

    const txRes = await client.query<{ uuid: string }>(`SELECT gen_random_uuid()::text AS uuid`);
    const txId = txRes.rows[0].uuid;

    for (const it of items) {
      await client.query(
        `INSERT INTO sales
          (session_id, product_id, quantity, price_charged, payment_method,
           timestamp, transaction_id, sumup_transaction_id)
         VALUES ($1, $2, $3, $4, 'card', $5, $6, $7)`,
        [
          session_id,
          it.product_id,
          it.quantity,
          it.price_charged,
          p.sumup_timestamp,
          txId,
          p.sumup_transaction_id,
        ]
      );
      // Allocating a card payment to products is a sale — draw it from stock.
      await adjustGlobalStock(client, it.product_id, -Number(it.quantity));
    }

    await client.query(
      `UPDATE pending_transactions SET status = 'allocated', resolved_at = NOW() WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');
    res.json({ id, status: 'allocated', transaction_id: txId, items_inserted: items.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error allocating pending transaction:', err);
    res.status(500).json({ error: 'Failed to allocate transaction' });
  } finally {
    client.release();
  }
});

// POST /dismiss/:id — mark a pending row as dismissed (e.g. refunded, wrong
// account, etc.). It will no longer show in the queue.
router.post('/dismiss/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const r = await query(
      `UPDATE pending_transactions SET status = 'dismissed', resolved_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [id]
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: 'Pending transaction not found or already resolved' });
      return;
    }
    res.json({ id, status: 'dismissed' });
  } catch (err) {
    console.error('Error dismissing pending transaction:', err);
    res.status(500).json({ error: 'Failed to dismiss transaction' });
  }
});

export default router;
