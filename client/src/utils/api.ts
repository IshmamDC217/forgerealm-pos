import { API_BASE } from './config';
import {
  readCache,
  writeCache,
  enqueue,
  patchQueuedCreate,
  removeQueuedCreate,
  isLocalId,
  localId,
  isNetworkError,
  setOnline,
  drainQueue,
  isOnline,
} from './offline';

const BASE = `${API_BASE}/api`;

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Raw fetch that does not engage the offline layer — used internally by the
// queue drainer so we don't recurse.
async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...init.headers,
    },
  });
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await rawFetch(path, options || {});

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── GET with cache fallback ──────────────────────────────────────────────
//
// Try the network first. If it succeeds, cache the response and return it.
// If the network fails, fall back to whatever we have cached. If nothing is
// cached either, rethrow.
export async function apiGet<T>(path: string): Promise<T> {
  try {
    const data = await request<T>(path);
    writeCache(path, data);
    setOnline(true);
    // Opportunistic: if we just came back online and there's queued work,
    // try to drain it.
    void maybeDrain();
    return data;
  } catch (err) {
    if (isNetworkError(err)) {
      setOnline(false);
      const cached = readCache<T>(path);
      if (cached !== null) return cached;
    }
    throw err;
  }
}

// ── Mutations ────────────────────────────────────────────────────────────
//
// We try the network first. If we're offline (or the request fails with a
// network error), we enqueue the mutation and synthesise a response so the
// optimistic UI can keep flowing. For sale creates we generate a temporary
// id; for edits/deletes that target a still-queued temp id we mutate the
// queued create entry instead.

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  try {
    const data = await request<T>(path, { method: 'POST', body: JSON.stringify(body) });
    setOnline(true);
    // Update cached list responses where it's safe to do so
    if (path === '/sales' && body && typeof body === 'object') {
      const sessionId = (body as { session_id?: string }).session_id;
      if (sessionId) {
        const key = `/sales/session/${sessionId}`;
        const cached = readCache<unknown[]>(key) || [];
        writeCache(key, [data, ...cached]);
      }
    }
    return data;
  } catch (err) {
    if (!isNetworkError(err)) throw err;

    setOnline(false);

    // Special case: offline sale creation. We synthesise a sale row so the
    // UI behaves the same as if the server returned one.
    if (path === '/sales' && body && typeof body === 'object') {
      const tempId = localId();
      enqueue({ method: 'POST', path, body, tempId });

      const synthetic = synthesiseSale(tempId, body as Record<string, unknown>);
      const sessionId = (body as { session_id?: string }).session_id;
      if (sessionId) {
        const key = `/sales/session/${sessionId}`;
        const cached = readCache<unknown[]>(key) || [];
        writeCache(key, [synthetic, ...cached]);
      }
      return synthetic as T;
    }

    // Generic mutation queue (PUT for stock setup etc could land here too —
    // but we don't synthesise their responses, callers should already have
    // optimistic state).
    enqueue({ method: 'POST', path, body });
    return undefined as T;
  }
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  // If we're editing a still-queued temp sale, mutate the queue entry rather
  // than firing a server PATCH.
  const localTarget = extractLocalTarget(path);
  if (localTarget) {
    patchQueuedCreate(localTarget, body as Record<string, unknown>);
    // Update the cached sales list if we can find the row
    updateCachedSaleById(localTarget, (s) => ({ ...s, ...(body as object) }));
    return undefined as T;
  }

  try {
    const data = await request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
    setOnline(true);
    return data;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    setOnline(false);
    enqueue({ method: 'PATCH', path, body });
    // Best-effort cache update for sale edits
    const saleId = extractSaleId(path);
    if (saleId) updateCachedSaleById(saleId, (s) => ({ ...s, ...(body as object) }));
    return undefined as T;
  }
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  try {
    const data = await request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
    setOnline(true);
    return data;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    setOnline(false);
    enqueue({ method: 'PUT', path, body });
    return undefined as T;
  }
}

export async function apiDelete<T = void>(path: string): Promise<T> {
  // Deleting a still-queued temp sale: just drop the queued create.
  const localTarget = extractLocalTarget(path);
  if (localTarget) {
    removeQueuedCreate(localTarget);
    removeCachedSaleById(localTarget);
    return undefined as T;
  }

  try {
    const data = await request<T>(path, { method: 'DELETE' });
    setOnline(true);
    // Drop from cached sales list if relevant
    const saleId = extractSaleId(path);
    if (saleId) removeCachedSaleById(saleId);
    return data;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    setOnline(false);
    enqueue({ method: 'DELETE', path });
    const saleId = extractSaleId(path);
    if (saleId) removeCachedSaleById(saleId);
    return undefined as T;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function extractLocalTarget(path: string): string | null {
  const m = path.match(/\/sales\/(local-[a-z0-9]+)$/i);
  return m && isLocalId(m[1]) ? m[1] : null;
}

function extractSaleId(path: string): string | null {
  const m = path.match(/\/sales\/([^/?]+)$/);
  return m ? m[1] : null;
}

function synthesiseSale(tempId: string, body: Record<string, unknown>) {
  return {
    id: tempId,
    session_id: body.session_id,
    product_id: body.product_id,
    quantity: body.quantity,
    price_charged: body.price_charged,
    payment_method: body.payment_method ?? 'cash',
    timestamp: new Date().toISOString(),
    created_at: new Date().toISOString(),
    // Best-effort product enrichment from cached products
    ...lookupProductInfo(body.product_id as string | undefined),
    _pending: true,
  };
}

function lookupProductInfo(productId: string | undefined): { product_name?: string; product_category?: string | null } {
  if (!productId) return {};
  const products = readCache<Array<{ id: string; name: string; category: string | null }>>('/products');
  if (!products) return {};
  const p = products.find((x) => x.id === productId);
  return p ? { product_name: p.name, product_category: p.category } : {};
}

function updateCachedSaleById(saleId: string, updater: (sale: any) => any) {
  // We don't know the session id from a sale id alone — scan all cached sales lists.
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('offline:cache:/sales/session/')) continue;
    try {
      const arr = JSON.parse(localStorage.getItem(key) || '[]') as any[];
      let touched = false;
      const next = arr.map((s) => {
        if (s.id === saleId) {
          touched = true;
          return updater(s);
        }
        return s;
      });
      if (touched) localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
}

function removeCachedSaleById(saleId: string) {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('offline:cache:/sales/session/')) continue;
    try {
      const arr = JSON.parse(localStorage.getItem(key) || '[]') as any[];
      const next = arr.filter((s) => s.id !== saleId);
      if (next.length !== arr.length) localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
}

// ── Drain coordination ───────────────────────────────────────────────────

let draining = false;

export async function syncNow(): Promise<{ synced: number; failed: number }> {
  if (draining) return { synced: 0, failed: 0 };
  draining = true;
  try {
    const result = await drainQueue(rawFetch);
    if (result.failed === 0) setOnline(true);
    return { synced: result.synced, failed: result.failed };
  } finally {
    draining = false;
  }
}

async function maybeDrain() {
  if (!isOnline()) return;
  await syncNow();
}
