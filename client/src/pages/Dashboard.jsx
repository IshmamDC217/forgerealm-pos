import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const API = '/api';

export default function Dashboard() {
  const [sessions, setSessions] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', location: '', date: new Date().toISOString().split('T')[0], notes: '' });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${API}/sessions`)
      .then(r => r.json())
      .then(data => { setSessions(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const createSession = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const res = await fetch(`${API}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      const session = await res.json();
      navigate(`/session/${session.id}`);
    }
  };

  const activeSessions = sessions.filter(s => s.status === 'active');
  const closedSessions = sessions.filter(s => s.status === 'closed');
  const totalRevenue = sessions.reduce((sum, s) => sum + parseFloat(s.total_revenue || 0), 0);
  const totalUnits = sessions.reduce((sum, s) => sum + parseInt(s.total_units || 0), 0);

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gold">ForgeRealm</h1>
          <p className="text-gray-400 text-sm">Point of Sale</p>
        </div>
        <Link to="/products" className="btn-outline text-sm px-3 py-2">
          Products
        </Link>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="card text-center">
          <p className="text-gray-400 text-xs mb-1">Sessions</p>
          <p className="text-xl font-bold text-white">{sessions.length}</p>
        </div>
        <div className="card text-center">
          <p className="text-gray-400 text-xs mb-1">Revenue</p>
          <p className="text-xl font-bold text-gold">${totalRevenue.toFixed(2)}</p>
        </div>
        <div className="card text-center">
          <p className="text-gray-400 text-xs mb-1">Units</p>
          <p className="text-xl font-bold text-white">{totalUnits}</p>
        </div>
      </div>

      {/* New Session Button */}
      <button
        onClick={() => setShowNew(!showNew)}
        className="btn-gold w-full text-lg mb-4"
      >
        + New Stall Session
      </button>

      {/* New Session Form */}
      {showNew && (
        <form onSubmit={createSession} className="card mb-6 space-y-3">
          <input
            type="text"
            placeholder="Session name (e.g. Camden Market March)"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full"
            autoFocus
          />
          <input
            type="text"
            placeholder="Location (optional)"
            value={form.location}
            onChange={e => setForm({ ...form, location: e.target.value })}
            className="w-full"
          />
          <input
            type="date"
            value={form.date}
            onChange={e => setForm({ ...form, date: e.target.value })}
            className="w-full"
          />
          <textarea
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            className="w-full"
            rows={2}
          />
          <div className="flex gap-2">
            <button type="submit" className="btn-gold flex-1">Start Session</button>
            <button type="button" onClick={() => setShowNew(false)} className="btn-outline flex-1">Cancel</button>
          </div>
        </form>
      )}

      {/* Active Sessions */}
      {activeSessions.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gold uppercase tracking-wider mb-3">Active Sessions</h2>
          <div className="space-y-2">
            {activeSessions.map(s => (
              <SessionCard key={s.id} session={s} />
            ))}
          </div>
        </div>
      )}

      {/* Past Sessions */}
      {closedSessions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Past Sessions</h2>
          <div className="space-y-2">
            {closedSessions.map(s => (
              <SessionCard key={s.id} session={s} />
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center text-gray-500 py-8">Loading...</div>
      )}

      {!loading && sessions.length === 0 && !showNew && (
        <div className="text-center text-gray-500 py-8">
          <p className="text-lg mb-2">No sessions yet</p>
          <p className="text-sm">Create your first stall session to start tracking sales</p>
        </div>
      )}
    </div>
  );
}

function SessionCard({ session }) {
  const date = new Date(session.date).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  const revenue = parseFloat(session.total_revenue || 0);
  const units = parseInt(session.total_units || 0);

  return (
    <Link to={`/session/${session.id}`} className="card block hover:border-gold/50 transition-colors">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-white">{session.name}</h3>
          <p className="text-gray-400 text-sm">
            {session.location && `${session.location} · `}{date}
          </p>
        </div>
        <div className="text-right">
          <p className="font-bold text-gold">${revenue.toFixed(2)}</p>
          <p className="text-gray-400 text-xs">{units} units</p>
        </div>
      </div>
      {session.status === 'active' && (
        <span className="inline-block mt-2 text-xs bg-green-900/50 text-green-400 px-2 py-0.5 rounded-full">
          Live
        </span>
      )}
    </Link>
  );
}
