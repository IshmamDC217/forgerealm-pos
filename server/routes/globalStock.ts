import { Router, Request, Response } from 'express';
import { query, pool } from '../db';

const router = Router();

// Shape returned for each product on the inventory screen.
const LIST_SQL = `
  SELECT p.id AS product_id,
         p.name AS product_name,
         p.category AS product_category,
         p.default_price,
         COALESCE(gs.quantity, 0) AS quantity,
         COALESCE(dep.deployed, 0) AS deployed
  FROM products p
  LEFT JOIN global_stock gs ON gs.product_id = p.id
  LEFT JOIN (
    SELECT ss.product_id,
           SUM(GREATEST(ss.initial_quantity - COALESCE(sold.total_sold, 0), 0)) AS deployed
    FROM session_stock ss
    JOIN sessions s ON s.id = ss.session_id AND s.status = 'active'
    LEFT JOIN (
      SELECT session_id, product_id, SUM(quantity) AS total_sold
      FROM sales
      GROUP BY session_id, product_id
    ) sold ON sold.session_id = ss.session_id AND sold.product_id = ss.product_id
    GROUP BY ss.product_id
  ) dep ON dep.product_id = p.id
  ORDER BY p.category NULLS LAST, p.name`;

// GET / — every product with its central-store quantity ("quantity") and how
// many units are currently out on active stalls ("deployed").
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query(LIST_SQL);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing global stock:', err);
    res.status(500).json({ error: 'Failed to list global stock' });
  }
});

// PUT / — absolute set of central-store quantities. This is "set current
// stock" and also how you restock/correct later. Does not touch any stall.
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
      await client.query(
        `INSERT INTO global_stock (product_id, quantity)
         VALUES ($1, $2)
         ON CONFLICT (product_id)
         DO UPDATE SET quantity = $2, updated_at = NOW()`,
        [item.product_id, qty]
      );
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

// Fetch a session's stock in the same shape the stock route returns, so the
// client can reuse its StockItem rendering after a transfer.
async function sessionStock(sessionId: string) {
  const result = await query(
    `SELECT ss.id, ss.session_id, ss.product_id, ss.initial_quantity, ss.final_quantity,
            p.name AS product_name, p.category AS product_category, p.default_price,
            COALESCE(sold.total_sold, 0) AS total_sold
     FROM session_stock ss
     JOIN products p ON p.id = ss.product_id
     LEFT JOIN (
       SELECT product_id, SUM(quantity) AS total_sold
       FROM sales
       WHERE session_id = $1
       GROUP BY product_id
     ) sold ON sold.product_id = ss.product_id
     WHERE ss.session_id = $1
     ORDER BY p.category, p.name`,
    [sessionId]
  );
  return result.rows;
}

// POST /transfer — move units from the central store onto a stall. Additive:
// each product's session stock grows by what was moved, and the store shrinks
// by the same amount (never below zero — a request for more than we hold just
// moves what's available). This is how a new stall "pulls from global".
router.post('/transfer', async (req: Request, res: Response) => {
  const { session_id, items } = req.body as {
    session_id: string;
    items: { product_id: string; quantity: number }[];
  };
  if (!session_id || !Array.isArray(items)) {
    res.status(400).json({ error: 'session_id and items are required' });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sessionRes = await client.query('SELECT id FROM sessions WHERE id = $1', [session_id]);
    if (sessionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const moved: { product_id: string; quantity: number }[] = [];
    for (const item of items) {
      const want = Math.max(0, Math.floor(Number(item.quantity) || 0));
      if (want === 0) continue;

      // Lock the store row so two concurrent transfers can't over-draw.
      const stockRes = await client.query(
        'SELECT quantity FROM global_stock WHERE product_id = $1 FOR UPDATE',
        [item.product_id]
      );
      const available = stockRes.rows.length > 0 ? Number(stockRes.rows[0].quantity) : 0;
      const move = Math.min(want, available);
      if (move <= 0) continue;

      await client.query(
        `UPDATE global_stock SET quantity = quantity - $2, updated_at = NOW()
         WHERE product_id = $1`,
        [item.product_id, move]
      );
      await client.query(
        `INSERT INTO session_stock (session_id, product_id, initial_quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id, product_id)
         DO UPDATE SET initial_quantity = session_stock.initial_quantity + $3, updated_at = NOW()`,
        [session_id, item.product_id, move]
      );
      moved.push({ product_id: item.product_id, quantity: move });
    }

    await client.query('COMMIT');

    const [stock, globalResult] = await Promise.all([sessionStock(session_id), query(LIST_SQL)]);
    res.json({ moved, session_stock: stock, global: globalResult.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error transferring stock:', err);
    res.status(500).json({ error: 'Failed to transfer stock' });
  } finally {
    client.release();
  }
});

// POST /return — send a stall's leftover stock back into the central store.
// Remaining = final_quantity when a final count was taken, else initial minus
// what the POS recorded as sold. Guarded by stock_returned_at so it can only
// credit inventory once per stall.
router.post('/return', async (req: Request, res: Response) => {
  const { session_id } = req.body as { session_id: string };
  if (!session_id) {
    res.status(400).json({ error: 'session_id is required' });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sessionRes = await client.query(
      'SELECT id, stock_returned_at FROM sessions WHERE id = $1 FOR UPDATE',
      [session_id]
    );
    if (sessionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (sessionRes.rows[0].stock_returned_at) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Stock has already been returned for this stall' });
      return;
    }

    const remainingRes = await client.query(
      `SELECT ss.product_id,
              CASE
                WHEN ss.final_quantity IS NOT NULL THEN ss.final_quantity
                ELSE GREATEST(ss.initial_quantity - COALESCE(sold.total_sold, 0), 0)
              END AS remaining
       FROM session_stock ss
       LEFT JOIN (
         SELECT product_id, SUM(quantity) AS total_sold
         FROM sales
         WHERE session_id = $1
         GROUP BY product_id
       ) sold ON sold.product_id = ss.product_id
       WHERE ss.session_id = $1`,
      [session_id]
    );

    const returned: { product_id: string; quantity: number }[] = [];
    for (const row of remainingRes.rows) {
      const qty = Math.max(0, Math.floor(Number(row.remaining) || 0));
      if (qty === 0) continue;
      await client.query(
        `INSERT INTO global_stock (product_id, quantity)
         VALUES ($1, $2)
         ON CONFLICT (product_id)
         DO UPDATE SET quantity = global_stock.quantity + $2, updated_at = NOW()`,
        [row.product_id, qty]
      );
      returned.push({ product_id: row.product_id, quantity: qty });
    }

    await client.query('UPDATE sessions SET stock_returned_at = NOW() WHERE id = $1', [session_id]);
    await client.query('COMMIT');

    const globalResult = await query(LIST_SQL);
    res.json({ returned, global: globalResult.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error returning stock:', err);
    res.status(500).json({ error: 'Failed to return stock' });
  } finally {
    client.release();
  }
});

export default router;
