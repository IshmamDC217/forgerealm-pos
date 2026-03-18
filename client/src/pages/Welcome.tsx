import { motion } from 'framer-motion';
import { useSessions } from '../contexts/SessionsContext';
import { formatCurrency } from '../utils/currency';
import PageTransition from '../components/PageTransition';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.2 },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const brandStyle = {
  backgroundImage: 'linear-gradient(135deg, #d4a843, #e4c373)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
  fontFamily: "'Sora', sans-serif",
} as const;

export default function Welcome() {
  const { sessions, loading } = useSessions();

  const totalRevenue = sessions.reduce((sum, s) => sum + parseFloat(String(s.total_revenue || 0)), 0);
  const totalUnits = sessions.reduce((sum, s) => sum + parseInt(String(s.total_units || 0), 10), 0);
  const activeSessions = sessions.filter(s => s.status === 'active').length;

  return (
    <PageTransition>
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] md:min-h-screen px-6">
        <motion.div
          className="text-center max-w-lg"
          variants={container}
          initial="hidden"
          animate="show"
        >
          {/* Branding */}
          <motion.div variants={item} className="mb-10">
            <motion.div
              className="inline-block mb-6"
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <img
                src="/logo.png"
                alt="ForgeRealm"
                className="w-24 h-24 mx-auto rounded-2xl object-cover"
                style={{ boxShadow: '0 0 30px rgba(212, 168, 67, 0.2)' }}
              />
            </motion.div>
            <h1 className="text-5xl font-bold mb-3" style={brandStyle}>
              ForgeRealm
            </h1>
            <p className="text-gray-500 text-lg tracking-wide">Point of Sale</p>
          </motion.div>

          {/* Stats */}
          {!loading && sessions.length > 0 && (
            <motion.div variants={item} className="grid grid-cols-3 gap-4 mb-10">
              <StatCard label="Revenue" value={formatCurrency(totalRevenue)} accent="gold" />
              <StatCard label="Units Sold" value={String(totalUnits)} accent="white" />
              <StatCard label="Active" value={String(activeSessions)} accent="green" />
            </motion.div>
          )}

          {/* Prompt */}
          <motion.div variants={item} className="text-gray-500">
            {loading ? (
              <div className="flex items-center justify-center gap-3">
                <motion.div
                  className="w-2 h-2 rounded-full bg-gold"
                  animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
                <p>Loading...</p>
              </div>
            ) : sessions.length === 0 ? (
              <>
                <p className="text-lg text-gray-400 mb-2">Welcome to ForgeRealm POS</p>
                <p className="text-sm text-gray-500/80 leading-relaxed">
                  Create your stall session from the sidebar to start tracking sales.
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-500/80">Select a session from the sidebar, or create a new one.</p>
            )}
          </motion.div>
        </motion.div>
      </div>
    </PageTransition>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: 'gold' | 'white' | 'green' }) {
  const colorMap = {
    gold: 'text-gold',
    white: 'text-white',
    green: 'text-green-400',
  };
  const glowStyle = {
    gold: { boxShadow: '0 0 10px rgba(212, 168, 67, 0.1)' },
    white: {},
    green: { boxShadow: '0 0 10px rgba(74, 222, 128, 0.2)' },
  };

  return (
    <motion.div
      className="stat-card"
      style={glowStyle[accent]}
      whileHover={{ scale: 1.03, y: -2 }}
      transition={{ duration: 0.2 }}
    >
      <p className="text-gray-500 text-xs mb-1.5 relative">{label}</p>
      <p className={`text-xl font-bold ${colorMap[accent]} relative`}>{value}</p>
    </motion.div>
  );
}
