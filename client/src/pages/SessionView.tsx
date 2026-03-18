import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useSessions } from '../contexts/SessionsContext';
import { apiGet, apiPost, apiPatch, apiDelete } from '../utils/api';
import { formatCurrency } from '../utils/currency';
import type { Session, Product, Sale, SessionStats } from '../types';
import PageTransition from '../components/PageTransition';
import HomeButton from '../components/HomeButton';

export default function SessionView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { refreshSessions } = useSessions();

  const [session, setSession] = useState<Session | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [editingSale, setEditingSale] = useState<string | null>(null);
  const [editQty, setEditQty] = useState(1);
  const [editPrice, setEditPrice] = useState('');
  const [showEditSession, setShowEditSession] = useState(false);
  const [editSessionForm, setEditSessionForm] = useState({ name: '', location: '', notes: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const [sessionData, productsData, salesData] = await Promise.all([
        apiGet<Session>(`/sessions/${id}`),
        apiGet<Product[]>('/products'),
        apiGet<Sale[]>(`/sales/session/${id}`),
      ]);
      setSession(sessionData);
      setProducts(productsData);
      setSales(salesData);
    } catch {
      console.error('Failed to load session');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  const selectProduct = (product: Product) => {
    setSelectedProduct(product);
    setPrice(product.default_price.toString());
    setQuantity(1);
  };

  const recordSale = async () => {
    if (!selectedProduct || recording || !id) return;
    setRecording(true);
    try {
      const sale = await apiPost<Sale>('/sales', {
        session_id: id,
        product_id: selectedProduct.id,
        quantity,
        price_charged: parseFloat(price),
        payment_method: paymentMethod,
      });
      setSales(prev => [sale, ...prev]);
      setSession(prev => {
        if (!prev) return prev;
        const stats = prev.stats || { total_revenue: 0, total_units: 0, total_sales: 0, best_seller: null };
        return {
          ...prev,
          stats: {
            ...stats,
            total_revenue: stats.total_revenue + quantity * parseFloat(price),
            total_units: stats.total_units + quantity,
            total_sales: stats.total_sales + 1,
          },
        };
      });
      setSelectedProduct(null);
      setQuantity(1);
      setPrice('');
      setPaymentMethod('cash');
      refreshSessions();
    } catch {
      console.error('Failed to record sale');
    } finally {
      setRecording(false);
    }
  };

  const undoSale = async (saleId: string) => {
    const sale = sales.find(s => s.id === saleId);
    try {
      await apiDelete(`/sales/${saleId}`);
      setSales(prev => prev.filter(s => s.id !== saleId));
      if (sale) {
        setSession(prev => {
          if (!prev) return prev;
          const stats = prev.stats || { total_revenue: 0, total_units: 0, total_sales: 0, best_seller: null };
          return {
            ...prev,
            stats: {
              ...stats,
              total_revenue: stats.total_revenue - sale.quantity * parseFloat(String(sale.price_charged)),
              total_units: stats.total_units - sale.quantity,
              total_sales: stats.total_sales - 1,
            },
          };
        });
        refreshSessions();
      }
    } catch {
      console.error('Failed to undo sale');
    }
  };

  const startEditSale = (sale: Sale) => {
    setEditingSale(sale.id);
    setEditQty(sale.quantity);
    setEditPrice(parseFloat(String(sale.price_charged)).toString());
  };

  const saveEditSale = async (sale: Sale) => {
    try {
      const updated = await apiPatch<Sale>(`/sales/${sale.id}`, {
        quantity: editQty,
        price_charged: parseFloat(editPrice),
      });
      const oldTotal = sale.quantity * parseFloat(String(sale.price_charged));
      const newTotal = editQty * parseFloat(editPrice);
      const oldUnits = sale.quantity;
      const newUnits = editQty;
      setSales(prev => prev.map(s => s.id === sale.id ? { ...s, ...updated } : s));
      setSession(prev => {
        if (!prev) return prev;
        const stats = prev.stats || { total_revenue: 0, total_units: 0, total_sales: 0, best_seller: null };
        return {
          ...prev,
          stats: {
            ...stats,
            total_revenue: stats.total_revenue - oldTotal + newTotal,
            total_units: stats.total_units - oldUnits + newUnits,
          },
        };
      });
      setEditingSale(null);
      refreshSessions();
    } catch {
      console.error('Failed to edit sale');
    }
  };

  const closeSession = async () => {
    if (!id) return;
    await apiPatch(`/sessions/${id}`, { status: 'closed' });
    fetchData();
    refreshSessions();
  };

  const reopenSession = async () => {
    if (!id) return;
    await apiPatch(`/sessions/${id}`, { status: 'active' });
    fetchData();
    refreshSessions();
  };

  const deleteSession = async () => {
    if (!id) return;
    try {
      await apiDelete(`/sessions/${id}`);
      await refreshSessions();
      navigate('/');
    } catch {
      console.error('Failed to delete session');
    }
  };

  const saveSessionEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    await apiPatch(`/sessions/${id}`, {
      name: editSessionForm.name,
      location: editSessionForm.location || null,
      notes: editSessionForm.notes || null,
    });
    setShowEditSession(false);
    fetchData();
    refreshSessions();
  };

  const openEditSession = () => {
    if (!session) return;
    setEditSessionForm({
      name: session.name,
      location: session.location || '',
      notes: session.notes || '',
    });
    setShowEditSession(true);
  };

  const toggleCardFee = async () => {
    if (!id || !session) return;
    const newValue = !session.card_fee_applied;
    await apiPatch(`/sessions/${id}`, { card_fee_applied: newValue });
    setSession(prev => prev ? { ...prev, card_fee_applied: newValue } : prev);
    refreshSessions();
  };

  const exportSession = (format: string) => {
    const token = localStorage.getItem('token');
    window.open(`/api/export/${id}?format=${format}&token=${token}`, '_blank');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] gap-3 text-gray-500">
        <motion.div
          className="w-2 h-2 rounded-full bg-gold/50"
          animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity }}
        />
        Loading...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-gray-500">
        <p className="mb-4">Session not found</p>
        <HomeButton />
      </div>
    );
  }

  const isActive = session.status === 'active';
  const stats: SessionStats = session.stats || { total_revenue: 0, total_units: 0, total_sales: 0, best_seller: null };
  const feeRate = parseFloat(String(session.card_fee_rate)) || 1.69;
  const cardRevenue = sales
    .filter(s => s.payment_method === 'card')
    .reduce((sum, s) => sum + s.quantity * parseFloat(String(s.price_charged)), 0);
  const totalCardFees = session.card_fee_applied ? cardRevenue * (feeRate / 100) : 0;
  const netRevenue = stats.total_revenue - totalCardFees;

  // Group products by category
  const categories: Record<string, Product[]> = {};
  products.forEach(p => {
    const cat = p.category || 'Other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(p);
  });

  return (
    <PageTransition>
      <div className="max-w-6xl mx-auto px-4 py-6 md:px-8">
        {/* Home Button */}
        <div className="mb-4">
          <HomeButton />
        </div>

        {/* Session Header */}
        <motion.div
          className="flex items-start justify-between mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{session.name}</h1>
              <button onClick={openEditSession} className="text-gray-600 hover:text-gold transition-colors duration-200" title="Edit session details">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
              {isActive && (
                <motion.span
                  className="text-xs bg-green-500/10 text-green-400 px-2.5 py-0.5 rounded-full border border-green-500/20"
                  animate={{ boxShadow: ['0 0 0 rgba(74,222,128,0)', '0 0 12px rgba(74,222,128,0.15)', '0 0 0 rgba(74,222,128,0)'] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  Live
                </motion.span>
              )}
            </div>
            <p className="text-gray-500 text-sm mt-1">
              {session.location && `${session.location} \u00b7 `}
              {new Date(session.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
        </motion.div>

        {/* Edit Session Modal */}
        <AnimatePresence>
          {showEditSession && (
            <motion.div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEditSession(false)}
            >
              <motion.form
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.2 }}
                onClick={e => e.stopPropagation()}
                onSubmit={saveSessionEdit}
                className="card w-full max-w-md space-y-3"
              >
                <h3 className="font-semibold text-gold text-sm">Edit Session Details</h3>
                <input
                  type="text"
                  placeholder="Session name"
                  value={editSessionForm.name}
                  onChange={e => setEditSessionForm({ ...editSessionForm, name: e.target.value })}
                  className="w-full"
                  autoFocus
                />
                <input
                  type="text"
                  placeholder="Location"
                  value={editSessionForm.location}
                  onChange={e => setEditSessionForm({ ...editSessionForm, location: e.target.value })}
                  className="w-full"
                />
                <textarea
                  placeholder="Notes"
                  value={editSessionForm.notes}
                  onChange={e => setEditSessionForm({ ...editSessionForm, notes: e.target.value })}
                  className="w-full"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button type="submit" className="btn-gold flex-1">Save</button>
                  <button type="button" onClick={() => setShowEditSession(false)} className="btn-outline flex-1">Cancel</button>
                </div>
              </motion.form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {[
            {
              label: session.card_fee_applied ? 'Net Revenue' : 'Revenue',
              value: formatCurrency(session.card_fee_applied ? netRevenue : stats.total_revenue),
              color: 'text-gold',
              glow: { boxShadow: '0 0 10px rgba(212, 168, 67, 0.1)' },
            },
            { label: 'Units Sold', value: String(stats.total_units), color: 'text-white', glow: {} },
            { label: 'Sales', value: String(stats.total_sales), color: 'text-white', glow: {} },
            { label: 'Best Seller', value: stats.best_seller || '-', color: 'text-white', glow: {}, truncate: true },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              className="stat-card"
              style={stat.glow}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
              whileHover={{ scale: 1.02, y: -2 }}
            >
              <p className="text-gray-500 text-xs mb-1.5 relative">{stat.label}</p>
              <p className={`${stat.truncate ? 'text-sm' : 'text-xl'} font-bold ${stat.color} relative ${stat.truncate ? 'truncate' : ''}`}>
                {stat.value}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Card Fee Info Bar */}
        <AnimatePresence>
          {session.card_fee_applied && cardRevenue > 0 && (
            <motion.div
              className="mb-8 rounded-2xl p-3 flex items-center justify-between text-sm"
              style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.15)' }}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex items-center gap-3">
                <span className="text-blue-400 text-xs font-medium px-2 py-0.5 rounded-lg" style={{ background: 'rgba(59, 130, 246, 0.15)' }}>
                  SumUp {feeRate}%
                </span>
                <span className="text-gray-400">
                  Card fees: <span className="text-red-400 font-medium">-{formatCurrency(totalCardFees)}</span>
                </span>
              </div>
              <div className="text-gray-500 text-xs">
                Gross: {formatCurrency(stats.total_revenue)}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!session.card_fee_applied && <div className="mb-4" />}

        {/* Two-Column Layout on Desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: Product Grid + Sale Form */}
          <div>
            {/* Product Selection (only when active) */}
            {isActive && !selectedProduct && (
              <motion.div
                className="mb-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
              >
                <h2 className="section-title text-gold mb-3">Tap to Sell</h2>
                {Object.entries(categories).map(([cat, prods]) => (
                  <div key={cat} className="mb-4">
                    <p className="section-title text-gray-600 mb-2">{cat}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {prods.map((p, i) => (
                        <motion.button
                          key={p.id}
                          onClick={() => selectProduct(p)}
                          className="card-hover text-left"
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: i * 0.04, duration: 0.3 }}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.97 }}
                        >
                          <p className="font-medium text-white text-sm">{p.name}</p>
                          <p className="text-gold text-sm">{formatCurrency(parseFloat(String(p.default_price)))}</p>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                ))}
                {products.length === 0 && (
                  <p className="text-gray-600 text-sm">No products yet. Add some from the Products page.</p>
                )}
              </motion.div>
            )}

            {/* Sale Form */}
            <AnimatePresence>
              {isActive && selectedProduct && (
                <motion.div
                  className="card mb-6 space-y-4"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-white">{selectedProduct.name}</h3>
                    <button onClick={() => setSelectedProduct(null)} className="text-gray-500 hover:text-white text-sm transition-colors">
                      Cancel
                    </button>
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 block mb-1">Quantity</label>
                      <div className="flex items-center gap-2">
                        <motion.button
                          onClick={() => setQuantity(Math.max(1, quantity - 1))}
                          className="btn-outline px-3 py-2 text-lg"
                          whileTap={{ scale: 0.9 }}
                        >-</motion.button>
                        <input
                          type="number"
                          value={quantity}
                          onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-16 text-center text-lg"
                          min="1"
                        />
                        <motion.button
                          onClick={() => setQuantity(quantity + 1)}
                          className="btn-outline px-3 py-2 text-lg"
                          whileTap={{ scale: 0.9 }}
                        >+</motion.button>
                      </div>
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 block mb-1">Price Each</label>
                      <input
                        type="number"
                        value={price}
                        onChange={e => setPrice(e.target.value)}
                        className="w-full text-lg"
                        step="0.01"
                        min="0"
                      />
                      <p className="text-xs text-gray-600 mt-0.5">
                        Default: {formatCurrency(parseFloat(String(selectedProduct.default_price)))}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
                    <span className="text-gray-400">Total</span>
                    <span className="text-xl font-bold text-gold">
                      {formatCurrency(quantity * (parseFloat(price) || 0))}
                    </span>
                  </div>

                  {/* Payment Method Toggle */}
                  <div>
                    <label className="text-xs text-gray-500 block mb-1.5">Payment Method</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('cash')}
                        className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                          paymentMethod === 'cash'
                            ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                            : 'text-gray-400 border border-white/[0.06] hover:border-white/10'
                        }`}
                      >
                        Cash
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('card')}
                        className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                          paymentMethod === 'card'
                            ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                            : 'text-gray-400 border border-white/[0.06] hover:border-white/10'
                        }`}
                      >
                        Card
                      </button>
                    </div>
                  </div>

                  <motion.button
                    onClick={recordSale}
                    disabled={recording || !price || parseFloat(price) <= 0}
                    className="btn-gold w-full text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {recording ? (
                      <span className="flex items-center justify-center gap-2">
                        <motion.span
                          className="w-2 h-2 rounded-full bg-navy"
                          animate={{ scale: [1, 1.3, 1] }}
                          transition={{ duration: 0.6, repeat: Infinity }}
                        />
                        Recording...
                      </span>
                    ) : 'Record Sale'}
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Card Fee Toggle */}
            <div className="mb-4">
              <button
                onClick={toggleCardFee}
                className={`w-full py-2.5 px-4 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-between ${
                  session.card_fee_applied
                    ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                    : 'text-gray-400 border border-white/[0.06] hover:border-blue-500/20 hover:text-blue-400'
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  {session.card_fee_applied ? 'Card Fees Applied' : 'Apply Card Fees'}
                  <span className="text-xs text-gray-500">({feeRate}%)</span>
                </span>
                {session.card_fee_applied && (
                  <span className="text-xs text-gray-500">Click to remove</span>
                )}
              </button>
            </div>

            {/* Session Actions */}
            <div className="flex flex-wrap gap-2 mb-6">
              {isActive ? (
                <button onClick={closeSession} className="btn-outline flex-1 text-sm">
                  Close Session
                </button>
              ) : (
                <button onClick={reopenSession} className="btn-outline flex-1 text-sm">
                  Reopen Session
                </button>
              )}
              <motion.button
                onClick={() => exportSession('xlsx')}
                className="btn-gold flex-1 text-sm"
                whileTap={{ scale: 0.97 }}
              >
                Export XLSX
              </motion.button>
              <button onClick={() => exportSession('csv')} className="btn-outline text-sm px-3">
                CSV
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="btn-outline text-sm px-3 text-red-400 border-red-400/20 hover:border-red-400/50 hover:text-red-300 hover:bg-red-400/5"
              >
                Delete
              </button>
            </div>

            {/* Delete Confirmation */}
            <AnimatePresence>
              {confirmDelete && (
                <motion.div
                  className="card mb-6 border-red-400/20"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <p className="text-sm text-gray-300 mb-3">Are you sure you want to delete this session? This cannot be undone.</p>
                  <div className="flex gap-2">
                    <button onClick={deleteSession} className="bg-red-500/80 hover:bg-red-500 text-white font-semibold px-4 py-2 rounded-xl flex-1 text-sm transition-colors">
                      Yes, Delete
                    </button>
                    <button onClick={() => setConfirmDelete(false)} className="btn-outline flex-1 text-sm">
                      Cancel
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right Column: Sales Log */}
          <div>
            {sales.length > 0 && (
              <div>
                <h2 className="section-title text-gray-500 mb-3">
                  Sales Log ({sales.length})
                </h2>
                <div className="space-y-2">
                  {sales.map((sale, i) => (
                    <motion.div
                      key={sale.id}
                      className="card"
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.3 }}
                    >
                      {editingSale === sale.id ? (
                        <div className="space-y-3">
                          <p className="font-medium text-white text-sm">{sale.product_name}</p>
                          <div className="flex gap-3">
                            <div className="flex-1">
                              <label className="text-xs text-gray-500 block mb-1">Qty</label>
                              <input
                                type="number"
                                value={editQty}
                                onChange={e => setEditQty(Math.max(1, parseInt(e.target.value) || 1))}
                                className="w-full text-sm"
                                min="1"
                              />
                            </div>
                            <div className="flex-1">
                              <label className="text-xs text-gray-500 block mb-1">Price</label>
                              <input
                                type="number"
                                value={editPrice}
                                onChange={e => setEditPrice(e.target.value)}
                                className="w-full text-sm"
                                step="0.01"
                                min="0"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => saveEditSale(sale)} className="btn-gold flex-1 text-xs !py-2">Save</button>
                            <button onClick={() => setEditingSale(null)} className="btn-outline flex-1 text-xs !py-2">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between group">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-white text-sm">{sale.product_name}</p>
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${
                                sale.payment_method === 'card'
                                  ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                                  : 'bg-green-500/15 text-green-400 border border-green-500/20'
                              }`}>
                                {sale.payment_method === 'card' ? 'CARD' : 'CASH'}
                              </span>
                            </div>
                            <p className="text-gray-500 text-xs">
                              {sale.quantity}x @ {formatCurrency(parseFloat(String(sale.price_charged)))}
                              {' \u00b7 '}
                              {new Date(sale.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-gold text-sm">
                              {formatCurrency(sale.quantity * parseFloat(String(sale.price_charged)))}
                            </span>
                            {isActive && (
                              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                <button
                                  onClick={() => startEditSale(sale)}
                                  className="text-gray-400 hover:text-gold text-xs transition-colors"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => undoSale(sale.id)}
                                  className="text-red-400/70 hover:text-red-400 text-xs transition-colors"
                                  title="Undo sale"
                                >
                                  Undo
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {sales.length === 0 && (
              <div className="text-center text-gray-500 py-12">
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                  <svg className="w-7 h-7 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p className="text-sm">No sales recorded yet</p>
                {isActive && <p className="text-xs mt-1 text-gray-600">Select a product to record your first sale</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
