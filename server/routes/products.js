const express = require('express');
const router = express.Router();
const db = require('../db');

// GET / — list all products
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM products ORDER BY category, name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing products:', err);
    res.status(500).json({ error: 'Failed to list products' });
  }
});

// POST / — create product
router.post('/', async (req, res) => {
  try {
    const { name, default_price, image_url, category } = req.body;
    if (!name || default_price === undefined) {
      return res.status(400).json({ error: 'Name and default_price are required' });
    }
    const result = await db.query(
      `INSERT INTO products (name, default_price, image_url, category)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, default_price, image_url || null, category || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PATCH /:id — update product
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, default_price, image_url, category } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (default_price !== undefined) { fields.push(`default_price = $${idx++}`); values.push(default_price); }
    if (image_url !== undefined) { fields.push(`image_url = $${idx++}`); values.push(image_url); }
    if (category !== undefined) { fields.push(`category = $${idx++}`); values.push(category); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await db.query(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE /:id — delete product
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      'DELETE FROM products WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ message: 'Product deleted', id });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

module.exports = router;
