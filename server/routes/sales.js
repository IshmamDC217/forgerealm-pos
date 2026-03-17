const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /session/:sessionId — list sales for a session
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await db.query(
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
router.post('/', async (req, res) => {
  try {
    const { session_id, product_id, quantity, price_charged } = req.body;
    if (!session_id || !product_id || !quantity || price_charged === undefined) {
      return res.status(400).json({ error: 'session_id, product_id, quantity, and price_charged are required' });
    }
    const result = await db.query(
      `INSERT INTO sales (session_id, product_id, quantity, price_charged)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [session_id, product_id, quantity, price_charged]
    );

    // Return with product info
    const sale = await db.query(
      `SELECT sa.*, p.name AS product_name, p.category AS product_category
       FROM sales sa
       JOIN products p ON p.id = sa.product_id
       WHERE sa.id = $1`,
      [result.rows[0].id]
    );
    res.status(201).json(sale.rows[0]);
  } catch (err) {
    console.error('Error recording sale:', err);
    res.status(500).json({ error: 'Failed to record sale' });
  }
});

// DELETE /:id — undo/delete a sale
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      'DELETE FROM sales WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sale not found' });
    }
    res.json({ message: 'Sale deleted', id });
  } catch (err) {
    console.error('Error deleting sale:', err);
    res.status(500).json({ error: 'Failed to delete sale' });
  }
});

module.exports = router;
