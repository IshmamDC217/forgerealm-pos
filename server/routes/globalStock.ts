import { Router, Request, Response } from 'express';
import { query, pool } from '../db';

const router = Router();

// Every product with its shared central-store quantity. Stock is global: this
// one number is what's left, and it drops as any stall records a sale.
const LIST_SQL = `
  SELECT p.id AS product_id,
         p.name AS product_name,
         p.category AS product_category,
         p.default_price,
         COALESCE(gs.quantity, 0) AS quantity,
         (gs.product_id IS NOT NULL) AS tracked
  FROM products p
  LEFT JOIN global_stock gs ON gs.product_id = p.id
  ORDER BY p.category NULLS LAST, p.name`;

// GET / — list every product with its current shared stock level.
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query(LIST_SQL);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing global stock:', err);
    res.status(500).json({ error: 'Failed to list global stock' });
  }
});

// PUT / — absolute set of the shared stock levels. This is "set current stock"
// and also how you restock or correct a count later.
router.put('/', async (req: Request, res: Response) => {
  const { items } = req.body as { items: { product_id: string; quantity: number }[] };
  if (!Array.isArray(items)) {
    res.status(400).json({ error: 'items array is required' });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      const qty = Math.max(0, Math.floor(Number(item.quantity) || 0));
      if (qty > 0) {
        await client.query(
          `INSERT INTO global_stock (product_id, quantity)
           VALUES ($1, $2)
           ON CONFLICT (product_id)
           DO UPDATE SET quantity = $2, updated_at = NOW()`,
          [item.product_id, qty]
        );
      } else {
        // Setting a product to 0 in the manager means "don't track this" —
        // drop the row so it sells without a cap. (A tracked item selling
        // down to 0 keeps its row via the sales path and shows "Sold out".)
        await client.query('DELETE FROM global_stock WHERE product_id = $1', [item.product_id]);
      }
    }
    await client.query('COMMIT');
    const result = await query(LIST_SQL);
    res.json(result.rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error setting global stock:', err);
    res.status(500).json({ error: 'Failed to set global stock' });
  } finally {
    client.release();
  }
});

export default router;
