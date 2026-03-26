import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { Session } from '../types';
import { apiGet } from '../utils/api';
import { getSocket } from '../utils/socket';

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

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  // Real-time: refresh session list on any session/sale change
  useEffect(() => {
    const socket = getSocket();
    const refresh = () => { refreshSessions(); };
    socket.on('session:created', refresh);
    socket.on('session:updated', refresh);
    socket.on('session:deleted', refresh);
    socket.on('sale:created', refresh);
    socket.on('sale:updated', refresh);
    socket.on('sale:deleted', refresh);
    return () => {
      socket.off('session:created', refresh);
      socket.off('session:updated', refresh);
      socket.off('session:deleted', refresh);
      socket.off('sale:created', refresh);
      socket.off('sale:updated', refresh);
      socket.off('sale:deleted', refresh);
    };
  }, [refreshSessions]);

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
