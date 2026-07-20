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

    // Group multiple sales recorded in the same cart checkout. NULL for legacy
    // single-item sales recorded before grouping existed.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE sales ADD COLUMN transaction_id UUID;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_sales_transaction_id ON sales(transaction_id)`
    );

    // Link a sale back to the underlying SumUp card transaction (when known).
    // Allows reconciliation and prevents double-allocation of the same tx.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE sales ADD COLUMN sumup_transaction_id VARCHAR(100);
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_sales_sumup_tx ON sales(sumup_transaction_id)`
    );

    // Allow negative sale quantities so returns/refunds/corrections can be
    // recorded at checkout. The original constraint only permitted quantity > 0;
    // replace it with "not zero" (a zero-quantity line carries no meaning).
    await client.query(`ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_quantity_check`);
    await client.query(`ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_quantity_nonzero`);
    await client.query(`ALTER TABLE sales ADD CONSTRAINT sales_quantity_nonzero CHECK (quantity <> 0)`);

    // Queue of SumUp card transactions we've seen but not yet allocated to
    // products. The poller inserts here; the UI prompts the user to allocate
    // each one, then moves them to the sales table.
    await client.query(`
      CREATE TABLE IF NOT EXISTS pending_transactions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        sumup_transaction_id VARCHAR(100) UNIQUE NOT NULL,
        session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
        amount DECIMAL(10, 2) NOT NULL,
        currency VARCHAR(8) NOT NULL DEFAULT 'GBP',
        sumup_timestamp TIMESTAMPTZ NOT NULL,
        card_type VARCHAR(40),
        status VARCHAR(20) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'allocated', 'dismissed')),
        raw JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_pending_tx_status ON pending_transactions(status)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_pending_tx_session ON pending_transactions(session_id)`
    );

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

    // Fixed cost paid to the organiser for the pitch; nullable because older
    // rows predate the field.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE sessions ADD COLUMN stall_fee DECIMAL(10, 2);
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$
    `);

    // Event-day grouping: several stalls run on the same day at different
    // locations roll up into one session_group ("Session 10"). Stalls keep
    // their own rows and stats; the group is purely an umbrella.
    await client.query(`
      CREATE TABLE IF NOT EXISTS session_groups (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Deleting a group just ungroups its stalls (SET NULL), never deletes data.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE sessions ADD COLUMN group_id UUID REFERENCES session_groups(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_sessions_group_id ON sessions(group_id)`
    );

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

    // Session stock tracking — initial inventory per session
    await client.query(`
      CREATE TABLE IF NOT EXISTS session_stock (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        initial_quantity INTEGER NOT NULL CHECK (initial_quantity >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(session_id, product_id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_session_stock_session_id ON session_stock(session_id)
    `);

    // Add final_quantity column for end-of-day stock count
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE session_stock ADD COLUMN final_quantity INTEGER DEFAULT NULL;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$
    `);

    // Global (central) inventory — the single "current stock" we hold in the
    // store, independent of any one stall. Creating/stocking a stall draws
    // units out of here (transfer); leftovers can be returned back in. One row
    // per product; products with no row are treated as quantity 0. Existing
    // per-session stock rows are never touched by this — old stalls keep their
    // own numbers.
    await client.query(`
      CREATE TABLE IF NOT EXISTS global_stock (
        product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Marks that a stall's leftover stock has already been returned to the
    // global pool, so returning twice can't double-credit inventory.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE sessions ADD COLUMN stock_returned_at TIMESTAMPTZ;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$
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
