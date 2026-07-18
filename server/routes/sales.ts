import { Router, Request, Response } from 'express';
import { pool, query } from '../db';
import { adjustGlobalStock } from '../lib/stock';

const router = Router();

// GET /session/:sessionId — list sales for a session
router.get('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const result = await query(
      `SELECT sa.*, p.name AS product_name, p.category AS product_category
       FROM sales sa
       JOIN products p ON p.id = sa.product_id
       WHERE sa.session_id = $1
       ORDER BY sa.timestamp DESC`,
      [sessionId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing sales:', err);
    res.status(500).json({ error: 'Failed to list sales' });
  }
});

// POST / — record a sale. Stock is global, so recording a sale draws the sold
// quantity out of the shared central store (every stall sees it drop).
router.post('/', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { session_id, product_id, quantity, price_charged, payment_method, transaction_id } = req.body;
    if (!session_id || !product_id || !quantity || price_charged === undefined) {
      res.status(400).json({ error: 'session_id, product_id, quantity, and price_charged are required' });
      return;
    }
    const method = payment_method === 'card' ? 'card' : 'cash';

    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO sales (session_id, product_id, quantity, price_charged, payment_method, transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [session_id, product_id, quantity, price_charged, method, transaction_id || null]
    );
    await adjustGlobalStock(client, product_id, -Number(quantity));

    // Return with product info
    const sale = await client.query(
      `SELECT sa.*, p.name AS product_name, p.category AS product_category
       FROM sales sa
       JOIN products p ON p.id = sa.product_id
       WHERE sa.id = $1`,
      [result.rows[0].id]
    );
    await client.query('COMMIT');
    res.status(201).json(sale.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error recording sale:', err);
    res.status(500).json({ error: 'Failed to record sale' });
  } finally {
    client.release();
  }
});

// PATCH /:id — edit an existing sale (quantity, price, product, etc). When the
// quantity or product changes, the global store is corrected: the old
// quantity is returned to the old product and the new quantity drawn from the
// new product, so shared stock stays accurate through edits.
router.patch('/:id', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { quantity, price_charged, payment_method, product_id, timestamp } = req.body;

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (quantity !== undefined) { fields.push(`quantity = $${idx++}`); values.push(quantity); }
    if (price_charged !== undefined) { fields.push(`price_charged = $${idx++}`); values.push(price_charged); }
    if (payment_method !== undefined) { fields.push(`payment_method = $${idx++}`); values.push(payment_method === 'card' ? 'card' : 'cash'); }
    if (product_id !== undefined) { fields.push(`product_id = $${idx++}`); values.push(product_id); }
    if (timestamp !== undefined) { fields.push(`timestamp = $${idx++}`); values.push(timestamp); }

    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    values.push(id);

    await client.query('BEGIN');

    // Snapshot the sale before the change so we can reverse its stock effect.
    const before = await client.query<{ product_id: string; quantity: number }>(
      `SELECT product_id, quantity FROM sales WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (before.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Sale not found' });
      return;
    }

    const result = await client.query(
      `UPDATE sales SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    // Only touch stock if the sold product or quantity actually changed.
    if (quantity !== undefined || product_id !== undefined) {
      const oldProduct = before.rows[0].product_id;
      const oldQty = Number(before.rows[0].quantity);
      const newProduct = product_id !== undefined ? product_id : oldProduct;
      const newQty = quantity !== undefined ? Number(quantity) : oldQty;
      await adjustGlobalStock(client, oldProduct, oldQty);   // give the old units back
      await adjustGlobalStock(client, newProduct, -newQty);  // take the new units out
    }

    // Return with product info
    const sale = await client.query(
      `SELECT sa.*, p.name AS product_name, p.category AS product_category
       FROM sales sa
       JOIN products p ON p.id = sa.product_id
       WHERE sa.id = $1`,
      [id]
    );
    await client.query('COMMIT');
    res.json(sale.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating sale:', err);
    res.status(500).json({ error: 'Failed to update sale' });
  } finally {
    client.release();
  }
});

// DELETE /:id — undo/delete a sale. If the sale was a SumUp allocation, also
// check whether any siblings still exist for the same sumup_transaction_id;
// if none remain, revert the corresponding pending_transactions row to
// 'pending' so the user can re-allocate it without it getting stranded.
router.delete('/:id', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');

    const deleted = await client.query<{
      id: string;
      session_id: string;
      product_id: string;
      quantity: number;
      sumup_transaction_id: string | null;
    }>(
      `DELETE FROM sales WHERE id = $1
       RETURNING id, session_id, product_id, quantity, sumup_transaction_id`,
      [id]
    );
    if (deleted.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Sale not found' });
      return;
    }
    // Undoing a sale puts its units back into the shared store.
    await adjustGlobalStock(client, deleted.rows[0].product_id, Number(deleted.rows[0].quantity));
    const sumupTxId = deleted.rows[0].sumup_transaction_id;

    if (sumupTxId) {
      const remaining = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM sales WHERE sumup_transaction_id = $1`,
        [sumupTxId]
      );
      if (parseInt(remaining.rows[0].c, 10) === 0) {
        await client.query(
          `UPDATE pending_transactions
             SET status = 'pending', resolved_at = NULL
           WHERE sumup_transaction_id = $1 AND status = 'allocated'`,
          [sumupTxId]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'Sale deleted', id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error deleting sale:', err);
    res.status(500).json({ error: 'Failed to delete sale' });
  } finally {
    client.release();
  }
});

export default router;
