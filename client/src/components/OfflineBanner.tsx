import { useEffect, useState } from 'react';
import { isOnline, subscribeOnline, subscribeQueue, queueLength } from '../utils/offline';
import { syncNow } from '../utils/api';

// Small banner that surfaces offline status and the size of the outbox.
// Renders nothing when fully online with an empty queue.
export default function OfflineBanner() {
  const [online, setOnlineState] = useState(isOnline());
  const [pending, setPending] = useState(queueLength());
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const offOnline = subscribeOnline((v) => {
      setOnlineState(v);
      if (v) {
        // Came back online → try to drain immediately
        setSyncing(true);
        syncNow().finally(() => {
          setSyncing(false);
          setPending(queueLength());
        });
      }
    });
    const offQueue = subscribeQueue(() => setPending(queueLength()));
    return () => {
      offOnline();
      offQueue();
    };
  }, []);

  // Periodically retry while there's pending work — handles the case where
  // the browser thinks we're online but the server is still unreachable.
  useEffect(() => {
    if (pending === 0) return;
    const t = setInterval(() => {
      if (!syncing) {
        setSyncing(true);
        syncNow().finally(() => {
          setSyncing(false);
          setPending(queueLength());
        });
      }
    }, 15000);
    return () => clearInterval(t);
  }, [pending, syncing]);

  if (online && pending === 0) return null;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncNow();
    } finally {
      setSyncing(false);
      setPending(queueLength());
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] flex justify-center pointer-events-none">
      <div
        className={`mt-2 mx-2 px-3 py-1.5 rounded-full text-xs font-medium pointer-events-auto flex items-center gap-2 backdrop-blur-md border ${
          online
            ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
            : 'bg-red-500/15 border-red-500/40 text-red-300'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            online ? 'bg-amber-400' : 'bg-red-400 animate-pulse'
          }`}
        />
        {online
          ? `${pending} change${pending === 1 ? '' : 's'} pending sync`
          : `Offline${pending > 0 ? ` · ${pending} queued` : ''}`}
        {online && pending > 0 && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="ml-1 underline underline-offset-2 disabled:opacity-50"
          >
            {syncing ? 'syncing…' : 'sync now'}
          </button>
        )}
      </div>
    </div>
  );
}
