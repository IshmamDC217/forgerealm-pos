import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { API_BASE } from '../utils/config';
import { isNetworkError, setOnline } from '../utils/offline';

interface AuthContextValue {
  isAuthenticated: boolean;
  username: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }

    // Optimistically authenticate from cached credentials so we can boot
    // offline. We still verify against the server in the background — if it
    // explicitly says the token is invalid (401) we log out, but a network
    // failure leaves the user signed in with their cached state.
    const cachedUsername = localStorage.getItem('username');
    if (cachedUsername) {
      setIsAuthenticated(true);
      setUsername(cachedUsername);
    }

    fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (res.status === 401) {
          // Token actually invalid → sign out
          localStorage.removeItem('token');
          localStorage.removeItem('username');
          setIsAuthenticated(false);
          setUsername(null);
          return null;
        }
        if (!res.ok) throw new Error('auth check failed');
        return res.json();
      })
      .then(data => {
        if (data) {
          setIsAuthenticated(true);
          setUsername(data.username);
          localStorage.setItem('username', data.username);
          setOnline(true);
        }
      })
      .catch((err) => {
        // Network failure — stay with cached credentials, mark offline
        if (isNetworkError(err)) {
          setOnline(false);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(data.error || 'Login failed');
    }

    const data = await res.json();
    localStorage.setItem('token', data.token);
    localStorage.setItem('username', data.username);
    setIsAuthenticated(true);
    setUsername(data.username);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    setIsAuthenticated(false);
    setUsername(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, username, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
