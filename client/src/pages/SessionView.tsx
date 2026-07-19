import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useSessions } from '../contexts/SessionsContext';
import { apiGet, apiPost, apiPatch, apiDelete } from '../utils/api';
import { usePolling } from '../utils/usePolling';
import { API_BASE } from '../utils/config';
import { formatCurrency } from '../utils/currency';
import type { Session, Product, Sale, SessionStats, StockItem, GlobalStockItem } from '../types';
import PageTransition from '../components/PageTransition';
import HomeButton from '../components/HomeButton';
import StallComparison from '../components/StallComparison';
import PendingAllocator from '../components/PendingAllocator';

export default function SessionView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { sessions, refreshSessions } = useSessions();

  const [session, setSession] = useState<Session | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  // Cart for multi-item checkout: keyed by product_id.
  const [cart, setCart] = useState<Record<string, { quantity: number; price: number }>>({});
  const [showCheckout, setShowCheckout] = useState(false);
  const [cartPayment, setCartPayment] = useState<'cash' | 'card'>('cash');
  const [checkoutRecording, setCheckoutRecording] = useState(false);
  const [editingSale, setEditingSale] = useState<string | null>(null);
  const [editQty, setEditQty] = useState(1);
  const [editPrice, setEditPrice] = useState('');
  const [editPayment, setEditPayment] = useState<'cash' | 'card'>('cash');
  const [editProductId, setEditProductId] = useState<string>('');
  // Timestamp value in `datetime-local` format (YYYY-MM-DDTHH:mm), expressed
  // in the user's local timezone so the input renders correctly.
  const [editTimestamp, setEditTimestamp] = useState<string>('');
  const [showEditSession, setShowEditSession] = useState(false);
  const [editSessionForm, setEditSessionForm] = useState({ name: '', location: '', notes: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Event-day grouping controls (inside the edit modal).
  const [editGroupName, setEditGroupName] = useState('');
  const [groupTargetId, setGroupTargetId] = useState('');
  const [groupNameInput, setGroupNameInput] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);

  // Shared stock. Stock is global across every stall, so "what's left" comes
  // from the central store, not this session. We keep it in StockItem shape so
  // the product grid and optimistic sale/undo updates read it unchanged:
  // initial_quantity holds the current shared quantity and total_sold tracks
  // this client's un-synced optimistic sales until the next poll reconciles.
  const [stockItems, setStockItems] = useState<StockItem[]>([]);

  // Search state
  const [productSearch, setProductSearch] = useState('');

  // Map the shared inventory into the StockItem shape the grid expects. Only
  // tracked products carry a stock cap; untracked ones sell freely (no badge).
  const mapGlobalStock = useCallback(
    (rows: GlobalStockItem[]): StockItem[] =>
      rows.filter(g => g.tracked).map(g => ({
        id: g.product_id,
        session_id: id || '',
        product_id: g.product_id,
        initial_quantity: parseInt(String(g.quantity)) || 0,
        final_quantity: null,
        product_name: g.product_name,
        product_category: g.product_category,
        default_price: g.default_price,
        total_sold: 0,
      })),
    [id]
  );

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const [sessionData, productsData, salesData, stockData] = await Promise.all([
        apiGet<Session>(`/sessions/${id}`),
        apiGet<Product[]>('/products'),
        apiGet<Sale[]>(`/sales/session/${id}`),
        apiGet<GlobalStockItem[]>('/global-stock'),
      ]);
      setSession(sessionData);
      setProducts(productsData);
      setSales(salesData);
      setStockItems(mapGlobalStock(stockData));
    } catch {
      console.error('Failed to load session');
    } finally {
      setLoading(false);
    }
  }, [id, mapGlobalStock]);

  // 5s poll while the session is open. The server is the source of truth —
  // each poll re-fetches session stats, sales, and shared stock so two clients
  // (me & Tobi, even on different stalls) converge within 5s of either
  // recording a sale. Polling pauses when the tab is hidden and fires
  // immediately on tab focus.
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

  const cartTotals = useMemo(() => {
    let units = 0;
    let value = 0;
    for (const item of Object.values(cart)) {
      units += item.quantity;
      value += item.quantity * item.price;
    }
    return { units, value, lineCount: Object.keys(cart).length };
  }, [cart]);

  // Group sales by transaction_id while preserving the newest-first order of
  // the sales log. Each block is either a standalone sale or a group of sales
  // recorded together at checkout.
  type SalesBlock =
    | { kind: 'single'; sale: Sale }
    | { kind: 'group'; txId: string; items: Sale[] };
  const salesBlocks = useMemo<SalesBlock[]>(() => {
    const blocks: SalesBlock[] = [];
    const seen = new Set<string>();
    for (const s of sales) {
      if (s.transaction_id) {
        if (seen.has(s.transaction_id)) continue;
        seen.add(s.transaction_id);
        const items = sales.filter(x => x.transaction_id === s.transaction_id);
        // A "group" of one is just a single sale visually.
        if (items.length > 1) {
          blocks.push({ kind: 'group', txId: s.transaction_id, items });
          continue;
        }
      }
      blocks.push({ kind: 'single', sale: s });
    }
    return blocks;
  }, [sales]);

  // Cart helpers. Stock counts are informational only — a sale is never
  // blocked by them, so you can always sell an item even when it reads as
  // sold out (the count just goes negative and can be reconciled later).
  const addToCart = (p: Product) => {
    setCart(prev => {
      const existing = prev[p.id];
      if (existing) {
        return { ...prev, [p.id]: { ...existing, quantity: existing.quantity + 1 } };
      }
      return {
        ...prev,
        [p.id]: { quantity: 1, price: parseFloat(String(p.default_price)) },
      };
    });
  };

  const decrementCart = (productId: string) => {
    setCart(prev => {
      const existing = prev[productId];
      if (!existing) return prev;
      if (existing.quantity <= 1) {
        const next = { ...prev };
        delete next[productId];
        return next;
      }
      return { ...prev, [productId]: { ...existing, quantity: existing.quantity - 1 } };
    });
  };

  const setCartItemQuantity = (productId: string, qty: number) => {
    setCart(prev => {
      if (qty <= 0) {
        const next = { ...prev };
        delete next[productId];
        return next;
      }
      const existing = prev[productId];
      if (!existing) return prev;
      return { ...prev, [productId]: { ...existing, quantity: qty } };
    });
  };

  const setCartItemPrice = (productId: string, price: number) => {
    setCart(prev => {
      const existing = prev[productId];
      if (!existing) return prev;
      return { ...prev, [productId]: { ...existing, price } };
    });
  };

  const removeCartItem = (productId: string) => {
    setCart(prev => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  };

  const clearCart = () => setCart({});

  const checkout = async () => {
    if (!id || checkoutRecording) return;
    const entries = Object.entries(cart);
    if (entries.length === 0) return;
    setCheckoutRecording(true);
    try {
      const created: Sale[] = [];
      // Single shared transaction id stamps every line in this checkout so
      // they render as a group in the sales log.
      const transactionId =
        entries.length > 1 && typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : null;
      for (const [productId, item] of entries) {
        const sale = await apiPost<Sale>('/sales', {
          session_id: id,
          product_id: productId,
          quantity: item.quantity,
          price_charged: item.price,
          payment_method: cartPayment,
          transaction_id: transactionId,
        });
        created.push(sale);
      }
      // Newest sale appears first in the log
      setSales(prev => [...created.reverse(), ...prev]);

      const totalUnits = entries.reduce((s, [, i]) => s + i.quantity, 0);
      const totalRevenue = entries.reduce((s, [, i]) => s + i.quantity * i.price, 0);
      setSession(prev => {
        if (!prev) return prev;
        const stats = prev.stats || { total_revenue: 0, total_units: 0, total_sales: 0, best_seller: null };
        return {
          ...prev,
          stats: {
            ...stats,
            total_revenue: stats.total_revenue + totalRevenue,
            total_units: stats.total_units + totalUnits,
            total_sales: stats.total_sales + entries.length,
          },
        };
      });
      // Update local stock counts
      setStockItems(prevStock =>
        prevStock.map(si => {
          const cartItem = cart[si.product_id];
          if (!cartItem) return si;
          return {
            ...si,
            total_sold: parseInt(String(si.total_sold)) + cartItem.quantity,
          };
        })
      );

      setCart({});
      setShowCheckout(false);
      setCartPayment('cash');
      refreshSessions();
    } catch {
      console.error('Failed to checkout cart');
    } finally {
      setCheckoutRecording(false);
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

  // Format a UTC date into a local `datetime-local`-compatible value.
  const toLocalInput = (iso: string): string => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const startEditSale = (sale: Sale) => {
    setEditingSale(sale.id);
    setEditQty(sale.quantity);
    setEditPrice(parseFloat(String(sale.price_charged)).toString());
    setEditPayment(sale.payment_method === 'card' ? 'card' : 'cash');
    setEditProductId(sale.product_id);
    setEditTimestamp(toLocalInput(sale.timestamp));
  };

  const saveEditSale = async (sale: Sale) => {
    try {
      // Convert datetime-local back to a full ISO string (browser parses it
      // as the user's local time, which we then push as UTC).
      const isoTimestamp = editTimestamp ? new Date(editTimestamp).toISOString() : undefined;
      const productChanged = editProductId && editProductId !== sale.product_id;
      const updated = await apiPatch<Sale>(`/sales/${sale.id}`, {
        quantity: editQty,
        price_charged: parseFloat(editPrice),
        payment_method: editPayment,
        ...(productChanged ? { product_id: editProductId } : {}),
        ...(isoTimestamp ? { timestamp: isoTimestamp } : {}),
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
      // Update stock sold count locally — split the unit adjustment between
      // the old product (decrement) and new product (increment) if changed.
      const oldProductId = sale.product_id;
      const newProductId = productChanged ? editProductId : sale.product_id;
      setStockItems(prev => prev.map(si => {
        if (si.product_id === oldProductId && !productChanged) {
          return { ...si, total_sold: parseInt(String(si.total_sold)) - oldUnits + newUnits };
        }
        if (si.product_id === oldProductId && productChanged) {
          return { ...si, total_sold: Math.max(0, parseInt(String(si.total_sold)) - oldUnits) };
        }
        if (si.product_id === newProductId && productChanged) {
          return { ...si, total_sold: parseInt(String(si.total_sold)) + newUnits };
        }
        return si;
      }));
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
    setEditGroupName(session.group_name || '');
    setGroupTargetId('');
    setGroupNameInput('');
    setShowEditSession(true);
  };

  // --- Event-day grouping -------------------------------------------------
  // Stalls run on the same day at different locations are umbrella'd under a
  // session group; each stall keeps its own stats.
  const groupSiblings = session?.group_id
    ? sessions.filter(s => s.group_id === session.group_id && s.id !== id)
    : [];

  const joinGroup = async () => {
    if (!id || !groupTargetId || groupBusy) return;
    const target = sessions.find(s => s.id === groupTargetId);
    if (!target) return;
    setGroupBusy(true);
    try {
      if (target.group_id) {
        // Target already belongs to a group — join it.
        await apiPatch(`/sessions/${id}`, { group_id: target.group_id });
      } else {
        await apiPost('/groups', {
          name: groupNameInput.trim(),
          session_ids: [id, groupTargetId],
        });
      }
      setGroupTargetId('');
      setGroupNameInput('');
      fetchData();
      refreshSessions();
    } catch {
      console.error('Failed to group sessions');
    } finally {
      setGroupBusy(false);
    }
  };

  const leaveGroup = async () => {
    if (!id || groupBusy) return;
    setGroupBusy(true);
    try {
      await apiPatch(`/sessions/${id}`, { group_id: null });
      fetchData();
      refreshSessions();
    } catch {
      console.error('Failed to leave group');
    } finally {
      setGroupBusy(false);
    }
  };

  const renameGroup = async () => {
    if (!session?.group_id || !editGroupName.trim() || groupBusy) return;
    setGroupBusy(true);
    try {
      await apiPatch(`/groups/${session.group_id}`, { name: editGroupName.trim() });
      fetchData();
      refreshSessions();
    } catch {
      console.error('Failed to rename group');
    } finally {
      setGroupBusy(false);
    }
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

  // Total units left in the shared store right now, across tracked products.
  const totalStockUnits = stockItems.reduce((sum, si) => {
    const initial = parseInt(String(si.initial_quantity)) || 0;
    const sold = parseInt(String(si.total_sold)) || 0;
    return sum + Math.max(0, initial - sold);
  }, 0);
  const tracksStock = stockItems.length > 0;

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
  const cashRevenue = sales
    .filter(s => s.payment_method === 'cash')
    .reduce((sum, s) => sum + s.quantity * parseFloat(String(s.price_charged)), 0);
  const totalCardFees = session.card_fee_applied ? cardRevenue * (feeRate / 100) : 0;
  const netRevenue = stats.total_revenue - totalCardFees;

  const matchesQuery = (p: Product, q: string): boolean => {
    if (!q) return true;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      p.name.toLowerCase().includes(needle) ||
      (p.category || '').toLowerCase().includes(needle)
    );
  };

  // Group products by category (filtered by the in-grid search)
  const categories: Record<string, Product[]> = {};
  products.filter(p => matchesQuery(p, productSearch)).forEach(p => {
    const cat = p.category || 'Other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(p);
  });
  const productMatchCount = Object.values(categories).reduce((n, arr) => n + arr.length, 0);

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
            {session.group_id && (
              <p className="text-xs mt-1.5 flex items-center gap-1.5 flex-wrap">
                <span className="text-gold/90 bg-gold/10 border border-gold/20 px-2 py-0.5 rounded-full font-medium">
                  {session.group_name || 'Grouped'}
                </span>
                {groupSiblings.length > 0 && (
                  <span className="text-gray-500">
                    with{' '}
                    {groupSiblings.map((s, i) => (
                      <span key={s.id}>
                        {i > 0 && ', '}
                        <button
                          onClick={() => navigate(`/session/${s.id}`)}
                          className="text-gold/80 hover:text-gold hover:underline transition-colors"
                        >
                          {s.name}
                        </button>
                      </span>
                    ))}
                  </span>
                )}
              </p>
            )}
          </div>
        </motion.div>

        {/* Stall Comparison */}
        {id && <StallComparison sessions={sessions} currentSessionId={id} />}

        {/* Pending SumUp card transactions */}
        {id && isActive && (
          <PendingAllocator
            sessionId={id}
            products={products}
            onAllocated={fetchData}
          />
        )}

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

                {/* Event-day grouping: bundle stalls run on the same day at
                    different locations into one session. */}
                <div className="border-t border-white/[0.06] pt-3 space-y-2">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Event-day group
                  </h4>
                  {session.group_id ? (
                    <>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Group name"
                          value={editGroupName}
                          onChange={e => setEditGroupName(e.target.value)}
                          className="w-full text-sm"
                        />
                        <button
                          type="button"
                          onClick={renameGroup}
                          disabled={groupBusy || !editGroupName.trim()}
                          className="btn-outline text-xs !py-2 px-3 flex-shrink-0 disabled:opacity-50"
                        >
                          Rename
                        </button>
                      </div>
                      {groupSiblings.length > 0 && (
                        <p className="text-xs text-gray-600">
                          Grouped with {groupSiblings.map(s => s.name).join(', ')}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={leaveGroup}
                        disabled={groupBusy}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                      >
                        Remove this stall from the group
                      </button>
                    </>
                  ) : (
                    <>
                      <select
                        value={groupTargetId}
                        onChange={e => setGroupTargetId(e.target.value)}
                        className="w-full text-sm"
                      >
                        <option value="">Group with another stall…</option>
                        {sessions
                          .filter(s => s.id !== id)
                          .map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                              {s.group_name ? ` (in ${s.group_name})` : ''}
                              {' · '}
                              {new Date(s.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </option>
                          ))}
                      </select>
                      {groupTargetId && (() => {
                        const target = sessions.find(s => s.id === groupTargetId);
                        const joinsExisting = !!target?.group_id;
                        return (
                          <>
                            {!joinsExisting && (
                              <input
                                type="text"
                                placeholder='Group name (e.g. "Session 10")'
                                value={groupNameInput}
                                onChange={e => setGroupNameInput(e.target.value)}
                                className="w-full text-sm"
                              />
                            )}
                            <button
                              type="button"
                              onClick={joinGroup}
                              disabled={groupBusy || (!joinsExisting && !groupNameInput.trim())}
                              className="btn-outline w-full text-xs !py-2 disabled:opacity-50"
                            >
                              {groupBusy
                                ? 'Working…'
                                : joinsExisting
                                  ? `Join "${target?.group_name}"`
                                  : 'Create group'}
                            </button>
                          </>
                        );
                      })()}
                    </>
                  )}
                </div>

                <div className="flex gap-2">
                  <button type="submit" className="btn-gold flex-1">Save</button>
                  <button type="button" onClick={() => setShowEditSession(false)} className="btn-outline flex-1">Cancel</button>
                </div>
              </motion.form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          {[
            {
              label: session.card_fee_applied ? 'Net Revenue' : 'Revenue',
              value: formatCurrency(session.card_fee_applied ? netRevenue : stats.total_revenue),
              color: 'text-gold',
              glow: { boxShadow: '0 0 10px rgba(212, 168, 67, 0.1)' },
            },
            { label: 'Cash Sales', value: formatCurrency(cashRevenue), color: 'text-green-400', glow: {} },
            { label: 'Card Sales', value: formatCurrency(cardRevenue), color: 'text-blue-400', glow: {} },
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
            {/* Shared inventory — stock is global, so this is the same pool
                every stall (and every device) sells against, live. */}
            <motion.div
              className="card mb-6"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <h2 className="text-white font-semibold text-sm">Shared Inventory</h2>
                </div>
                {tracksStock && (
                  <span className="text-sm font-bold text-gold">{totalStockUnits}<span className="text-[11px] text-gray-500 font-normal ml-1">left</span></span>
                )}
              </div>

              <p className="text-[11px] text-gray-500 mb-3">
                {tracksStock
                  ? 'One pool across every stall. Any sale here or on another stall drops it live.'
                  : 'No stock set yet. Set your counts on the Inventory page and every stall will sell against them.'}
              </p>

              <button
                onClick={() => navigate('/inventory')}
                className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold transition-all duration-200 flex items-center gap-2 justify-center bg-gold/10 text-gold border border-gold/25 hover:bg-gold/20"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                {tracksStock ? 'Adjust Inventory' : 'Set Up Inventory'}
              </button>
            </motion.div>

            {/* Sticky title + search bar — sits at the left-column level so
                it has the full column height to pin within. Pinned via inline
                style as a belt-and-braces against any class-purge oddities. */}
            {isActive && (
              <div
                data-sticky="tap-to-sell"
                className="sticky top-14 md:top-0 z-20 -mx-1 px-1 pt-2 pb-3 mb-3 bg-navy/95 backdrop-blur-md border-b border-white/[0.04]"
                style={{ position: 'sticky', zIndex: 20 }}
              >
                <div className="flex items-center justify-between mb-2 gap-3">
                  <h2 className="section-title text-gold">Tap to Sell</h2>
                  <span className="text-[10px] text-gray-600">
                    {productSearch ? `${productMatchCount} match${productMatchCount === 1 ? '' : 'es'}` : `${products.length} products`}
                  </span>
                </div>
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
                  </svg>
                  <input
                    type="text"
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    placeholder="Search products..."
                    className="w-full !pl-9 !pr-9 text-sm"
                  />
                  {productSearch && (
                    <button
                      type="button"
                      onClick={() => setProductSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors p-1"
                      aria-label="Clear search"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Product Selection (only when active) */}
            {isActive && (
              <motion.div
                className="mb-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
              >
                {Object.entries(categories).map(([cat, prods]) => (
                  <div key={cat} className="mb-4">
                    <p className="section-title text-gray-600 mb-2">{cat}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {prods.map((p, i) => {
                        const stock = stockMap[p.id];
                        const inCartQty = cart[p.id]?.quantity ?? 0;
                        // Stock is informational only: every product stays fully
                        // tappable, even at 0, so a sale is never blocked.
                        return (
                          <motion.button
                            key={p.id}
                            onClick={() => addToCart(p)}
                            className={`card-hover text-left relative ${
                              inCartQty > 0 ? 'ring-2 ring-gold/40' : ''
                            }`}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: i * 0.04, duration: 0.3 }}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                          >
                            {inCartQty > 0 && (
                              <span className="absolute -top-1.5 -right-1.5 z-10 min-w-[20px] h-5 px-1.5 rounded-full bg-gold text-navy text-[11px] font-bold flex items-center justify-center shadow-glow-gold-sm">
                                {inCartQty}
                              </span>
                            )}
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
                {products.length > 0 && productMatchCount === 0 && (
                  <p className="text-gray-600 text-sm text-center py-6">
                    No products match "{productSearch}"
                  </p>
                )}
              </motion.div>
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
                  {(() => {
                    const renderSaleRow = (sale: Sale, opts?: { compact?: boolean }) => {
                      const compact = opts?.compact;
                      if (editingSale === sale.id) {
                        const productsSorted = [...products].sort((a, b) => a.name.localeCompare(b.name));
                        return (
                          <div className="space-y-3">
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">Product</label>
                              <select
                                value={editProductId}
                                onChange={e => setEditProductId(e.target.value)}
                                className="w-full text-sm"
                              >
                                {productsSorted.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}{p.category ? ` · ${p.category}` : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
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
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">When</label>
                              <input
                                type="datetime-local"
                                value={editTimestamp}
                                onChange={e => setEditTimestamp(e.target.value)}
                                className="w-full text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">Payment</label>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditPayment('cash')}
                                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                                    editPayment === 'cash'
                                      ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                                      : 'text-gray-400 border border-white/[0.06] hover:border-white/10'
                                  }`}
                                >
                                  Cash
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditPayment('card')}
                                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                                    editPayment === 'card'
                                      ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                                      : 'text-gray-400 border border-white/[0.06] hover:border-white/10'
                                  }`}
                                >
                                  Card
                                </button>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => saveEditSale(sale)} className="btn-gold flex-1 text-xs !py-2">Save</button>
                              <button onClick={() => setEditingSale(null)} className="btn-outline flex-1 text-xs !py-2">Cancel</button>
                            </div>
                          </div>
                        );
                      }
                      return (
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
                              {!compact && (
                                <>
                                  {' \u00b7 '}
                                  {new Date(sale.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                </>
                              )}
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
                      );
                    };

                    return salesBlocks.map((block, i) => {
                      const delay = Math.min(i * 0.03, 0.3);

                      if (block.kind === 'single') {
                        return (
                          <motion.div
                            key={block.sale.id}
                            className="card"
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay, duration: 0.3 }}
                          >
                            {renderSaleRow(block.sale)}
                          </motion.div>
                        );
                      }

                      // Group block \u2014 wrap all items in one receipt-style card
                      // with a header showing the totals + a connecting gold
                      // ribbon down the left edge.
                      const groupTotal = block.items.reduce(
                        (s, it) => s + it.quantity * parseFloat(String(it.price_charged)),
                        0
                      );
                      const firstTime = block.items[0]?.timestamp;
                      const allCash = block.items.every(it => it.payment_method === 'cash');
                      const allCard = block.items.every(it => it.payment_method === 'card');
                      const paymentLabel = allCash ? 'CASH' : allCard ? 'CARD' : 'MIXED';
                      const paymentClass = allCash
                        ? 'bg-green-500/15 text-green-400 border-green-500/20'
                        : allCard
                          ? 'bg-blue-500/15 text-blue-400 border-blue-500/20'
                          : 'bg-gray-500/15 text-gray-300 border-gray-500/20';
                      return (
                        <motion.div
                          key={block.txId}
                          className="relative card !p-0 overflow-hidden border-gold/20"
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay, duration: 0.3 }}
                        >
                          {/* Gold ribbon down the left edge so the group reads
                              as a single transaction at a glance. */}
                          <span
                            aria-hidden
                            className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-gold to-gold-dark"
                          />

                          <div className="pl-4 pr-4 py-2.5 flex items-center gap-2 border-b border-white/[0.05]">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gold/90 whitespace-nowrap">
                              Group \u00b7 {block.items.length} lines
                            </span>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${paymentClass}`}>
                              {paymentLabel}
                            </span>
                            <span className="text-[10px] text-gray-500 truncate">
                              {firstTime &&
                                new Date(firstTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="flex-1" />
                            <span className="text-base font-bold text-gold tabular-nums whitespace-nowrap">
                              {formatCurrency(groupTotal)}
                            </span>
                          </div>

                          <div className="divide-y divide-white/[0.05] pl-4">
                            {block.items.map(sale => (
                              <div key={sale.id} className="px-3 py-2.5 pr-4">
                                {renderSaleRow(sale, { compact: true })}
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      );
                    });
                  })()}
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
                {isActive && <p className="text-xs mt-1 text-gray-600">Tap products to build a sale, then checkout</p>}
              </div>
            )}
          </div>
        </div>

        {/* Spacer so the floating cart bar doesn't sit on top of the last
            content row when the cart has items. */}
        {isActive && cartTotals.lineCount > 0 && <div className="h-20" />}
      </div>

      {/* Floating cart bar — appears whenever the cart has items. */}
      <AnimatePresence>
        {isActive && cartTotals.lineCount > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="fixed bottom-0 left-0 right-0 md:left-72 z-30 px-3 pb-3 pointer-events-none"
          >
            <button
              type="button"
              onClick={() => {
                setCartPayment('cash');
                setShowCheckout(true);
              }}
              className="pointer-events-auto w-full max-w-3xl mx-auto flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-navy font-semibold shadow-glow-gold backdrop-blur-md bg-gradient-gold transition-all duration-200 active:scale-[0.99] hover:brightness-105"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="bg-navy/20 rounded-lg w-8 h-8 flex items-center justify-center text-sm font-bold flex-shrink-0">
                  {cartTotals.units}
                </span>
                <span className="text-left min-w-0">
                  <span className="block text-xs opacity-70 -mb-0.5">
                    {cartTotals.lineCount} line{cartTotals.lineCount === 1 ? '' : 's'} · {cartTotals.units} item{cartTotals.units === 1 ? '' : 's'}
                  </span>
                  <span className="block text-base font-bold">
                    {formatCurrency(cartTotals.value)}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-1 text-sm">
                Checkout
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Checkout Modal */}
      <AnimatePresence>
        {showCheckout && (
          <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-0 md:p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !checkoutRecording && setShowCheckout(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              transition={{ duration: 0.25 }}
              onClick={e => e.stopPropagation()}
              className="card w-full max-w-lg max-h-[90vh] flex flex-col rounded-b-none md:rounded-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gold text-sm">Checkout</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {cartTotals.lineCount} line{cartTotals.lineCount === 1 ? '' : 's'} · {cartTotals.units} item{cartTotals.units === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={clearCart}
                  className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                >
                  Clear all
                </button>
              </div>

              <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-2">
                {Object.entries(cart).map(([pid, item]) => {
                  const product = products.find(p => p.id === pid);
                  if (!product) return null;
                  const lineTotal = item.quantity * item.price;
                  return (
                    <div key={pid} className="card !p-3">
                      <div className="flex items-start justify-between mb-2 gap-2">
                        <p className="font-medium text-white text-sm flex-1 min-w-0 truncate">{product.name}</p>
                        <button
                          type="button"
                          onClick={() => removeCartItem(pid)}
                          className="text-gray-500 hover:text-red-400 transition-colors p-0.5 flex-shrink-0"
                          aria-label="Remove from cart"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <motion.button
                            type="button"
                            onClick={() => decrementCart(pid)}
                            className="btn-outline !px-2 !py-1 text-sm"
                            whileTap={{ scale: 0.9 }}
                          >-</motion.button>
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={e => setCartItemQuantity(pid, Math.max(0, parseInt(e.target.value) || 0))}
                            className="w-12 text-center text-sm"
                            min="0"
                          />
                          <motion.button
                            type="button"
                            onClick={() => addToCart(product)}
                            className="btn-outline !px-2 !py-1 text-sm"
                            whileTap={{ scale: 0.9 }}
                          >+</motion.button>
                        </div>
                        <span className="text-gray-600 text-xs">×</span>
                        <div className="relative flex-1">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">£</span>
                          <input
                            type="number"
                            value={item.price}
                            onChange={e => setCartItemPrice(pid, parseFloat(e.target.value) || 0)}
                            className="w-full !pl-5 text-sm"
                            step="0.01"
                            min="0"
                          />
                        </div>
                        <span className="text-gold font-semibold text-sm w-16 text-right">
                          {formatCurrency(lineTotal)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Total */}
              <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center justify-between">
                <span className="text-gray-400 text-sm">Total</span>
                <span className="text-2xl font-bold text-gold">
                  {formatCurrency(cartTotals.value)}
                </span>
              </div>

              {/* Payment toggle */}
              <div className="mt-3">
                <label className="text-xs text-gray-500 block mb-1.5">Payment Method</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCartPayment('cash')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                      cartPayment === 'cash'
                        ? 'bg-green-500/15 text-green-400 border border-green-500/40'
                        : 'text-gray-400 border border-white/[0.06] hover:border-white/10'
                    }`}
                  >
                    Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setCartPayment('card')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                      cartPayment === 'card'
                        ? 'bg-blue-500/15 text-blue-400 border border-blue-500/40'
                        : 'text-gray-400 border border-white/[0.06] hover:border-white/10'
                    }`}
                  >
                    Card
                  </button>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setShowCheckout(false)}
                  disabled={checkoutRecording}
                  className="btn-outline flex-1 disabled:opacity-50"
                >
                  Keep shopping
                </button>
                <motion.button
                  type="button"
                  onClick={checkout}
                  disabled={checkoutRecording || cartTotals.value <= 0}
                  className="btn-gold flex-[2] disabled:opacity-50 disabled:cursor-not-allowed"
                  whileTap={{ scale: 0.98 }}
                >
                  {checkoutRecording ? (
                    <span className="flex items-center justify-center gap-2">
                      <motion.span
                        className="w-2 h-2 rounded-full bg-navy"
                        animate={{ scale: [1, 1.3, 1] }}
                        transition={{ duration: 0.6, repeat: Infinity }}
                      />
                      Recording…
                    </span>
                  ) : (
                    `Record ${cartTotals.lineCount} sale${cartTotals.lineCount === 1 ? '' : 's'}`
                  )}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </PageTransition>
  );
}
