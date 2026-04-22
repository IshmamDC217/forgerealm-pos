// Offline support: cache read responses + queue writes when offline.
// Designed to be invisible to the rest of the app — api.ts wraps fetch
// with these helpers, so components do not need to know about offline mode.

const CACHE_PREFIX = 'offline:cache:';
const QUEUE_KEY = 'offline:queue';

// ── Read cache ────────────────────────────────────────────────────────────

export function readCache<T>(path: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + path);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeCache<T>(path: string, value: T): void {
  try {
    localStorage.setItem(CACHE_PREFIX + path, JSON.stringify(value));
  } catch {
    // Quota exceeded etc — fail silently
  }
}

// Update a cached array by mutating it via a callback. Used so that when we
// queue a sale create offline, the cached sales list reflects it on reload.
export function updateCachedArray<T>(path: string, updater: (arr: T[]) => T[]): void {
  const current = readCache<T[]>(path) || [];
  writeCache(path, updater(current));
}

// ── Outbox / mutation queue ───────────────────────────────────────────────

export interface QueuedMutation {
  id: string;             // local uuid for this queue entry
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;           // e.g. /sales, /sales/local-abc
  body?: unknown;
  // For POST /sales we generate a tempId so the UI can reference the row
  // before it's been synced to the server.
  tempId?: string;
  createdAt: number;
}

export function readQueue(): QueuedMutation[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedMutation[]) : [];
  } catch {
    return [];
  }
}

export function writeQueue(queue: QueuedMutation[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function enqueue(mutation: Omit<QueuedMutation, 'id' | 'createdAt'>): QueuedMutation {
  const entry: QueuedMutation = {
    ...mutation,
    id: localId(),
    createdAt: Date.now(),
  };
  const queue = readQueue();
  queue.push(entry);
  writeQueue(queue);
  notifyQueueChange();
  return entry;
}

// When a user edits/deletes a sale that is still queued (i.e. its id starts
// with `local-`), rewrite the existing queue entry instead of pushing a new
// one — so we never try to PATCH a sale id the server doesn't know about.
export function patchQueuedCreate(tempId: string, bodyPatch: Record<string, unknown>): boolean {
  const queue = readQueue();
  const idx = queue.findIndex((m) => m.tempId === tempId && m.method === 'POST');
  if (idx === -1) return false;
  queue[idx].body = { ...(queue[idx].body as object), ...bodyPatch };
  writeQueue(queue);
  notifyQueueChange();
  return true;
}

export function removeQueuedCreate(tempId: string): boolean {
  const queue = readQueue();
  const filtered = queue.filter((m) => m.tempId !== tempId);
  if (filtered.length === queue.length) return false;
  writeQueue(filtered);
  notifyQueueChange();
  return true;
}

export function localId(): string {
  return 'local-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function isLocalId(id: string | undefined | null): boolean {
  return typeof id === 'string' && id.startsWith('local-');
}

// ── Online detection ──────────────────────────────────────────────────────

let online = typeof navigator !== 'undefined' ? navigator.onLine : true;
const onlineListeners = new Set<(online: boolean) => void>();
const queueListeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
}

export function isOnline(): boolean {
  return online;
}

export function setOnline(value: boolean): void {
  if (online === value) return;
  online = value;
  onlineListeners.forEach((cb) => cb(value));
}

export function subscribeOnline(cb: (online: boolean) => void): () => void {
  onlineListeners.add(cb);
  return () => onlineListeners.delete(cb);
}

export function subscribeQueue(cb: () => void): () => void {
  queueListeners.add(cb);
  return () => queueListeners.delete(cb);
}

function notifyQueueChange() {
  queueListeners.forEach((cb) => cb());
}

// Detect whether an error from fetch indicates a network failure (vs. a real
// HTTP error). TypeError is what `fetch` throws when DNS / TCP fails.
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof Error && /failed to fetch|network|load failed/i.test(err.message)) return true;
  return false;
}

// ── Sync ──────────────────────────────────────────────────────────────────

// Drain the outbox by replaying mutations against the live API.
// `doFetch` is the raw fetch function from api.ts (so we don't recurse).
// Returns the number of mutations successfully synced.
export async function drainQueue(
  doFetch: (path: string, init: RequestInit) => Promise<Response>,
): Promise<{ synced: number; failed: number; idMap: Record<string, string> }> {
  const queue = readQueue();
  const idMap: Record<string, string> = {};
  let synced = 0;
  let failed = 0;

  // Process strictly in order so a create followed by an edit on the same
  // tempId apply correctly.
  for (const entry of queue) {
    try {
      const res = await doFetch(entry.path, {
        method: entry.method,
        headers: { 'Content-Type': 'application/json' },
        body: entry.body !== undefined ? JSON.stringify(entry.body) : undefined,
      });

      if (!res.ok) {
        // Treat 4xx as terminal — drop the entry so we don't loop forever
        // on a poison message. 5xx leaves it for the next retry.
        if (res.status >= 400 && res.status < 500) {
          console.warn('[offline] Dropping queued mutation that returned 4xx:', entry, await res.text());
        } else {
          failed += 1;
          break;
        }
      } else if (entry.tempId) {
        const json = (await res.json()) as { id?: string };
        if (json && json.id) {
          idMap[entry.tempId] = json.id;
        }
      } else {
        await res.json().catch(() => undefined);
      }

      // Remove the just-processed entry
      const remaining = readQueue().filter((m) => m.id !== entry.id);
      writeQueue(remaining);
      synced += 1;
      notifyQueueChange();
    } catch (err) {
      if (isNetworkError(err)) {
        failed += 1;
        break;
      }
      console.warn('[offline] Dropping queued mutation that errored:', entry, err);
      const remaining = readQueue().filter((m) => m.id !== entry.id);
      writeQueue(remaining);
    }
  }

  return { synced, failed, idMap };
}

export function queueLength(): number {
  return readQueue().length;
}
