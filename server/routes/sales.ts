import { Router, Request, Response } from 'express';
import { query } from '../db';
import { getIO } from '../socket';

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
    const { session_id, product_id, quantity, price_charged, payment_method } = req.body;
    if (!session_id || !product_id || !quantity || price_charged === undefined) {
      res.status(400).json({ error: 'session_id, product_id, quantity, and price_charged are required' });
      return;
    }
    const method = payment_method === 'card' ? 'card' : 'cash';
    const result = await query(
      `INSERT INTO sales (session_id, product_id, quantity, price_charged, payment_method)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [session_id, product_id, quantity, price_charged, method]
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
    getIO().to(`session:${session_id}`).emit('sale:created', created);
  } catch (err) {
    console.error('Error recording sale:', err);
    res.status(500).json({ error: 'Failed to record sale' });
  }
});

// PATCH /:id — edit an existing sale (quantity and/or price)
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { quantity, price_charged, payment_method } = req.body;

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (quantity !== undefined) { fields.push(`quantity = $${idx++}`); values.push(quantity); }
    if (price_charged !== undefined) { fields.push(`price_charged = $${idx++}`); values.push(price_charged); }
    if (payment_method !== undefined) { fields.push(`payment_method = $${idx++}`); values.push(payment_method === 'card' ? 'card' : 'cash'); }

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
    getIO().to(`session:${updated.session_id}`).emit('sale:updated', updated);
  } catch (err) {
    console.error('Error updating sale:', err);
    res.status(500).json({ error: 'Failed to update sale' });
  }
});

// DELETE /:id — undo/delete a sale
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query(
      'DELETE FROM sales WHERE id = $1 RETURNING id, session_id, product_id, quantity, price_charged',
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }
    const deleted = result.rows[0];
    res.json({ message: 'Sale deleted', id });
    getIO().to(`session:${deleted.session_id}`).emit('sale:deleted', deleted);
  } catch (err) {
    console.error('Error deleting sale:', err);
    res.status(500).json({ error: 'Failed to delete sale' });
  }
});

export default router;
