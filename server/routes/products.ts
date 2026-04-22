import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

// GET / — list all products
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM products ORDER BY category, name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing products:', err);
    res.status(500).json({ error: 'Failed to list products' });
  }
});

// POST / — create product
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, default_price, image_url, category } = req.body;
    if (!name || default_price === undefined) {
      res.status(400).json({ error: 'Name and default_price are required' });
      return;
    }
    const result = await query(
      `INSERT INTO products (name, default_price, image_url, category)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, default_price, image_url || null, category || null]
    );
    const created = result.rows[0];
    res.status(201).json(created);
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PATCH /:id — update product
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, default_price, image_url, category } = req.body;

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (default_price !== undefined) { fields.push(`default_price = $${idx++}`); values.push(default_price); }
    if (image_url !== undefined) { fields.push(`image_url = $${idx++}`); values.push(image_url); }
    if (category !== undefined) { fields.push(`category = $${idx++}`); values.push(category); }

    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await query(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    const updated = result.rows[0];
    res.json(updated);
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE /:id — delete product
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query(
      'DELETE FROM products WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json({ message: 'Product deleted', id });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

export default router;
