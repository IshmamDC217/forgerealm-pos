import 'dotenv/config';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';

import { requireAuth } from './middleware/auth';
import authRouter from './routes/auth';
import sessionsRouter from './routes/sessions';
import productsRouter from './routes/products';
import salesRouter from './routes/sales';
import exportRouter from './routes/export';
import stockRouter from './routes/stock';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'forgerealm-pos' });
});

// Public auth routes (no token needed)
app.use('/api/auth', authRouter);

// Protected routes (token required)
app.use('/api/sessions', requireAuth, sessionsRouter);
app.use('/api/products', requireAuth, productsRouter);
app.use('/api/sales', requireAuth, salesRouter);
app.use('/api/export', requireAuth, exportRouter);
app.use('/api/stock', requireAuth, stockRouter);

// Serve client build in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`ForgeRealm POS server running on port ${PORT}`);
});
