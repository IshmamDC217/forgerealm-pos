import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';
import { useSessions } from '../../contexts/SessionsContext';
import { apiPost } from '../../utils/api';
import { formatCurrency } from '../../utils/currency';
import type { Session } from '../../types';

interface SidebarProps {
  onCloseMobile: () => void;
}

export default function Sidebar({ onCloseMobile }: SidebarProps) {
  const { username, logout } = useAuth();
  const { sessions, loading, refreshSessions } = useSessions();
  const navigate = useNavigate();
  const [showNewForm, setShowNewForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    location: '',
    date: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [creating, setCreating] = useState(false);

  const activeSessions = sessions.filter(s => s.status === 'active');
  const closedSessions = sessions.filter(s => s.status === 'closed');

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || creating) return;
    setCreating(true);
    try {
      const session = await apiPost<Session>('/sessions', form);
      await refreshSessions();
      setShowNewForm(false);
      setForm({ name: '', location: '', date: new Date().toISOString().split('T')[0], notes: '' });
      navigate(`/session/${session.id}`);
      onCloseMobile();
    } catch {
      // error silently
    } finally {
      setCreating(false);
    }
  };

  const handleSessionClick = () => {
    onCloseMobile();
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Branding */}
      <NavLink to="/" onClick={onCloseMobile} className="flex items-center gap-3 px-5 pt-6 pb-4 group">
        <img src="/logo.png" alt="ForgeRealm" className="w-9 h-9 rounded-lg object-cover" />
        <div>
          <h1
            className="text-xl font-bold group-hover:brightness-110 transition-all"
            style={{ backgroundImage: 'linear-gradient(135deg, #d4a843, #e4c373)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontFamily: "'Sora', sans-serif" }}
          >
            ForgeRealm
          </h1>
          <p className="text-gray-600 text-xs mt-0.5 tracking-wide">Point of Sale</p>
        </div>
      </NavLink>

      {/* New Session Button */}
      <div className="px-4 pb-3">
        <motion.button
          onClick={() => setShowNewForm(!showNewForm)}
          className="btn-gold w-full text-sm flex items-center justify-center gap-2"
          whileTap={{ scale: 0.97 }}
        >
          <motion.svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            animate={{ rotate: showNewForm ? 45 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </motion.svg>
          New Stall Session
        </motion.button>
      </div>

      {/* Inline New Session Form */}
      <AnimatePresence>
        {showNewForm && (
          <motion.form
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
            onSubmit={handleCreateSession}
          >
            <div className="mx-4 mb-3 p-3 bg-white/[0.03] rounded-xl border border-white/[0.06] space-y-2">
              <input
                type="text"
                placeholder="Session name"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full text-sm"
                autoFocus
              />
              <input
                type="text"
                placeholder="Location (optional)"
                value={form.location}
                onChange={e => setForm({ ...form, location: e.target.value })}
                className="w-full text-sm"
              />
              <input
                type="date"
                value={form.date}
                onChange={e => setForm({ ...form, date: e.target.value })}
                className="w-full text-sm"
              />
              <textarea
                placeholder="Notes (optional)"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                className="w-full text-sm"
                rows={2}
              />
              <div className="flex gap-2">
                <button type="submit" disabled={creating} className="btn-gold flex-1 text-xs !py-2">
                  {creating ? 'Creating...' : 'Start'}
                </button>
                <button type="button" onClick={() => setShowNewForm(false)} className="btn-outline flex-1 text-xs !py-2">
                  Cancel
                </button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Scrollable Session List */}
      <div className="flex-1 overflow-y-auto px-2">
        {/* Active Sessions */}
        {activeSessions.length > 0 && (
          <div className="mb-4">
            <h3 className="section-title text-gold px-3 mb-1.5 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Active
            </h3>
            <div className="space-y-0.5">
              {activeSessions.map((s, i) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.3 }}
                >
                  <SessionItem session={s} onClick={handleSessionClick} />
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Past Sessions */}
        {closedSessions.length > 0 && (
          <div className="mb-4">
            <h3 className="section-title text-gray-600 px-3 mb-1.5">
              Past Sessions
            </h3>
            <div className="space-y-0.5">
              {closedSessions.map(s => (
                <SessionItem key={s.id} session={s} onClick={handleSessionClick} />
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 text-gray-500 py-6 text-sm">
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-gold/50"
              animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
            Loading...
          </div>
        )}

        {!loading && sessions.length === 0 && !showNewForm && (
          <div className="text-center text-gray-600 py-6 px-4">
            <p className="text-sm">No sessions yet</p>
            <p className="text-xs mt-1 text-gray-700">Create your stall session</p>
          </div>
        )}
      </div>

      {/* Bottom: Home + Products Links */}
      <div className="border-t border-white/[0.06] px-2 py-3 space-y-0.5">
        <NavLink
          to="/"
          end
          onClick={onCloseMobile}
          className={({ isActive }) =>
            `sidebar-item text-sm ${isActive ? 'active' : 'text-gray-400 hover:text-gray-200'}`
          }
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          Home
        </NavLink>
        <NavLink
          to="/products"
          onClick={onCloseMobile}
          className={({ isActive }) =>
            `sidebar-item text-sm ${isActive ? 'active' : 'text-gray-400 hover:text-gray-200'}`
          }
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          Manage Products
        </NavLink>
        <button
          onClick={logout}
          className="sidebar-item text-sm text-gray-400 hover:text-red-400 w-full"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span className="flex-1 text-left">Sign Out</span>
          {username && <span className="text-xs text-gray-600">{username}</span>}
        </button>
      </div>
    </div>
  );

  function SessionItem({ session, onClick }: { session: Session; onClick: () => void }) {
    const revenue = parseFloat(String(session.total_revenue || 0));
    const isActive = session.status === 'active';

    return (
      <NavLink
        to={`/session/${session.id}`}
        onClick={onClick}
        className={({ isActive: isNavActive }) =>
          `sidebar-item ${isNavActive ? 'active' : ''}`
        }
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isActive && (
              <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" style={{ boxShadow: '0 0 10px rgba(74, 222, 128, 0.4)' }} />
            )}
            <span className="font-medium text-sm text-white truncate">{session.name}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {session.location && (
              <span className="text-xs text-gray-500 truncate">{session.location}</span>
            )}
            {session.location && <span className="text-gray-700 text-xs">&middot;</span>}
            <span className="text-xs text-gray-600">{formatDate(session.date)}</span>
          </div>
        </div>
        <span className="text-xs font-semibold text-gold flex-shrink-0">
          {formatCurrency(revenue)}
        </span>
      </NavLink>
    );
  }
}
