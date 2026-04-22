import { useEffect, useRef } from 'react';

export interface PollingOptions {
  intervalMs?: number;
  enabled?: boolean;
}

// Run `fn` on mount and then every `intervalMs` while the tab is visible.
// Pauses when the tab is hidden and fires immediately when it becomes visible
// again so the user sees fresh data the moment they tab back in.
export function usePolling(fn: () => void | Promise<void>, options: PollingOptions = {}): void {
  const { intervalMs = 5000, enabled = true } = options;
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (document.visibilityState === 'visible') {
        void fnRef.current();
      }
    };

    const start = () => {
      if (timer) return;
      timer = setInterval(tick, intervalMs);
    };

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fnRef.current();
        start();
      } else {
        stop();
      }
    };

    // Initial fetch + start polling
    void fnRef.current();
    start();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [enabled, intervalMs]);
}
