import { useState, useCallback, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { apiGet, apiPut } from '../utils/api';
import type { GlobalStockItem } from '../types';
import PageTransition from '../components/PageTransition';
import HomeButton from '../components/HomeButton';

export default function Inventory() {
  const [items, setItems] = useState<GlobalStockItem[]>([]);
  const [form, setForm] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await apiGet<GlobalStockItem[]>('/global-stock');
      setItems(data);
      // Seed the editable form from the store quantities.
      const next: Record<string, number> = {};
      for (const it of data) next[it.product_id] = parseInt(String(it.quantity)) || 0;
      setForm(next);
    } catch {
      // leave existing state in place on failure
    } finally {
      setLoading(false);
    }
  }, []);

  // Load once on mount. We deliberately don't poll here — this is an editable
  // grid, and a background refresh would clobber in-progress edits.
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const payload = Object.entries(form).map(([product_id, quantity]) => ({ product_id, quantity }));
      const updated = await apiPut<GlobalStockItem[]>('/global-stock', { items: payload });
      setItems(updated);
      const next: Record<string, number> = {};
      for (const it of updated) next[it.product_id] = parseInt(String(it.quantity)) || 0;
      setForm(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      // error
    } finally {
      setSaving(false);
    }
  };

  const dirty = useMemo(
    () => items.some(it => (form[it.product_id] ?? 0) !== (parseInt(String(it.quantity)) || 0)),
    [items, form]
  );

  const totals = useMemo(() => {
    let store = 0;
    let deployed = 0;
    for (const it of items) {
      store += form[it.product_id] ?? (parseInt(String(it.quantity)) || 0);
      deployed += parseInt(String(it.deployed)) || 0;
    }
    return { store, deployed, total: store + deployed };
  }, [items, form]);

  const matches = (it: GlobalStockItem): boolean => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      it.product_name.toLowerCase().includes(q) ||
      (it.product_category || '').toLowerCase().includes(q)
    );
  };

  // Group by category for display.
  const categories: Record<string, GlobalStockItem[]> = {};
  items.filter(matches).forEach(it => {
    const cat = it.product_category || 'Other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(it);
  });
  const matchCount = Object.values(categories).reduce((n, arr) => n + arr.length, 0);

  const setQty = (id: string, qty: number) =>
    setForm(f => ({ ...f, [id]: Math.max(0, qty) }));

  return (
    <PageTransition>
      <div className="max-w-3xl mx-auto px-4 py-6 md:px-8">
        <div className="mb-4">
          <HomeButton />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between mb-6 gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Inventory</h1>
            <p className="text-gray-500 text-sm mt-1">
              Your current stock in the store. New stalls pull from here.
            </p>
          </div>
        </div>

        {/* Totals */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            { label: 'In store', value: totals.store, color: 'text-white' },
            { label: 'On stalls', value: totals.deployed, color: 'text-orange-400' },
            { label: 'Total units', value: totals.total, color: 'text-gold' },
          ].map(stat => (
            <div key={stat.label} className="stat-card">
              <p className="text-gray-500 text-xs mb-1">{stat.label}</p>
              <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search inventory..."
            className="w-full !pl-9 !pr-9 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors p-1"
              aria-label="Clear search"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 text-gray-500 py-12">
            <motion.div
              className="w-2 h-2 rounded-full bg-gold/50"
              animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
            Loading...
          </div>
        ) : items.length === 0 ? (
          <div className="text-center text-gray-500 py-16">
            <p className="text-lg mb-2">No products yet</p>
            <p className="text-sm text-gray-600">Add products first, then set their stock here.</p>
          </div>
        ) : (
          <>
            {search && matchCount === 0 && (
              <p className="text-gray-600 text-sm text-center py-6">No products match "{search}"</p>
            )}
            <div className="space-y-5 pb-24">
              {Object.entries(categories).sort(([a], [b]) => a.localeCompare(b)).map(([cat, prods]) => (
                <div key={cat}>
                  <p className="section-title text-gray-600 mb-2">{cat}</p>
                  <div className="space-y-1.5">
                    {prods.map(it => (
                      <div key={it.product_id} className="flex items-center justify-between py-2 px-2 rounded-xl hover:bg-white/[0.03] transition-colors">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-white truncate">{it.product_name}</p>
                          {parseInt(String(it.deployed)) > 0 && (
                            <p className="text-[11px] text-orange-400/80">{it.deployed} out on stalls</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <motion.button
                            type="button"
                            onClick={() => setQty(it.product_id, (form[it.product_id] || 0) - 1)}
                            className="btn-outline !px-2 !py-1 text-sm"
                            whileTap={{ scale: 0.9 }}
                          >-</motion.button>
                          <input
                            type="number"
                            value={form[it.product_id] ?? 0}
                            onChange={e => setQty(it.product_id, parseInt(e.target.value) || 0)}
                            className="w-16 text-center text-sm"
                            min="0"
                          />
                          <motion.button
                            type="button"
                            onClick={() => setQty(it.product_id, (form[it.product_id] || 0) + 1)}
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

            {/* Sticky save bar */}
            <div className="fixed bottom-0 left-0 right-0 md:left-72 z-30 bg-navy/95 backdrop-blur-md border-t border-white/[0.06] px-4 py-3">
              <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
                <span className="text-xs text-gray-500">
                  {saved ? (
                    <span className="text-emerald-400 font-medium">Saved</span>
                  ) : dirty ? (
                    'Unsaved changes'
                  ) : (
                    'Up to date'
                  )}
                </span>
                <motion.button
                  onClick={save}
                  disabled={saving || !dirty}
                  className="btn-gold text-sm px-6 disabled:opacity-40"
                  whileTap={{ scale: 0.97 }}
                >
                  {saving ? 'Saving...' : 'Save Stock'}
                </motion.button>
              </div>
            </div>
          </>
        )}
      </div>
    </PageTransition>
  );
}
