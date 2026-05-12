import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { apiGet, apiPost, apiPatch, apiDelete } from '../utils/api';
import { formatCurrency } from '../utils/currency';
import { usePolling } from '../utils/usePolling';
import type { Product } from '../types';
import PageTransition from '../components/PageTransition';
import HomeButton from '../components/HomeButton';

interface ProductForm {
  name: string;
  default_price: string;
  category: string;
}

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>({ name: '', default_price: '', category: '' });
  const [loading, setLoading] = useState(true);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const categoryWrapRef = useRef<HTMLDivElement>(null);
  const categoryPopoverRef = useRef<HTMLDivElement>(null);
  const [categoryPopoverStyle, setCategoryPopoverStyle] = useState<React.CSSProperties>({});

  // Position the portaled dropdown directly under the input, and reposition
  // on scroll/resize. Uses `position: fixed` since it lives on document.body.
  useEffect(() => {
    if (!categoryOpen) return;
    const update = () => {
      const input = categoryWrapRef.current?.querySelector('input');
      if (!input) return;
      const rect = input.getBoundingClientRect();
      setCategoryPopoverStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [categoryOpen]);

  // Close the category dropdown when clicking outside the input wrap AND
  // outside the portaled popover.
  useEffect(() => {
    if (!categoryOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const inWrap = categoryWrapRef.current?.contains(t);
      const inPopover = categoryPopoverRef.current?.contains(t);
      if (!inWrap && !inPopover) setCategoryOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [categoryOpen]);

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<Product[]>('/products');
      setProducts(data);
    } catch {
      // leave existing list in place on failure
    } finally {
      setLoading(false);
    }
  }, []);

  // Products change rarely — 15s poll is more than enough.
  usePolling(refresh, { intervalMs: 15000 });

  const resetForm = () => {
    setForm({ name: '', default_price: '', category: '' });
    setShowNew(false);
    setEditingId(null);
    setCategoryOpen(false);
  };

  const saveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.default_price) return;

    const body = {
      name: form.name.trim(),
      default_price: parseFloat(form.default_price),
      category: form.category.trim() || null,
    };

    if (editingId) {
      try {
        const updated = await apiPatch<Product>(`/products/${editingId}`, body);
        setProducts(prev => prev.map(p => p.id === editingId ? updated : p));
        resetForm();
      } catch {
        // error
      }
    } else {
      try {
        const created = await apiPost<Product>('/products', body);
        setProducts(prev => [...prev, created]);
        resetForm();
      } catch {
        // error
      }
    }
  };

  const startEdit = (product: Product) => {
    setEditingId(product.id);
    setForm({
      name: product.name,
      default_price: product.default_price.toString(),
      category: product.category || '',
    });
    setShowNew(true);
  };

  const deleteProduct = async (productId: string) => {
    if (!confirm('Delete this product? It cannot be deleted if it has sales.')) return;
    try {
      await apiDelete(`/products/${productId}`);
      setProducts(prev => prev.filter(p => p.id !== productId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Cannot delete product with existing sales');
    }
  };

  // Distinct existing categories, for the datalist dropdown on the form.
  const existingCategories = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => {
      const c = (p.category || '').trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  // Group by category
  const categories: Record<string, Product[]> = {};
  products.forEach(p => {
    const cat = p.category || 'Other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(p);
  });

  return (
    <PageTransition>
      <div className="max-w-4xl mx-auto px-4 py-6 md:px-8">
        {/* Home Button */}
        <div className="mb-4">
          <HomeButton />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Product Catalog</h1>
            <p className="text-gray-500 text-sm mt-1">{products.length} products</p>
          </div>
          <motion.button
            onClick={() => { resetForm(); setShowNew(true); }}
            className="btn-gold text-sm px-5 py-2.5 flex items-center gap-2"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Product
          </motion.button>
        </div>

        {/* Add/Edit Form */}
        <AnimatePresence>
          {showNew && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
              onSubmit={saveProduct}
            >
              <div className="card mb-6 space-y-3">
                <h3 className="font-semibold text-gold text-sm">
                  {editingId ? 'Edit Product' : 'New Product'}
                </h3>
                <input
                  type="text"
                  placeholder="Product name"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full"
                  autoFocus
                />
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 block mb-1">Default Price</label>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={form.default_price}
                      onChange={e => setForm({ ...form, default_price: e.target.value })}
                      className="w-full"
                      step="0.01"
                      min="0"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 block mb-1">
                      Category
                      {existingCategories.length > 0 && (
                        <span className="hidden sm:inline text-gray-600 font-normal ml-1">
                          (pick or type a new one)
                        </span>
                      )}
                    </label>
                    <div ref={categoryWrapRef} className="relative">
                      <input
                        type="text"
                        placeholder="e.g. Miniatures"
                        value={form.category}
                        onChange={e => {
                          setForm({ ...form, category: e.target.value });
                          setCategoryOpen(true);
                        }}
                        onFocus={() => setCategoryOpen(true)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') setCategoryOpen(false);
                        }}
                        className="w-full !pr-9"
                        autoComplete="off"
                      />
                      {existingCategories.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setCategoryOpen(o => !o)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gold transition-colors p-1"
                          aria-label="Toggle category list"
                          tabIndex={-1}
                        >
                          <svg
                            className={`w-4 h-4 transition-transform duration-200 ${categoryOpen ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="btn-gold flex-1">
                    {editingId ? 'Update' : 'Add Product'}
                  </button>
                  <button type="button" onClick={resetForm} className="btn-outline flex-1">Cancel</button>
                </div>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Product List */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          {Object.entries(categories).sort(([a], [b]) => a.localeCompare(b)).map(([cat, prods]) => (
            <div key={cat} className="mb-6">
              <h2 className="section-title text-gray-500 mb-3 px-1">{cat}</h2>
              <div className="space-y-2">
                {prods.map((p, i) => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.3 }}
                    className="card-hover flex items-center justify-between group"
                  >
                    <div>
                      <p className="font-medium text-white">{p.name}</p>
                      <p className="text-gold text-sm">{formatCurrency(parseFloat(String(p.default_price)))}</p>
                    </div>
                    <div className="flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <button
                        onClick={() => startEdit(p)}
                        className="text-gray-400 hover:text-gold text-xs transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteProduct(p.id)}
                        className="text-gray-400 hover:text-red-400 text-xs transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-3 text-gray-500 py-8">
            <motion.div
              className="w-2 h-2 rounded-full bg-gold/50"
              animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
            Loading...
          </div>
        )}
        {!loading && products.length === 0 && (
          <div className="text-center text-gray-500 py-16">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <p className="text-lg mb-2">No products yet</p>
            <p className="text-sm text-gray-600">Add your first product to get started</p>
          </div>
        )}
      </div>

      {/* Category dropdown — portaled to body so it escapes the form's
          `overflow-hidden` clipping and can extend beyond the card. */}
      {createPortal(
        <AnimatePresence>
          {categoryOpen && existingCategories.length > 0 && (() => {
            const q = form.category.trim().toLowerCase();
            const filtered = q
              ? existingCategories.filter(c => c.toLowerCase().includes(q))
              : existingCategories;
            return (
              <motion.div
                ref={categoryPopoverRef}
                style={{ ...categoryPopoverStyle, zIndex: 60 }}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="rounded-xl bg-navy-light border border-white/[0.08] shadow-card max-h-56 overflow-y-auto backdrop-blur-md"
              >
                {filtered.length === 0 ? (
                  <p className="text-xs text-gray-600 px-3 py-2.5">
                    "{form.category}" is a new category. It'll be added when you save.
                  </p>
                ) : (
                  filtered.map(c => {
                    const isSelected = c.toLowerCase() === form.category.trim().toLowerCase();
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setForm(prev => ({ ...prev, category: c }));
                          setCategoryOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between ${
                          isSelected
                            ? 'bg-gold/10 text-gold'
                            : 'text-gray-200 hover:bg-white/[0.04]'
                        }`}
                      >
                        <span>{c}</span>
                        {isSelected && (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    );
                  })
                )}
              </motion.div>
            );
          })()}
        </AnimatePresence>,
        document.body
      )}
    </PageTransition>
  );
}
