import { query } from '../db';
import { isConfigured, listTransactionsSince, SumUpTransaction } from './client';

// Only insert pending rows for SumUp transactions newer than this. Set when
// the server boots so we don't flood the queue with historical data.
const SINCE: Date = new Date();

const POLL_INTERVAL_MS = 30_000;

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

async function findActiveSessionId(): Promise<string | null> {
  const r = await query<{ id: string }>(
    `SELECT id FROM sessions WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
  );
  return r.rows[0]?.id ?? null;
}

async function insertPending(tx: SumUpTransaction, sessionId: string | null): Promise<void> {
  // Skip if already known either as pending or already allocated to a sale.
  const already = await query<{ id: string }>(
    `SELECT id FROM pending_transactions WHERE sumup_transaction_id = $1
     UNION
     SELECT id FROM sales WHERE sumup_transaction_id = $1
     LIMIT 1`,
    [tx.id]
  );
  if (already.rows.length > 0) return;

  await query(
    `INSERT INTO pending_transactions
       (sumup_transaction_id, session_id, amount, currency, sumup_timestamp, card_type, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tx.id, sessionId, tx.amount, tx.currency, tx.timestamp, tx.card_type ?? null, tx]
  );
  console.log(
    `[sumup] new pending ${tx.id} · ${tx.currency} ${tx.amount} @ ${tx.timestamp}`
  );
}

async function tick(since: Date = SINCE): Promise<void> {
  if (inFlight) return;
  if (!isConfigured()) return; // silent skip when no token
  inFlight = true;
  try {
    const txs = await listTransactionsSince(since);
    if (txs.length === 0) return;
    const sessionId = await findActiveSessionId();
    for (const tx of txs) {
      await insertPending(tx, sessionId);
    }
  } catch (err) {
    console.error('[sumup] poll error:', err instanceof Error ? err.message : err);
  } finally {
    inFlight = false;
  }
}

// Run one poll cycle. Used by the Netlify scheduled function — serverless
// invocations can't keep a setInterval alive between requests, so prod
// drives the poll via cron instead of startPoller(). insertPending() already
// dedupes against pending_transactions and sales, so overlapping windows are
// safe.
export async function pollOnce(since: Date): Promise<void> {
  await tick(since);
}

export function startPoller(): void {
  if (timer) return;
  if (!isConfigured()) {
    console.log('[sumup] SUMUP_TOKEN not set — poller disabled');
    return;
  }
  console.log(`[sumup] poller started · interval ${POLL_INTERVAL_MS}ms · since ${SINCE.toISOString()}`);
  // Kick off immediately, then on interval.
  tick().catch(() => {});
  timer = setInterval(() => {
    tick().catch(() => {});
  }, POLL_INTERVAL_MS);
}

export function stopPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
