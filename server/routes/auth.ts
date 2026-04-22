import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  try {
    const result = await query(
      'SELECT id, username, password_hash FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', async (req: Request, res: Response) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { userId: string };
    const result = await query('SELECT id, username FROM users WHERE id = $1', [payload.userId]);
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    res.json({ username: result.rows[0].username });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
