import 'dotenv/config';
import { pool } from './index';

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        location VARCHAR(255),
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        notes TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        default_price DECIMAL(10, 2) NOT NULL,
        image_url TEXT,
        category VARCHAR(100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
        price_charged DECIMAL(10, 2) NOT NULL CHECK (price_charged >= 0),
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Add payment_method column if it doesn't exist
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE sales ADD COLUMN payment_method VARCHAR(10) NOT NULL DEFAULT 'cash';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$
    `);

    // Add card fee tracking columns to sessions
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE sessions ADD COLUMN card_fee_applied BOOLEAN NOT NULL DEFAULT false;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE sessions ADD COLUMN card_fee_rate DECIMAL(5, 2) NOT NULL DEFAULT 1.69;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sales_session_id ON sales(session_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sales_product_id ON sales(product_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)
    `);

    await client.query('COMMIT');
    console.log('Migration completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
