import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { Session } from '../types';
import { apiGet } from '../utils/api';
import { usePolling } from '../utils/usePolling';

interface SessionsContextValue {
  sessions: Session[];
  loading: boolean;
  refreshSessions: () => Promise<void>;
}

const SessionsContext = createContext<SessionsContextValue | null>(null);

export function SessionsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshSessions = useCallback(async () => {
    try {
      const data = await apiGet<Session[]>('/sessions');
      setSessions(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll the session list every 10s while the tab is visible. Session-level
  // data changes slowly (creating/closing a stall day) so a slower cadence is
  // fine here; per-session views poll more aggressively.
  usePolling(refreshSessions, { intervalMs: 10000 });

  return (
    <SessionsContext.Provider value={{ sessions, loading, refreshSessions }}>
      {children}
    </SessionsContext.Provider>
  );
}

export function useSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext);
  if (!ctx) throw new Error('useSessions must be used within SessionsProvider');
  return ctx;
}
