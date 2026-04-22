import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

// GET /session/:sessionId — get stock for a session with sold/remaining calculated
router.get('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
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
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing stock:', err);
    res.status(500).json({ error: 'Failed to list stock' });
  }
});

// GET /carryover/:sessionId — get remaining stock from the most recent prior session
// Returns one entry per product that had stock in the previous session, with its remaining qty.
router.get('/carryover/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    // Find the current session's date so we look strictly *before* it
    const currentResult = await query(
      'SELECT date, created_at FROM sessions WHERE id = $1',
      [sessionId]
    );
    if (currentResult.rows.length === 0) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const current = currentResult.rows[0];

    // Find the most recent prior session that has stock entries
    const priorResult = await query(
      `SELECT s.id, s.name, s.date
       FROM sessions s
       WHERE s.id != $1
         AND EXISTS (SELECT 1 FROM session_stock ss WHERE ss.session_id = s.id)
         AND (s.date < $2 OR (s.date = $2 AND s.created_at < $3))
       ORDER BY s.date DESC, s.created_at DESC
       LIMIT 1`,
      [sessionId, current.date, current.created_at]
    );

    if (priorResult.rows.length === 0) {
      res.json({ previous_session: null, items: [] });
      return;
    }

    const prior = priorResult.rows[0];

    // For each stock item in the prior session, compute remaining
    // remaining = final_quantity if set, else initial - total_sold
    const items = await query(
      `SELECT ss.product_id,
              p.name AS product_name,
              p.category AS product_category,
              ss.initial_quantity,
              ss.final_quantity,
              COALESCE(sold.total_sold, 0) AS total_sold,
              CASE
                WHEN ss.final_quantity IS NOT NULL THEN ss.final_quantity
                ELSE GREATEST(ss.initial_quantity - COALESCE(sold.total_sold, 0), 0)
              END AS remaining
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
      [prior.id]
    );

    res.json({
      previous_session: { id: prior.id, name: prior.name, date: prior.date },
      items: items.rows,
    });
  } catch (err) {
    console.error('Error fetching carryover:', err);
    res.status(500).json({ error: 'Failed to fetch carryover stock' });
  }
});

// PUT /session/:sessionId — bulk set stock for a session (upsert)
router.put('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { items } = req.body as { items: { product_id: string; initial_quantity: number }[] };

    if (!Array.isArray(items)) {
      res.status(400).json({ error: 'items array is required' });
      return;
    }

    // Remove existing stock entries for products not in the new list
    const productIds = items.filter(i => i.initial_quantity > 0).map(i => i.product_id);

    if (productIds.length === 0) {
      // Clear all stock for this session
      await query('DELETE FROM session_stock WHERE session_id = $1', [sessionId]);
      res.json([]);
      return;
    }

    // Delete entries not in the new set
    await query(
      `DELETE FROM session_stock
       WHERE session_id = $1 AND product_id != ALL($2::uuid[])`,
      [sessionId, productIds]
    );

    // Upsert each item
    for (const item of items) {
      if (item.initial_quantity > 0) {
        await query(
          `INSERT INTO session_stock (session_id, product_id, initial_quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT (session_id, product_id)
           DO UPDATE SET initial_quantity = $3, updated_at = NOW()`,
          [sessionId, item.product_id, item.initial_quantity]
        );
      }
    }

    // Return updated stock with sold info
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
    res.json(result.rows);
  } catch (err) {
    console.error('Error setting stock:', err);
    res.status(500).json({ error: 'Failed to set stock' });
  }
});

// PUT /session/:sessionId/final — save end-of-day remaining stock counts
router.put('/session/:sessionId/final', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { items } = req.body as { items: { product_id: string; final_quantity: number }[] };

    if (!Array.isArray(items)) {
      res.status(400).json({ error: 'items array is required' });
      return;
    }

    for (const item of items) {
      await query(
        `UPDATE session_stock
         SET final_quantity = $1, updated_at = NOW()
         WHERE session_id = $2 AND product_id = $3`,
        [item.final_quantity, sessionId, item.product_id]
      );
    }

    // Return updated stock
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
    res.json(result.rows);
  } catch (err) {
    console.error('Error saving final stock:', err);
    res.status(500).json({ error: 'Failed to save final stock counts' });
  }
});

// GET /session/:sessionId/summary — stock vs sales comparison
router.get('/session/:sessionId/summary', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const result = await query(
      `SELECT ss.product_id, ss.initial_quantity, ss.final_quantity,
              p.name AS product_name, p.category AS product_category, p.default_price,
              COALESCE(sold.total_sold, 0) AS total_sold,
              COALESCE(sold.total_revenue, 0) AS total_revenue
       FROM session_stock ss
       JOIN products p ON p.id = ss.product_id
       LEFT JOIN (
         SELECT product_id,
                SUM(quantity) AS total_sold,
                SUM(quantity * price_charged) AS total_revenue
         FROM sales
         WHERE session_id = $1
         GROUP BY product_id
       ) sold ON sold.product_id = ss.product_id
       WHERE ss.session_id = $1
       ORDER BY p.category, p.name`,
      [sessionId]
    );

    const rows = result.rows.map((r: any) => {
      const initial = parseInt(r.initial_quantity);
      const finalQty = r.final_quantity !== null ? parseInt(r.final_quantity) : null;
      const posSold = parseInt(r.total_sold);
      // If final count was entered, sold = initial - final. Otherwise use POS sales.
      const sold = finalQty !== null ? initial - finalQty : posSold;
      const remaining = finalQty !== null ? finalQty : initial - posSold;
      return {
        ...r,
        sold_by_count: finalQty !== null ? initial - finalQty : null,
        sold_by_pos: posSold,
        sold,
        remaining,
      };
    });

    const hasFinalCounts = rows.some((r: any) => r.final_quantity !== null);

    const totals = {
      initial: rows.reduce((sum: number, r: any) => sum + parseInt(r.initial_quantity), 0),
      sold: rows.reduce((sum: number, r: any) => sum + r.sold, 0),
      remaining: rows.reduce((sum: number, r: any) => sum + r.remaining, 0),
      revenue: rows.reduce((sum: number, r: any) => sum + parseFloat(r.total_revenue), 0),
      has_final_counts: hasFinalCounts,
    };

    res.json({ items: rows, totals });
  } catch (err) {
    console.error('Error fetching stock summary:', err);
    res.status(500).json({ error: 'Failed to fetch stock summary' });
  }
});

export default router;
