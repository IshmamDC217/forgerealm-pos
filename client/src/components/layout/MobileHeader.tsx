import { useNavigate, useLocation } from 'react-router-dom';

interface MobileHeaderProps {
  onToggleSidebar: () => void;
}

export default function MobileHeader({ onToggleSidebar }: MobileHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-navy/80 backdrop-blur-xl border-b border-white/[0.06] px-4 py-3 flex items-center">
      <button
        onClick={onToggleSidebar}
        className="text-gray-400 hover:text-gold transition-colors duration-200 p-1 -ml-1"
        aria-label="Toggle sidebar"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <button
        onClick={() => navigate('/')}
        className="flex-1 flex items-center justify-center gap-2"
      >
        <img src="/logo.png" alt="ForgeRealm" className="w-7 h-7 rounded-md object-cover" />
        <h1
          className="text-lg font-bold"
          style={{ backgroundImage: 'linear-gradient(135deg, #d4a843, #e4c373)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontFamily: "'Sora', sans-serif" }}
        >
          ForgeRealm
        </h1>
      </button>
      {!isHome ? (
        <button
          onClick={() => navigate('/')}
          className="text-gray-400 hover:text-gold transition-colors duration-200 p-1"
          aria-label="Go home"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </button>
      ) : (
        <div className="w-7" />
      )}
    </header>
  );
}
