import { useState, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SessionsProvider } from './contexts/SessionsContext';
import Sidebar from './components/layout/Sidebar';
import MobileHeader from './components/layout/MobileHeader';
import Welcome from './pages/Welcome';
import SessionView from './pages/SessionView';
import Products from './pages/Products';
import Login from './pages/Login';
import OfflineBanner from './components/OfflineBanner';

function AuthenticatedApp() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <SessionsProvider>
      <OfflineBanner />
      <div className="min-h-screen bg-navy flex relative overflow-x-clip">
        {/* Ambient background glow */}
        <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-radial pointer-events-none opacity-50" />

        {/* Mobile header */}
        <MobileHeader onToggleSidebar={() => setSidebarOpen(prev => !prev)} />

        {/* Sidebar backdrop (mobile) */}
        <AnimatePresence>
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
              onClick={closeSidebar}
            />
          )}
        </AnimatePresence>

        {/* Sidebar — fixed on all viewports so it stays pinned while the
            body scrolls. Slides off-canvas on mobile when closed. */}
        <aside
          className={`
            fixed top-0 left-0 bottom-0 z-50 w-72 bg-surface/95 backdrop-blur-xl border-r border-white/[0.06]
            transform transition-transform duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)]
            md:translate-x-0
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
        >
          <Sidebar onCloseMobile={closeSidebar} />
        </aside>

        {/* Main content — body-level scroll so position: sticky works
            naturally inside pages. Left margin reserves room for the
            fixed sidebar on desktop. */}
        <main className="flex-1 min-w-0 pt-14 md:pt-0 md:ml-72 relative">
          <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<Welcome />} />
              <Route path="/session/:id" element={<SessionView />} />
              <Route path="/products" element={<Products />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AnimatePresence>
        </main>
      </div>
    </SessionsProvider>
  );
}

function AppRouter() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center">
        <motion.div
          className="flex items-center gap-3 text-gray-500"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <motion.div
            className="w-2 h-2 rounded-full bg-gold"
            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
          Loading...
        </motion.div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <OfflineBanner />
        <Login />
      </>
    );
  }

  return <AuthenticatedApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
