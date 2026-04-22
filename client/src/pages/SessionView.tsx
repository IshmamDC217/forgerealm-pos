import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useSessions } from '../contexts/SessionsContext';
import { apiGet, apiPost, apiPatch, apiDelete, apiPut } from '../utils/api';
import { usePolling } from '../utils/usePolling';
import { API_BASE } from '../utils/config';
import { formatCurrency } from '../utils/currency';
import type { Session, Product, Sale, SessionStats, StockItem, StockSummary, StockCarryover } from '../types';
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

  // Stock state
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [showStockSetup, setShowStockSetup] = useState(false);
  const [stockForm, setStockForm] = useState<Record<string, number>>({});
  const [savingStock, setSavingStock] = useState(false);
  const [carryoverInfo, setCarryoverInfo] = useState<StockCarryover | null>(null);
  const [loadingCarryover, setLoadingCarryover] = useState(false);
  const [showStockSummary, setShowStockSummary] = useState(false);
  const [stockSummary, setStockSummary] = useState<StockSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [showFinalCount, setShowFinalCount] = useState(false);
  const [finalCountForm, setFinalCountForm] = useState<Record<string, number>>({});
  const [savingFinalCount, setSavingFinalCount] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const [sessionData, productsData, salesData, stockData] = await Promise.all([
        apiGet<Session>(`/sessions/${id}`),
        apiGet<Product[]>('/products'),
        apiGet<Sale[]>(`/sales/session/${id}`),
        apiGet<StockItem[]>(`/stock/session/${id}`),
      ]);
      setSession(sessionData);
      setProducts(productsData);
      setSales(salesData);
      setStockItems(stockData);
    } catch {
      console.error('Failed to load session');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // 5s poll while the session is open. The server is the source of truth —
  // each poll re-fetches session stats, sales, stock so two clients (me & Tobi)
  // converge within 5s of either recording a sale. Polling pauses when the tab
  // is hidden and fires immediately on tab focus.
  usePolling(fetchData, { intervalMs: 5000, enabled: !!id });

  // Build a map of product_id -> remaining stock
  const stockMap = useMemo(() => {
    const map: Record<string, { initial: number; sold: number; remaining: number }> = {};
    for (const item of stockItems) {
      const sold = parseInt(String(item.total_sold)) || 0;
      const initial = parseInt(String(item.initial_quantity)) || 0;
      map[item.product_id] = { initial, sold, remaining: initial - sold };
    }
    return map;
  }, [stockItems]);

  const hasStock = stockItems.length > 0;

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
      // Update stock sold count locally
      if (stockMap[selectedProduct.id]) {
        setStockItems(prev => prev.map(si =>
          si.product_id === selectedProduct.id
            ? { ...si, total_sold: parseInt(String(si.total_sold)) + quantity }
            : si
        ));
      }
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
        // Update stock sold count locally
        if (stockMap[sale.product_id]) {
          setStockItems(prev => prev.map(si =>
            si.product_id === sale.product_id
              ? { ...si, total_sold: Math.max(0, parseInt(String(si.total_sold)) - sale.quantity) }
              : si
          ));
        }
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
      // Update stock sold count locally
      if (stockMap[sale.product_id]) {
        setStockItems(prev => prev.map(si =>
          si.product_id === sale.product_id
            ? { ...si, total_sold: parseInt(String(si.total_sold)) - oldUnits + newUnits }
            : si
        ));
      }
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
    window.open(`${API_BASE}/api/export/${id}?format=${format}&token=${token}`, '_blank');
  };

  // Stock setup handlers
  const openStockSetup = async () => {
    const form: Record<string, number> = {};
    for (const p of products) {
      const existing = stockItems.find(si => si.product_id === p.id);
      form[p.id] = existing ? parseInt(String(existing.initial_quantity)) : 0;
    }
    setStockForm(form);
    setShowStockSetup(true);

    // Fetch carryover info in the background so the button can be enabled
    if (id) {
      setLoadingCarryover(true);
      try {
        const data = await apiGet<StockCarryover>(`/stock/carryover/${id}`);
        setCarryoverInfo(data);
      } catch {
        setCarryoverInfo(null);
      } finally {
        setLoadingCarryover(false);
      }
    }
  };

  const applyCarryover = () => {
    if (!carryoverInfo || !carryoverInfo.previous_session) return;
    setStockForm(prev => {
      const next = { ...prev };
      // Reset everything to 0 first so old values don't linger
      for (const p of products) {
        next[p.id] = 0;
      }
      // Then set carried-over remaining quantities
      for (const item of carryoverInfo.items) {
        next[item.product_id] = parseInt(String(item.remaining)) || 0;
      }
      return next;
    });
  };

  const saveStock = async () => {
    if (!id) return;
    setSavingStock(true);
    try {
      const items = Object.entries(stockForm).map(([product_id, initial_quantity]) => ({
        product_id,
        initial_quantity,
      }));
      const updated = await apiPut<StockItem[]>(`/stock/session/${id}`, { items });
      setStockItems(updated);
      setShowStockSetup(false);
    } catch {
      console.error('Failed to save stock');
    } finally {
      setSavingStock(false);
    }
  };

  const openStockSummary = async () => {
    if (!id) return;
    setShowStockSummary(true);
    setLoadingSummary(true);
    try {
      const summary = await apiGet<StockSummary>(`/stock/session/${id}/summary`);
      setStockSummary(summary);
    } catch {
      console.error('Failed to load stock summary');
    } finally {
      setLoadingSummary(false);
    }
  };

  // Final count (end-of-day reconciliation) handlers
  const openFinalCount = () => {
    const form: Record<string, number> = {};
    for (const si of stockItems) {
      // Default to current final_quantity if already set, otherwise start at initial
      form[si.product_id] = si.final_quantity !== null
        ? parseInt(String(si.final_quantity))
        : parseInt(String(si.initial_quantity));
    }
    setFinalCountForm(form);
    setShowFinalCount(true);
  };

  const saveFinalCount = async () => {
    if (!id) return;
    setSavingFinalCount(true);
    try {
      const items = Object.entries(finalCountForm).map(([product_id, final_quantity]) => ({
        product_id,
        final_quantity,
      }));
      const updated = await apiPut<StockItem[]>(`/stock/session/${id}/final`, { items });
      setStockItems(updated);
      setShowFinalCount(false);
    } catch {
      console.error('Failed to save final count');
    } finally {
      setSavingFinalCount(false);
    }
  };

  const hasFinalCounts = stockItems.some(si => si.final_quantity !== null);

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

  // Group stock form products by category for the setup modal
  const stockCategories: Record<string, Product[]> = {};
  products.forEach(p => {
    const cat = p.category || 'Other';
    if (!stockCategories[cat]) stockCategories[cat] = [];
    stockCategories[cat].push(p);
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

        {/* Stock Setup Modal */}
        <AnimatePresence>
          {showStockSetup && (
            <motion.div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowStockSetup(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.2 }}
                onClick={e => e.stopPropagation()}
                className="card w-full max-w-lg max-h-[80vh] flex flex-col"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gold text-sm">Set Starting Stock</h3>
                    <p className="text-xs text-gray-500 mt-0.5">These values <span className="text-gray-400">replace</span> any existing stock — they don't add to it.</p>
                  </div>
                  <button
                    onClick={() => {
                      const newForm: Record<string, number> = {};
                      products.forEach(p => { newForm[p.id] = 0; });
                      setStockForm(newForm);
                    }}
                    className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                  >
                    Clear All
                  </button>
                </div>

                {/* Carry over from previous session */}
                {carryoverInfo?.previous_session && (
                  <div className="mb-3 p-2.5 rounded-xl bg-gold/5 border border-gold/20 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-gold font-medium truncate">Carry over from previous session</p>
                      <p className="text-[11px] text-gray-500 truncate">
                        {carryoverInfo.previous_session.name} · {carryoverInfo.items.reduce((sum, i) => sum + (parseInt(String(i.remaining)) || 0), 0)} units remaining
                      </p>
                    </div>
                    <motion.button
                      type="button"
                      onClick={applyCarryover}
                      className="btn-outline !px-3 !py-1.5 text-xs whitespace-nowrap"
                      whileTap={{ scale: 0.96 }}
                    >
                      Apply
                    </motion.button>
                  </div>
                )}
                {loadingCarryover && !carryoverInfo && (
                  <div className="mb-3 p-2 rounded-xl bg-white/[0.02] border border-white/[0.06] text-[11px] text-gray-500 text-center">
                    Checking for previous session…
                  </div>
                )}

                <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-4">
                  {Object.entries(stockCategories).map(([cat, prods]) => (
                    <div key={cat}>
                      <p className="section-title text-gray-600 mb-2">{cat}</p>
                      <div className="space-y-1.5">
                        {prods.map(p => (
                          <div key={p.id} className="flex items-center justify-between py-1.5 px-2 rounded-xl hover:bg-white/[0.03] transition-colors">
                            <span className="text-sm text-white flex-1">{p.name}</span>
                            <div className="flex items-center gap-2">
                              <motion.button
                                type="button"
                                onClick={() => setStockForm(f => ({ ...f, [p.id]: Math.max(0, (f[p.id] || 0) - 1) }))}
                                className="btn-outline !px-2 !py-1 text-sm"
                                whileTap={{ scale: 0.9 }}
                              >-</motion.button>
                              <input
                                type="number"
                                value={stockForm[p.id] || 0}
                                onChange={e => setStockForm(f => ({ ...f, [p.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                className="w-14 text-center text-sm"
                                min="0"
                              />
                              <motion.button
                                type="button"
                                onClick={() => setStockForm(f => ({ ...f, [p.id]: (f[p.id] || 0) + 1 }))}
                                className="btn-outline !px-2 !py-1 text-sm"
                                whileTap={{ scale: 0.9 }}
                              >+</motion.button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 mt-4 pt-3 border-t border-white/[0.06]">
                  <motion.button
                    onClick={saveStock}
                    disabled={savingStock}
                    className="btn-gold flex-1 disabled:opacity-50"
                    whileTap={{ scale: 0.97 }}
                  >
                    {savingStock ? 'Saving...' : 'Save Stock'}
                  </motion.button>
                  <button onClick={() => setShowStockSetup(false)} className="btn-outline flex-1">Cancel</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stock Summary Modal */}
        <AnimatePresence>
          {showStockSummary && (
            <motion.div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowStockSummary(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.2 }}
                onClick={e => e.stopPropagation()}
                className="card w-full max-w-2xl max-h-[80vh] flex flex-col"
              >
                <div className="mb-4">
                  <h3 className="font-semibold text-gold text-sm">Stock vs Sales Summary</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {stockSummary?.totals.has_final_counts
                      ? 'Based on your end-of-day stock count'
                      : 'Based on POS sales recorded during the session'}
                  </p>
                </div>

                {loadingSummary ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
                    <motion.div
                      className="w-2 h-2 rounded-full bg-gold/50"
                      animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    />
                    Loading...
                  </div>
                ) : stockSummary ? (
                  <div className="overflow-y-auto flex-1">
                    {/* Method badge */}
                    {stockSummary.totals.has_final_counts && (
                      <div className="mb-3 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium inline-flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Reconciled from final stock count
                      </div>
                    )}

                    {/* Totals cards */}
                    <div className="grid grid-cols-4 gap-2 mb-4">
                      {[
                        { label: 'Brought', value: String(stockSummary.totals.initial), color: 'text-white' },
                        { label: 'Sold', value: String(stockSummary.totals.sold), color: 'text-green-400' },
                        { label: 'Remaining', value: String(stockSummary.totals.remaining), color: 'text-orange-400' },
                        { label: 'Revenue', value: formatCurrency(stockSummary.totals.revenue), color: 'text-gold' },
                      ].map((stat) => (
                        <div key={stat.label} className="stat-card">
                          <p className="text-gray-500 text-xs mb-1">{stat.label}</p>
                          <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Per-product table */}
                    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-white/[0.03]">
                            <th className="text-left py-2 px-3 text-gray-500 font-medium text-xs">Product</th>
                            <th className="text-center py-2 px-3 text-gray-500 font-medium text-xs">Brought</th>
                            <th className="text-center py-2 px-3 text-gray-500 font-medium text-xs">Sold</th>
                            <th className="text-center py-2 px-3 text-gray-500 font-medium text-xs">Left</th>
                            <th className="text-right py-2 px-3 text-gray-500 font-medium text-xs">Revenue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stockSummary.items.map((item, i) => {
                            const initial = parseInt(String(item.initial_quantity));
                            const sold = item.sold;
                            const remaining = item.remaining;
                            const revenue = parseFloat(String(item.total_revenue));
                            const soldPercent = initial > 0 ? Math.round((sold / initial) * 100) : 0;
                            const hasFinal = item.final_quantity !== null;
                            return (
                              <tr key={item.product_id} className={i % 2 === 0 ? '' : 'bg-white/[0.02]'}>
                                <td className="py-2 px-3">
                                  <span className="text-white">{item.product_name}</span>
                                  <span className="text-gray-600 text-xs ml-1.5">{item.product_category}</span>
                                </td>
                                <td className="text-center py-2 px-3 text-gray-400">{initial}</td>
                                <td className="text-center py-2 px-3">
                                  <span className="text-green-400">{sold}</span>
                                  <span className="text-gray-600 text-xs ml-1">({soldPercent}%)</span>
                                  {hasFinal && item.sold_by_pos > 0 && item.sold_by_count !== item.sold_by_pos && (
                                    <span className="text-gray-600 text-[10px] block">
                                      POS: {item.sold_by_pos}
                                    </span>
                                  )}
                                </td>
                                <td className="text-center py-2 px-3">
                                  <span className={remaining === 0 ? 'text-green-400 font-medium' : remaining < 0 ? 'text-red-400 font-medium' : 'text-orange-400'}>
                                    {remaining}
                                  </span>
                                </td>
                                <td className="text-right py-2 px-3 text-gold">{formatCurrency(revenue)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Sell-through rate */}
                    {stockSummary.totals.initial > 0 && (
                      <div className="mt-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-between">
                        <span className="text-gray-400 text-sm">Sell-through Rate</span>
                        <span className="text-xl font-bold text-gold">
                          {Math.round((stockSummary.totals.sold / stockSummary.totals.initial) * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm py-8 text-center">No stock data available</p>
                )}

                <div className="mt-4 pt-3 border-t border-white/[0.06]">
                  <button onClick={() => setShowStockSummary(false)} className="btn-outline w-full">Close</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Final Count Modal */}
        <AnimatePresence>
          {showFinalCount && (
            <motion.div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFinalCount(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.2 }}
                onClick={e => e.stopPropagation()}
                className="card w-full max-w-lg max-h-[80vh] flex flex-col"
              >
                <div className="mb-4">
                  <h3 className="font-semibold text-emerald-400 text-sm">Count Remaining Stock</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Enter how many of each product you have left. The system will calculate what was sold.
                  </p>
                </div>

                <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-4">
                  {(() => {
                    const cats: Record<string, StockItem[]> = {};
                    stockItems.forEach(si => {
                      const cat = si.product_category || 'Other';
                      if (!cats[cat]) cats[cat] = [];
                      cats[cat].push(si);
                    });
                    return Object.entries(cats).map(([cat, items]) => (
                      <div key={cat}>
                        <p className="section-title text-gray-600 mb-2">{cat}</p>
                        <div className="space-y-1.5">
                          {items.map(si => {
                            const initial = parseInt(String(si.initial_quantity));
                            const current = finalCountForm[si.product_id] ?? initial;
                            const sold = initial - current;
                            return (
                              <div key={si.product_id} className="flex items-center justify-between py-1.5 px-2 rounded-xl hover:bg-white/[0.03] transition-colors">
                                <div className="flex-1">
                                  <span className="text-sm text-white">{si.product_name}</span>
                                  <span className="text-xs text-gray-600 ml-2">started: {initial}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <motion.button
                                    type="button"
                                    onClick={() => setFinalCountForm(f => ({ ...f, [si.product_id]: Math.max(0, (f[si.product_id] ?? initial) - 1) }))}
                                    className="btn-outline !px-2 !py-1 text-sm"
                                    whileTap={{ scale: 0.9 }}
                                  >-</motion.button>
                                  <input
                                    type="number"
                                    value={finalCountForm[si.product_id] ?? initial}
                                    onChange={e => setFinalCountForm(f => ({ ...f, [si.product_id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                    className="w-14 text-center text-sm"
                                    min="0"
                                  />
                                  <motion.button
                                    type="button"
                                    onClick={() => setFinalCountForm(f => ({ ...f, [si.product_id]: (f[si.product_id] ?? initial) + 1 }))}
                                    className="btn-outline !px-2 !py-1 text-sm"
                                    whileTap={{ scale: 0.9 }}
                                  >+</motion.button>
                                  {sold > 0 && (
                                    <span className="text-green-400 text-xs font-medium w-16 text-right">
                                      {sold} sold
                                    </span>
                                  )}
                                  {sold === 0 && (
                                    <span className="text-gray-600 text-xs w-16 text-right">-</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ));
                  })()}
                </div>

                {/* Live total preview */}
                <div className="mt-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-between text-sm">
                  <span className="text-gray-400">Total sold by count:</span>
                  <span className="text-green-400 font-bold text-lg">
                    {stockItems.reduce((sum, si) => {
                      const initial = parseInt(String(si.initial_quantity));
                      const final_ = finalCountForm[si.product_id] ?? initial;
                      return sum + Math.max(0, initial - final_);
                    }, 0)}
                  </span>
                </div>

                <div className="flex gap-2 mt-4 pt-3 border-t border-white/[0.06]">
                  <motion.button
                    onClick={saveFinalCount}
                    disabled={savingFinalCount}
                    className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all duration-200 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50"
                    whileTap={{ scale: 0.97 }}
                  >
                    {savingFinalCount ? 'Saving...' : 'Save Final Count'}
                  </motion.button>
                  <button onClick={() => setShowFinalCount(false)} className="btn-outline flex-1">Cancel</button>
                </div>
              </motion.div>
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
                      {prods.map((p, i) => {
                        const stock = stockMap[p.id];
                        const outOfStock = stock && stock.remaining <= 0;
                        return (
                          <motion.button
                            key={p.id}
                            onClick={() => !outOfStock && selectProduct(p)}
                            className={`card-hover text-left relative ${outOfStock ? 'opacity-40 cursor-not-allowed' : ''}`}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: outOfStock ? 0.4 : 1, scale: 1 }}
                            transition={{ delay: i * 0.04, duration: 0.3 }}
                            whileHover={outOfStock ? {} : { scale: 1.02 }}
                            whileTap={outOfStock ? {} : { scale: 0.97 }}
                          >
                            <p className="font-medium text-white text-sm">{p.name}</p>
                            <div className="flex items-center justify-between">
                              <p className="text-gold text-sm">{formatCurrency(parseFloat(String(p.default_price)))}</p>
                              {stock && (
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded-md ${
                                  stock.remaining <= 0
                                    ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                                    : stock.remaining <= 2
                                    ? 'bg-orange-500/15 text-orange-400 border border-orange-500/20'
                                    : 'bg-green-500/15 text-green-400 border border-green-500/20'
                                }`}>
                                  {stock.remaining <= 0 ? 'Sold out' : `${stock.remaining} left`}
                                </span>
                              )}
                            </div>
                          </motion.button>
                        );
                      })}
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

                  {/* Stock warning */}
                  {stockMap[selectedProduct.id] && (
                    <div className={`text-xs px-2 py-1 rounded-lg ${
                      stockMap[selectedProduct.id].remaining <= 0
                        ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                        : stockMap[selectedProduct.id].remaining <= 2
                        ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                        : 'bg-white/[0.03] text-gray-400 border border-white/[0.06]'
                    }`}>
                      Stock: {stockMap[selectedProduct.id].remaining} remaining of {stockMap[selectedProduct.id].initial}
                    </div>
                  )}

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

            {/* Stock Setup Button */}
            <div className="mb-3">
              <button
                onClick={openStockSetup}
                className={`w-full py-2.5 px-4 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-between ${
                  hasStock
                    ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                    : 'text-gray-400 border border-white/[0.06] hover:border-purple-500/20 hover:text-purple-400'
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  {hasStock ? 'Edit Starting Stock' : 'Set Starting Stock'}
                </span>
                {hasStock && (
                  <span className="text-xs text-gray-500">
                    {stockItems.reduce((sum, si) => sum + parseInt(String(si.initial_quantity)), 0)} items tracked
                  </span>
                )}
              </button>
            </div>

            {/* Count Remaining Stock Button (only when stock is set) */}
            {hasStock && (
              <div className="mb-3">
                <button
                  onClick={openFinalCount}
                  className={`w-full py-2.5 px-4 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-between ${
                    hasFinalCounts
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'text-gray-400 border border-white/[0.06] hover:border-emerald-500/20 hover:text-emerald-400'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    {hasFinalCounts ? 'Edit Final Stock Count' : 'Count Remaining Stock'}
                  </span>
                  {hasFinalCounts && (
                    <span className="text-xs text-gray-500">Counted</span>
                  )}
                </button>
              </div>
            )}

            {/* Stock Summary Button (only shown when stock is set) */}
            {hasStock && (
              <div className="mb-3">
                <button
                  onClick={openStockSummary}
                  className="w-full py-2.5 px-4 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-between bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/15"
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Stock vs Sales Summary
                  </span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}

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
