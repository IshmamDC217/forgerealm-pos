import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiGet, apiPost } from '../utils/api';
import { usePolling } from '../utils/usePolling';
import { formatCurrency } from '../utils/currency';
import type { PendingTransaction, Product } from '../types';

interface Props {
  sessionId: string;
  products: Product[];
  // Called after a successful allocation so the parent can refresh sales/stock.
  onAllocated: () => void;
}

interface CartEntry {
  quantity: number;
  price: number;
}

const amount = (p: PendingTransaction): number => {
  const v = typeof p.amount === 'string' ? parseFloat(p.amount) : p.amount;
  return Number.isFinite(v) ? v : 0;
};

export default function PendingAllocator({ sessionId, products, onAllocated }: Props) {
  const [pending, setPending] = useState<PendingTransaction[]>([]);
  const [showQueue, setShowQueue] = useState(false);
  const [allocating, setAllocating] = useState<PendingTransaction | null>(null);
  const [cart, setCart] = useState<Record<string, CartEntry>>({});
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<PendingTransaction[]>(`/sumup/pending?session_id=${sessionId}`);
      setPending(data);
    } catch {
      // silently keep current list on failure; poller will retry
    }
  }, [sessionId]);

  // Poll for new pending transactions every 10s.
  usePolling(refresh, { intervalMs: 10000, enabled: !!sessionId });

  // Totals across all pending txs.
  const pendingTotal = useMemo(
    () => pending.reduce((sum, p) => sum + amount(p), 0),
    [pending]
  );

  // Cart totals for the active allocation.
  const cartTotal = useMemo(() => {
    let value = 0;
    let units = 0;
    for (const c of Object.values(cart)) {
      value += c.quantity * c.price;
      units += c.quantity;
    }
    return { value, units, lineCount: Object.keys(cart).length };
  }, [cart]);

  const target = allocating ? amount(allocating) : 0;
  const delta = cartTotal.value - target;
  const matches = allocating ? Math.abs(delta) < 0.005 : false;

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? products.filter(
          p =>
            p.name.toLowerCase().includes(q) ||
            (p.category || '').toLowerCase().includes(q)
        )
      : products;
  }, [products, search]);

  const productCategories = useMemo(() => {
    const cats: Record<string, Product[]> = {};
    for (const p of filteredProducts) {
      const cat = p.category || 'Other';
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(p);
    }
    return cats;
  }, [filteredProducts]);

  const startAllocating = (p: PendingTransaction) => {
    setAllocating(p);
    setCart({});
    setSearch('');
    setError(null);
    setShowQueue(false);
  };

  const cancelAllocating = () => {
    setAllocating(null);
    setCart({});
    setError(null);
  };

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

  const setQty = (productId: string, qty: number) => {
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

  const setPrice = (productId: string, price: number) => {
    setCart(prev => {
      const existing = prev[productId];
      if (!existing) return prev;
      return { ...prev, [productId]: { ...existing, price } };
    });
  };

  const dismissPending = async (p: PendingTransaction) => {
    if (!confirm(`Dismiss this £${amount(p).toFixed(2)} SumUp transaction? It will be hidden from the queue.`)) return;
    try {
      await apiPost(`/sumup/dismiss/${p.id}`, {});
      refresh();
    } catch {
      console.error('Failed to dismiss');
    }
  };

  const submitAllocation = async () => {
    if (!allocating || submitting || !matches) return;
    setSubmitting(true);
    setError(null);
    try {
      const items = Object.entries(cart).map(([product_id, item]) => ({
        product_id,
        quantity: item.quantity,
        price_charged: item.price,
      }));
      await apiPost(`/sumup/allocate/${allocating.id}`, { session_id: sessionId, items });
      setAllocating(null);
      setCart({});
      refresh();
      onAllocated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Allocation failed');
    } finally {
      setSubmitting(false);
    }
  };

  // Render nothing at all when there's no pending work AND we're not in the
  // middle of allocating. Keeps the page clean.
  if (pending.length === 0 && !allocating) return null;

  return (
    <>
      {/* Banner */}
      {pending.length > 0 && !allocating && (
        <motion.button
          type="button"
          onClick={() => setShowQueue(true)}
          className="w-full mb-4 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 border border-gold/30 bg-gradient-to-r from-gold/15 to-gold/5 text-left transition-all hover:from-gold/20 hover:to-gold/10"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ boxShadow: '0 0 18px rgba(212, 168, 67, 0.12)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <motion.span
              className="w-9 h-9 rounded-xl bg-gold/20 border border-gold/30 flex items-center justify-center flex-shrink-0"
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            >
              <svg className="w-4 h-4 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </motion.span>
            <div className="min-w-0">
              <p className="text-xs text-gold font-semibold uppercase tracking-wider">
                SumUp card transaction{pending.length === 1 ? '' : 's'} pending
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {pending.length} waiting · {formatCurrency(pendingTotal)} total · tap to allocate
              </p>
            </div>
          </div>
          <svg className="w-4 h-4 text-gold flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </motion.button>
      )}

      {/* Allocation-in-progress strip */}
      {allocating && (
        <motion.div
          className="w-full mb-4 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 border border-gold/40 bg-gradient-to-r from-gold/20 to-gold/10"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ boxShadow: '0 0 18px rgba(212, 168, 67, 0.18)' }}
        >
          <div className="min-w-0">
            <p className="text-[10px] text-gold/80 font-semibold uppercase tracking-wider">
              Allocating SumUp · {formatCurrency(target)}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {new Date(allocating.sumup_timestamp).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
              })}
              {allocating.card_type && ` · ${allocating.card_type}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-gray-500">
              {matches ? '' : delta < 0 ? `Short by ${formatCurrency(-delta)}` : `Over by ${formatCurrency(delta)}`}
            </p>
            <p className={`text-sm font-bold tabular-nums ${matches ? 'text-green-400' : delta < 0 ? 'text-orange-400' : 'text-red-400'}`}>
              {formatCurrency(cartTotal.value)}
              {matches && ' ✓'}
            </p>
          </div>
        </motion.div>
      )}

      {/* Queue drawer */}
      <AnimatePresence>
        {showQueue && (
          <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-0 md:p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowQueue(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              transition={{ duration: 0.22 }}
              onClick={e => e.stopPropagation()}
              className="card w-full max-w-lg max-h-[80vh] flex flex-col rounded-b-none md:rounded-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gold text-sm">Pending SumUp transactions</h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {pending.length} waiting · {formatCurrency(pendingTotal)} total
                  </p>
                </div>
                <button onClick={() => setShowQueue(false)} className="text-gray-500 hover:text-white p-1" aria-label="Close">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-2">
                {[...pending]
                  .sort((a, b) => new Date(a.sumup_timestamp).getTime() - new Date(b.sumup_timestamp).getTime())
                  .map(p => (
                    <div key={p.id} className="card !p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-bold text-gold tabular-nums">{formatCurrency(amount(p))}</p>
                        <p className="text-[11px] text-gray-500">
                          {new Date(p.sumup_timestamp).toLocaleString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {p.card_type && ` · ${p.card_type}`}
                        </p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => dismissPending(p)}
                          className="btn-outline !px-3 !py-1.5 text-xs text-gray-400 hover:text-red-400 hover:border-red-400/30"
                        >
                          Dismiss
                        </button>
                        <button
                          onClick={() => startAllocating(p)}
                          className="btn-gold !px-3 !py-1.5 text-xs"
                        >
                          Allocate →
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Allocation modal */}
      <AnimatePresence>
        {allocating && (
          <motion.div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-0 md:p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              transition={{ duration: 0.22 }}
              className="card w-full max-w-2xl max-h-[92vh] md:max-h-[88vh] flex flex-col rounded-b-none md:rounded-2xl"
            >
              {/* Header with target */}
              <div className="flex items-center justify-between mb-3 gap-3">
                <div>
                  <h3 className="font-semibold text-gold text-sm">Allocate SumUp transaction</h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {new Date(allocating.sumup_timestamp).toLocaleString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {allocating.card_type && ` · ${allocating.card_type}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Target</p>
                  <p className="text-lg font-bold text-gold tabular-nums">
                    {formatCurrency(target)}
                  </p>
                </div>
              </div>

              {/* Running total + delta */}
              <div
                className={`rounded-xl border px-3 py-2 mb-3 flex items-center justify-between transition-colors ${
                  matches
                    ? 'border-green-500/30 bg-green-500/10'
                    : delta < 0
                      ? 'border-orange-500/25 bg-orange-500/8'
                      : 'border-red-500/25 bg-red-500/8'
                }`}
              >
                <span className="text-[11px] text-gray-400">
                  {matches ? 'Totals match — ready to record' : delta < 0 ? `Short by ${formatCurrency(-delta)}` : `Over by ${formatCurrency(delta)}`}
                </span>
                <span className={`text-sm font-bold tabular-nums ${matches ? 'text-green-400' : delta < 0 ? 'text-orange-400' : 'text-red-400'}`}>
                  {formatCurrency(cartTotal.value)}{matches ? ' ✓' : ''}
                </span>
              </div>

              {/* Cart lines — selected products. flex-shrink-0 so the product
                  grid's flex-1 below doesn't squeeze this section out. */}
              {cartTotal.lineCount > 0 && (
                <div className="flex-shrink-0 mb-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
                    Selected · {cartTotal.lineCount} line{cartTotal.lineCount === 1 ? '' : 's'} · {cartTotal.units} item{cartTotal.units === 1 ? '' : 's'}
                  </p>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto -mx-1 px-1">
                    {Object.entries(cart).map(([pid, item]) => {
                      const product = products.find(p => p.id === pid);
                      if (!product) return null;
                      return (
                        <div key={pid} className="card !p-2 flex items-center gap-2">
                          <span className="text-xs text-white flex-1 min-w-0 truncate">{product.name}</span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => decrementCart(pid)}
                              className="btn-outline !px-1.5 !py-0.5 text-xs"
                            >-</button>
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={e => setQty(pid, Math.max(0, parseInt(e.target.value) || 0))}
                              className="w-10 text-center text-xs"
                              min="0"
                            />
                            <button
                              onClick={() => addToCart(product)}
                              className="btn-outline !px-1.5 !py-0.5 text-xs"
                            >+</button>
                          </div>
                          <span className="text-[10px] text-gray-500 flex-shrink-0">×</span>
                          <div className="relative w-16 flex-shrink-0">
                            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 pointer-events-none">£</span>
                            <input
                              type="number"
                              value={item.price}
                              onChange={e => setPrice(pid, parseFloat(e.target.value) || 0)}
                              className="w-full !pl-4 !pr-1 text-xs"
                              step="0.01"
                              min="0"
                            />
                          </div>
                          <span className="text-xs text-gold font-semibold w-14 text-right tabular-nums flex-shrink-0">
                            {formatCurrency(item.quantity * item.price)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Product picker grid */}
              <div className="relative mb-2">
                <input
                  type="text"
                  placeholder="Search products to add..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full text-sm"
                />
              </div>
              <div className="flex-1 overflow-y-auto -mx-1 px-1">
                {Object.entries(productCategories).map(([cat, prods]) => (
                  <div key={cat} className="mb-3">
                    <p className="section-title text-gray-600 mb-1.5">{cat}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {prods.map(p => {
                        const inCart = cart[p.id]?.quantity ?? 0;
                        return (
                          <button
                            key={p.id}
                            onClick={() => addToCart(p)}
                            className={`text-left p-2 rounded-lg border transition-all ${
                              inCart > 0
                                ? 'bg-gold/10 border-gold/40'
                                : 'bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.04] hover:border-white/10'
                            }`}
                          >
                            <p className="text-[11px] text-white font-medium truncate">{p.name}</p>
                            <p className="text-[10px] text-gold">
                              {formatCurrency(parseFloat(String(p.default_price)))}
                              {inCart > 0 && <span className="text-gray-400"> · ×{inCart}</span>}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {Object.keys(productCategories).length === 0 && (
                  <p className="text-center text-xs text-gray-500 py-4">
                    No products match "{search}"
                  </p>
                )}
              </div>

              {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

              {/* Actions */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-white/[0.06]">
                <button
                  onClick={cancelAllocating}
                  disabled={submitting}
                  className="btn-outline flex-1 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={submitAllocation}
                  disabled={submitting || !matches}
                  className="btn-gold flex-[2] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Recording…' : matches ? `Record ${cartTotal.lineCount} sale${cartTotal.lineCount === 1 ? '' : 's'}` : 'Match the total first'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
