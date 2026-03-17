import { Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import SessionView from './pages/SessionView';
import Products from './pages/Products';

export default function App() {
  return (
    <div className="min-h-screen bg-navy">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/session/:id" element={<SessionView />} />
        <Route path="/products" element={<Products />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
