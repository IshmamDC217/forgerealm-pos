import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';

import { requireAuth } from './middleware/auth';
import authRouter from './routes/auth';
import sessionsRouter from './routes/sessions';
import productsRouter from './routes/products';
import salesRouter from './routes/sales';
import exportRouter from './routes/export';
import stockRouter from './routes/stock';

function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGIN);

export const app = express();

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  })
);
app.use(express.json());

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'forgerealm-pos' });
});

app.use('/api/auth', authRouter);
app.use('/api/sessions', requireAuth, sessionsRouter);
app.use('/api/products', requireAuth, productsRouter);
app.use('/api/sales', requireAuth, salesRouter);
app.use('/api/export', requireAuth, exportRouter);
app.use('/api/stock', requireAuth, stockRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});
