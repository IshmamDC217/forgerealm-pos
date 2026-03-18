import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';

const brandStyle = {
  backgroundImage: 'linear-gradient(135deg, #d4a843, #e4c373)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
  fontFamily: "'Sora', sans-serif",
} as const;

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setError('');
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-navy flex flex-col items-center justify-center px-6 relative overflow-hidden">
      {/* Ambient glow */}
      <div
        className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] pointer-events-none opacity-50"
        style={{ background: 'radial-gradient(ellipse at top, rgba(212, 168, 67, 0.15), transparent 60%)' }}
      />

      <motion.div
        className="w-full max-w-sm relative"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* Branding */}
        <div className="text-center mb-8">
          <motion.div
            className="inline-block mb-5"
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <img
              src="/logo.png"
              alt="ForgeRealm"
              className="w-20 h-20 mx-auto rounded-2xl object-cover"
              style={{ boxShadow: '0 0 30px rgba(212, 168, 67, 0.2)' }}
            />
          </motion.div>
          <h1 className="text-3xl font-bold mb-1" style={brandStyle}>ForgeRealm</h1>
          <p className="text-gray-500 text-sm tracking-wide">Point of Sale</p>
        </div>

        {/* Login Card */}
        <form onSubmit={handleSubmit} className="card space-y-4">
          <h2 className="text-lg font-semibold text-white text-center">Sign In</h2>

          {error && (
            <motion.div
              className="text-sm text-red-400 text-center py-2 px-3 rounded-xl"
              style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {error}
            </motion.div>
          )}

          <div>
            <label className="text-xs text-gray-500 block mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full"
              placeholder="Enter username"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full"
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </div>

          <motion.button
            type="submit"
            disabled={submitting || !username.trim() || !password}
            className="btn-gold w-full text-base disabled:opacity-50 disabled:cursor-not-allowed"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <motion.span
                  className="w-2 h-2 rounded-full bg-navy"
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ duration: 0.6, repeat: Infinity }}
                />
                Signing in...
              </span>
            ) : 'Sign In'}
          </motion.button>
        </form>
      </motion.div>
    </div>
  );
}
