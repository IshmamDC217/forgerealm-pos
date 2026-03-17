const express = require('express');
const router = express.Router();
const db = require('../db');

// GET / — list all sessions (newest first)
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.*,
        COALESCE(SUM(sa.quantity * sa.price_charged), 0) AS total_revenue,
        COALESCE(SUM(sa.quantity), 0) AS total_units
       FROM sessions s
       LEFT JOIN sales sa ON sa.session_id = s.id
       GROUP BY s.id
       ORDER BY s.date DESC, s.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing sessions:', err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// POST / — create session
router.post('/', async (req, res) => {
  try {
    const { name, location, date, notes } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Session name is required' });
    }
    const result = await db.query(
      `INSERT INTO sessions (name, location, date, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, location || null, date || new Date(), notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating session:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// GET /:id — get session with sales summary stats
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const sessionResult = await db.query(
      'SELECT * FROM sessions WHERE id = $1',
      [id]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const statsResult = await db.query(
      `SELECT
        COALESCE(SUM(sa.quantity * sa.price_charged), 0) AS total_revenue,
        COALESCE(SUM(sa.quantity), 0) AS total_units,
        COUNT(sa.id) AS total_sales
       FROM sales sa
       WHERE sa.session_id = $1`,
      [id]
    );

    const bestSellerResult = await db.query(
      `SELECT p.name, SUM(sa.quantity) AS units_sold
       FROM sales sa
       JOIN products p ON p.id = sa.product_id
       WHERE sa.session_id = $1
       GROUP BY p.name
       ORDER BY units_sold DESC
       LIMIT 1`,
      [id]
    );

    const session = sessionResult.rows[0];
    const stats = statsResult.rows[0];
    session.stats = {
      total_revenue: parseFloat(stats.total_revenue),
      total_units: parseInt(stats.total_units),
      total_sales: parseInt(stats.total_sales),
      best_seller: bestSellerResult.rows[0]?.name || null,
    };

    res.json(session);
  } catch (err) {
    console.error('Error fetching session:', err);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// PATCH /:id — update session
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, location, notes, status } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (location !== undefined) { fields.push(`location = $${idx++}`); values.push(location); }
    if (notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(notes); }
    if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await db.query(
      `UPDATE sessions SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating session:', err);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

// DELETE /:id — delete session and its sales
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      'DELETE FROM sessions WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({ message: 'Session deleted', id });
  } catch (err) {
    console.error('Error deleting session:', err);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

module.exports = router;
