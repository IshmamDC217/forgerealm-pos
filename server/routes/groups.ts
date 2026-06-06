import { Router, Request, Response } from 'express';
import { query, pool } from '../db';

const router = Router();

// POST / — create a session group from existing sessions.
// Body: { name, session_ids: string[], date?, notes? }
// Date defaults to the latest member session's date.
router.post('/', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { name, session_ids, date, notes } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Group name is required' });
      return;
    }
    if (!Array.isArray(session_ids) || session_ids.length < 2) {
      res.status(400).json({ error: 'At least two sessions are required to form a group' });
      return;
    }

    await client.query('BEGIN');

    const sessionsResult = await client.query(
      'SELECT id, date FROM sessions WHERE id = ANY($1::uuid[])',
      [session_ids]
    );
    if (sessionsResult.rows.length !== session_ids.length) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'One or more sessions not found' });
      return;
    }

    // pg returns DATE columns as JS Dates — compare by time, not default
    // (lexicographic) sort. Default the group date to the latest member's.
    const groupDate =
      date ||
      sessionsResult.rows.reduce<Date | null>((max, r) => {
        const d = new Date(r.date);
        return !max || d > max ? d : max;
      }, null);

    const groupResult = await client.query(
      `INSERT INTO session_groups (name, date, notes)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name.trim(), groupDate, notes || null]
    );
    const group = groupResult.rows[0];

    await client.query(
      'UPDATE sessions SET group_id = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])',
      [group.id, session_ids]
    );

    await client.query('COMMIT');
    res.status(201).json({ ...group, session_ids });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating group:', err);
    res.status(500).json({ error: 'Failed to create group' });
  } finally {
    client.release();
  }
});

// PATCH /:id — update group details
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, date, notes } = req.body;

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (date !== undefined) { fields.push(`date = $${idx++}`); values.push(date); }
    if (notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(notes); }

    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await query(
      `UPDATE session_groups SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating group:', err);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// DELETE /:id — dissolve a group. The FK is ON DELETE SET NULL, so member
// sessions are simply ungrouped; no session or sales data is touched.
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query(
      'DELETE FROM session_groups WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    res.json({ message: 'Group dissolved', id });
  } catch (err) {
    console.error('Error deleting group:', err);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

export default router;
