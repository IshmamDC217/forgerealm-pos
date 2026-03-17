require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const sessionsRouter = require('./routes/sessions');
const productsRouter = require('./routes/products');
const salesRouter = require('./routes/sales');
const exportRouter = require('./routes/export');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'forgerealm-pos' });
});

app.use('/api/sessions', sessionsRouter);
app.use('/api/products', productsRouter);
app.use('/api/sales', salesRouter);
app.use('/api/export', exportRouter);

// Serve client build in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`ForgeRealm POS server running on port ${PORT}`);
});
