import 'dotenv/config';
import { pool } from './index';

// Backfill the three Albion Place stalls we ran before the POS existed.
// Per-product detail isn't available for all three, so each stall is stored as
// two summary sales (one cash, one card) against a placeholder product. This
// gives the comparison chart the right gross/cash/card totals.
//
// Idempotent: re-running upserts the sessions by (name, date) and resyncs the
// two summary sales each time.

const LOCATION = 'Albion Place, Leeds';
const PRODUCT_NAME = 'Historical sale';

interface Stall {
  name: string;
  date: string;
  cash: number;
  card: number;
  stallFee: number;
  // Free-text item list captured at the stall, preserved verbatim (including
  // typos and inline corrections) so the original record is recoverable.
  lineItems?: string;
}

const STALLS: Stall[] = [
  {
    name: 'Stall 1',
    date: '2025-11-29',
    cash: 45.10,
    card: 86.90,
    stallFee: 95.0,
    lineItems: `1 figurines + tree legs — £4
yoga — £5
small tree fidget — £3 — cash
big tree fidget — £4 — cash
fidget cat — £3 — cash
fidget cat + dog — £5
fidget turtle — £2 — cash
fidget cat — £3
tree legs — £2 — cash
2 big dragon — £20 — cash
3 tree legs — £6 — cash
snowflake tree, mini tree, big trees — £9
mesh cat + lighthouse — £7
Owl — £4
Cat mesh + cat fidget — £6
Light shade — £10
2 small dragons + chazard + tortoise — £13
tree lights + tree legs + green fidget — £7
T-bone — £2
3 navity — £9
2 tree legs + Darth Vader — £8 — cash`,
  },
  {
    name: 'Stall 2',
    date: '2025-12-06',
    cash: 78.50,
    card: 92.50,
    stallFee: 95.0,
    lineItems: `Dragon — £10 — card
Bell — £2 — card
tree legs and a keychain and miniature — £5.50 — cash
Dragon Head — £4 — card
Medium dragon + Darth Vader — £14 — card
tree legs — £2 — cash
tree legs — £2 — cash
cat mesh — £3 — cash
Dragon — £10 — card
fidget tree, 2 tree legs, elephant — £11 — card
miniature — £1.50 — cash
small dragon — £5 — card
Charard — £2 — cash
fidget cat, miniature — £5 — cash
dino — £1.50 — cash
chazard — £2 — card
chazard — £2 — card
grumpy cat — £2 — card
tree legs — £2 — card
tree legs, fidget cat — £5 — cash
big fidget tree — £4 — cash
miniature — £1.50 — cash
miniature — £1.50 — cash
fidget cat — £3 — cash
owl — £5 — card
boat — £2 — cash
fidget cat, key chain — £5 — cash
fidget tree — £2 — card
fidget tree — £2 — card
cat mesh — £3 — card
small dragon + forest dragon — £10 — cash
chazard, miniature — £4 — card
2 tree legs — £4 — cash
tree legs, fidget tree — £4 — cash
elephant — £2 — cash
big fidget tree, fidget cat, fidget cat, ghost — £11 — card
chazard, miniature — £3.50 — card  (originally written as £4)
miniature — £1.50 — card  (originally written as £2)
cat mesh tea lights — £2 — card
light house and fidget tree — £2 — card
3 tree fidget, tree leg — £6 — cash
big fidget tree, tree — £2 — card

Total: £171`,
  },
  {
    name: 'Stall 3',
    date: '2026-03-14',
    cash: 122.0,
    card: 206.0,
    stallFee: 60.0,
    lineItems: `egg bunny — £3 — cash
hexagon keyring — £3 — card
4 leaf clover — £4 — card
small elephant tealights — £3 — cash
egg and dragon — £10 — cash
2 mesh cat black and white — £8 — cash
dragon keyring — £2 — cash
spinner — £3 — card
hexagon keyring + egg and dragon bundle — £15 — cash
egg bunny — £3 — card
hexagon — £4 — cash
big elephant tealight, egg bunny, spinner — £12 — card
2 hexagon, spinner — £14 — card
hexagon — £4 — cash
2 big dragons — £20 — card
spinner — £3 — card
knight and dragon — £14 — cash
spinner — £3
cat — £3 — card
2 cat — £6 — cash
dragon keyring — £2 — card
pink hexagon — £4 — cash
dragon, spinner, hexagon keyring, mesh cat, egg — £25 — card
medium dragon — £6 — card
green dragon — £10 — card
medium dragon — £6 — cash
2 spinner — £6 — cash
2 spinner — £6 — cash
big keychain dragon — £3
fidget cat — £3 — card
dragon without keyring — £3
dragon — £10 — card
hex keychain and fidget cat — £6 — card
2 big keychain — £5 — card
spinner — £3 — card
dragon — £10
fidget cat and big dragon keychain — £5
owl tealight — £5

Cash: £122
Card: £206
Total: £328`,
  },
];

function buildNotes(stall: Stall): string {
  const parts: string[] = ['Organiser: Artsmix'];
  if (stall.lineItems) {
    parts.push('', 'Items recorded at the stall:', stall.lineItems);
  }
  return parts.join('\n');
}

async function run(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Schema guard — safe to run even if migrate.ts already added the column.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE sessions ADD COLUMN stall_fee DECIMAL(10, 2);
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$
    `);

    // Find or create the placeholder product
    let productId: string;
    const productLookup = await client.query<{ id: string }>(
      'SELECT id FROM products WHERE name = $1 LIMIT 1',
      [PRODUCT_NAME]
    );
    if (productLookup.rows.length === 0) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO products (name, default_price, category)
         VALUES ($1, 0, 'Historical')
         RETURNING id`,
        [PRODUCT_NAME]
      );
      productId = inserted.rows[0].id;
      console.log(`Created product: ${PRODUCT_NAME}`);
    } else {
      productId = productLookup.rows[0].id;
      console.log(`Using existing product: ${PRODUCT_NAME}`);
    }

    for (const stall of STALLS) {
      let sessionId: string;
      // Look up by date alone — name/location/notes can be edited freely in
      // the UI without breaking idempotency on re-runs.
      const sessionLookup = await client.query<{ id: string }>(
        'SELECT id FROM sessions WHERE date = $1 ORDER BY created_at LIMIT 1',
        [stall.date]
      );

      if (sessionLookup.rows.length === 0) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO sessions
            (name, location, date, notes, status, card_fee_applied, stall_fee)
           VALUES ($1, $2, $3, $4, 'closed', true, $5)
           RETURNING id`,
          [stall.name, LOCATION, stall.date, buildNotes(stall), stall.stallFee]
        );
        sessionId = inserted.rows[0].id;
        console.log(`Created session: ${stall.name} (${stall.date})`);
      } else {
        // Existing row found for this date. Don't touch metadata — the user
        // may have renamed/edited it. Only the placeholder sales below get
        // resynced, in case the totals were corrected.
        sessionId = sessionLookup.rows[0].id;
        console.log(`Skipping session metadata for ${stall.date} (already exists)`);
      }

      // Wipe and rewrite the two summary sales for this session
      await client.query(
        'DELETE FROM sales WHERE session_id = $1 AND product_id = $2',
        [sessionId, productId]
      );

      const ts = `${stall.date} 12:00:00`;
      if (stall.cash > 0) {
        await client.query(
          `INSERT INTO sales
            (session_id, product_id, quantity, price_charged, payment_method, timestamp)
           VALUES ($1, $2, 1, $3, 'cash', $4)`,
          [sessionId, productId, stall.cash, ts]
        );
      }
      if (stall.card > 0) {
        await client.query(
          `INSERT INTO sales
            (session_id, product_id, quantity, price_charged, payment_method, timestamp)
           VALUES ($1, $2, 1, $3, 'card', $4)`,
          [sessionId, productId, stall.card, ts]
        );
      }
    }

    await client.query('COMMIT');
    console.log('Backfill completed.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
