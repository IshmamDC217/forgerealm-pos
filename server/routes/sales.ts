import { Router, Request, Response } from 'express';
import { pool, query } from '../db';

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

// POST / — record a sale
router.post('/', async (req: Request, res: Response) => {
  try {
    const { session_id, product_id, quantity, price_charged, payment_method, transaction_id } = req.body;
    if (!session_id || !product_id || !quantity || price_charged === undefined) {
      res.status(400).json({ error: 'session_id, product_id, quantity, and price_charged are required' });
      return;
    }
    const method = payment_method === 'card' ? 'card' : 'cash';
    const result = await query(
      `INSERT INTO sales (session_id, product_id, quantity, price_charged, payment_method, transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [session_id, product_id, quantity, price_charged, method, transaction_id || null]
    );

    // Return with product info
    const sale = await query(
      `SELECT sa.*, p.name AS product_name, p.category AS product_category
       FROM sales sa
       JOIN products p ON p.id = sa.product_id
       WHERE sa.id = $1`,
      [result.rows[0].id]
    );
    const created = sale.rows[0];
    res.status(201).json(created);
  } catch (err) {
    console.error('Error recording sale:', err);
    res.status(500).json({ error: 'Failed to record sale' });
  }
});

// PATCH /:id — edit an existing sale (quantity and/or price)
router.patch('/:id', async (req: Request, res: Response) => {
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

    const result = await query(
      `UPDATE sales SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }

    // Return with product info
    const sale = await query(
      `SELECT sa.*, p.name AS product_name, p.category AS product_category
       FROM sales sa
       JOIN products p ON p.id = sa.product_id
       WHERE sa.id = $1`,
      [id]
    );
    const updated = sale.rows[0];
    res.json(updated);
  } catch (err) {
    console.error('Error updating sale:', err);
    res.status(500).json({ error: 'Failed to update sale' });
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
      sumup_transaction_id: string | null;
    }>(
      `DELETE FROM sales WHERE id = $1
       RETURNING id, session_id, sumup_transaction_id`,
      [id]
    );
    if (deleted.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Sale not found' });
      return;
    }
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
