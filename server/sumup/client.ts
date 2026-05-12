// Tiny SumUp REST client. Only what the poller needs — read transaction
// history with a Personal Access Token (no OAuth dance).
//
// Token is read from process.env.SUMUP_TOKEN. When unset, isConfigured()
// returns false and the poller skips its tick gracefully so the rest of the
// server keeps working in local dev without SumUp set up.

const API_BASE = 'https://api.sumup.com';

export interface SumUpTransaction {
  id: string;
  transaction_code: string;
  amount: number;
  currency: string;
  timestamp: string;        // ISO 8601
  status: string;           // 'SUCCESSFUL' | 'CANCELLED' | 'FAILED' | etc
  payment_type: string;     // 'POS' for in-person terminal, 'CARD' for online
  type?: string;            // 'PAYMENT' | 'REFUND' | ...
  card_type?: string;       // 'VISA' | 'MASTERCARD' | etc when present
  product_summary?: string;
}

interface HistoryResponse {
  items: SumUpTransaction[];
  links?: Array<{ rel: string; href: string }>;
}

export function isConfigured(): boolean {
  return Boolean(process.env.SUMUP_TOKEN);
}

async function authedFetch(path: string): Promise<Response> {
  const token = process.env.SUMUP_TOKEN;
  if (!token) throw new Error('SUMUP_TOKEN is not set');
  return fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Fetch successful card transactions newer than `since`.
export async function listTransactionsSince(since: Date): Promise<SumUpTransaction[]> {
  const params = new URLSearchParams({
    order: 'ascending',
    oldest_time: since.toISOString(),
    limit: '50',
  });
  const res = await authedFetch(`/v0.1/me/transactions/history?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SumUp history fetch failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as HistoryResponse;
  return (json.items || []).filter(
    t =>
      t.status === 'SUCCESSFUL' &&
      // SumUp uses payment_type=POS for in-person card reader transactions
      // and payment_type=CARD for online checkouts. Accept both.
      (t.payment_type === 'POS' || t.payment_type === 'CARD') &&
      (t.type === undefined || t.type === 'PAYMENT')
  );
}
