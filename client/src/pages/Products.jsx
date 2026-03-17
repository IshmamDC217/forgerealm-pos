import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const API = '/api';

export default function Products() {
  const [products, setProducts] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', default_price: '', category: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/products`)
      .then(r => r.json())
      .then(data => { setProducts(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const resetForm = () => {
    setForm({ name: '', default_price: '', category: '' });
    setShowNew(false);
    setEditingId(null);
  };

  const saveProduct = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.default_price) return;

    const body = {
      name: form.name.trim(),
      default_price: parseFloat(form.default_price),
      category: form.category.trim() || null,
    };

    if (editingId) {
      const res = await fetch(`${API}/products/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated = await res.json();
        setProducts(prev => prev.map(p => p.id === editingId ? updated : p));
        resetForm();
      }
    } else {
      const res = await fetch(`${API}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const created = await res.json();
        setProducts(prev => [...prev, created]);
        resetForm();
      }
    }
  };

  const startEdit = (product) => {
    setEditingId(product.id);
    setForm({
      name: product.name,
      default_price: product.default_price.toString(),
      category: product.category || '',
    });
    setShowNew(true);
  };

  const deleteProduct = async (productId) => {
    if (!confirm('Delete this product? It cannot be deleted if it has sales.')) return;
    const res = await fetch(`${API}/products/${productId}`, { method: 'DELETE' });
    if (res.ok) {
      setProducts(prev => prev.filter(p => p.id !== productId));
    } else {
      const err = await res.json();
      alert(err.error || 'Cannot delete product with existing sales');
    }
  };

  // Group by category
  const categories = {};
  products.forEach(p => {
    const cat = p.category || 'Other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(p);
  });

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link to="/" className="text-gray-400 hover:text-gold transition-colors text-sm">
            &larr; Back
          </Link>
          <h1 className="text-xl font-bold text-white mt-1">Product Catalog</h1>
        </div>
        <button
          onClick={() => { resetForm(); setShowNew(true); }}
          className="btn-gold text-sm px-3 py-2"
        >
          + Add Product
        </button>
      </div>

      {/* Add/Edit Form */}
      {showNew && (
        <form onSubmit={saveProduct} className="card mb-6 space-y-3">
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
          <div className="flex gap-3">
            <input
              type="number"
              placeholder="Default price"
              value={form.default_price}
              onChange={e => setForm({ ...form, default_price: e.target.value })}
              className="flex-1"
              step="0.01"
              min="0"
            />
            <input
              type="text"
              placeholder="Category"
              value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })}
              className="flex-1"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-gold flex-1">
              {editingId ? 'Update' : 'Add Product'}
            </button>
            <button type="button" onClick={resetForm} className="btn-outline flex-1">Cancel</button>
          </div>
        </form>
      )}

      {/* Product List */}
      {Object.entries(categories).sort(([a], [b]) => a.localeCompare(b)).map(([cat, prods]) => (
        <div key={cat} className="mb-6">
          <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-2">{cat}</h2>
          <div className="space-y-2">
            {prods.map(p => (
              <div key={p.id} className="card flex items-center justify-between">
                <div>
                  <p className="font-medium text-white">{p.name}</p>
                  <p className="text-gold text-sm">${parseFloat(p.default_price).toFixed(2)}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => startEdit(p)}
                    className="text-gray-400 hover:text-gold text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteProduct(p.id)}
                    className="text-gray-400 hover:text-red-400 text-xs"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {loading && <div className="text-center text-gray-500 py-8">Loading...</div>}
      {!loading && products.length === 0 && (
        <div className="text-center text-gray-500 py-8">
          <p className="text-lg mb-2">No products yet</p>
          <p className="text-sm">Add your first product to get started</p>
        </div>
      )}
    </div>
  );
}
