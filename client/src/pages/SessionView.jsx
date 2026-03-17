import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';

const API = '/api';

export default function SessionView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState('');
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [sessionRes, productsRes, salesRes] = await Promise.all([
        fetch(`${API}/sessions/${id}`),
        fetch(`${API}/products`),
        fetch(`${API}/sales/session/${id}`),
      ]);
      const [sessionData, productsData, salesData] = await Promise.all([
        sessionRes.json(), productsRes.json(), salesRes.json(),
      ]);
      setSession(sessionData);
      setProducts(productsData);
      setSales(salesData);
    } catch (err) {
      console.error('Failed to load session:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const selectProduct = (product) => {
    setSelectedProduct(product);
    setPrice(product.default_price.toString());
    setQuantity(1);
  };

  const recordSale = async () => {
    if (!selectedProduct || recording) return;
    setRecording(true);
    try {
      const res = await fetch(`${API}/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: id,
          product_id: selectedProduct.id,
          quantity,
          price_charged: parseFloat(price),
        }),
      });
      if (res.ok) {
        const sale = await res.json();
        setSales(prev => [sale, ...prev]);
        // Update session stats
        setSession(prev => ({
          ...prev,
          stats: {
            ...prev.stats,
            total_revenue: prev.stats.total_revenue + (quantity * parseFloat(price)),
            total_units: prev.stats.total_units + quantity,
            total_sales: prev.stats.total_sales + 1,
          },
        }));
        setSelectedProduct(null);
        setQuantity(1);
        setPrice('');
      }
    } catch (err) {
      console.error('Failed to record sale:', err);
    } finally {
      setRecording(false);
    }
  };

  const undoSale = async (saleId) => {
    try {
      const sale = sales.find(s => s.id === saleId);
      await fetch(`${API}/sales/${saleId}`, { method: 'DELETE' });
      setSales(prev => prev.filter(s => s.id !== saleId));
      if (sale) {
        setSession(prev => ({
          ...prev,
          stats: {
            ...prev.stats,
            total_revenue: prev.stats.total_revenue - (sale.quantity * parseFloat(sale.price_charged)),
            total_units: prev.stats.total_units - sale.quantity,
            total_sales: prev.stats.total_sales - 1,
          },
        }));
      }
    } catch (err) {
      console.error('Failed to undo sale:', err);
    }
  };

  const closeSession = async () => {
    await fetch(`${API}/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    });
    fetchData();
  };

  const reopenSession = async () => {
    await fetch(`${API}/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    fetchData();
  };

  const exportSession = (format) => {
    window.open(`${API}/export/${id}?format=${format}`, '_blank');
  };

  if (loading) return <div className="text-center text-gray-500 py-16">Loading...</div>;
  if (!session) return <div className="text-center text-gray-500 py-16">Session not found</div>;

  const isActive = session.status === 'active';
  const stats = session.stats || { total_revenue: 0, total_units: 0, total_sales: 0 };

  // Group products by category
  const categories = {};
  products.forEach(p => {
    const cat = p.category || 'Other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(p);
  });

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <Link to="/" className="text-gray-400 hover:text-gold transition-colors">
          &larr; Back
        </Link>
        {isActive && (
          <span className="text-xs bg-green-900/50 text-green-400 px-2 py-0.5 rounded-full">Live</span>
        )}
      </div>

      <h1 className="text-xl font-bold text-white mb-1">{session.name}</h1>
      <p className="text-gray-400 text-sm mb-4">
        {session.location && `${session.location} · `}
        {new Date(session.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
      </p>

      {/* Live Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="card text-center">
          <p className="text-gray-400 text-xs mb-1">Revenue</p>
          <p className="text-lg font-bold text-gold">${stats.total_revenue.toFixed(2)}</p>
        </div>
        <div className="card text-center">
          <p className="text-gray-400 text-xs mb-1">Units</p>
          <p className="text-lg font-bold text-white">{stats.total_units}</p>
        </div>
        <div className="card text-center">
          <p className="text-gray-400 text-xs mb-1">Sales</p>
          <p className="text-lg font-bold text-white">{stats.total_sales}</p>
        </div>
      </div>

      {/* Product Selection (only when active) */}
      {isActive && !selectedProduct && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gold uppercase tracking-wider mb-3">Tap to Sell</h2>
          {Object.entries(categories).map(([cat, prods]) => (
            <div key={cat} className="mb-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{cat}</p>
              <div className="grid grid-cols-2 gap-2">
                {prods.map(p => (
                  <button
                    key={p.id}
                    onClick={() => selectProduct(p)}
                    className="card text-left hover:border-gold/50 transition-colors active:scale-95"
                  >
                    <p className="font-medium text-white text-sm">{p.name}</p>
                    <p className="text-gold text-sm">${parseFloat(p.default_price).toFixed(2)}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sale Form */}
      {isActive && selectedProduct && (
        <div className="card mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white">{selectedProduct.name}</h3>
            <button onClick={() => setSelectedProduct(null)} className="text-gray-500 hover:text-white text-sm">
              Cancel
            </button>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-400 block mb-1">Quantity</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="btn-outline px-3 py-2 text-lg"
                >-</button>
                <input
                  type="number"
                  value={quantity}
                  onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16 text-center text-lg"
                  min="1"
                />
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="btn-outline px-3 py-2 text-lg"
                >+</button>
              </div>
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-400 block mb-1">Price Each ($)</label>
              <input
                type="number"
                value={price}
                onChange={e => setPrice(e.target.value)}
                className="w-full text-lg"
                step="0.01"
                min="0"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-gray-700">
            <span className="text-gray-400">Total</span>
            <span className="text-xl font-bold text-gold">
              ${(quantity * (parseFloat(price) || 0)).toFixed(2)}
            </span>
          </div>

          <button
            onClick={recordSale}
            disabled={recording || !price || parseFloat(price) <= 0}
            className="btn-gold w-full text-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {recording ? 'Recording...' : 'Record Sale'}
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mb-6">
        {isActive ? (
          <button onClick={closeSession} className="btn-outline flex-1 text-sm">
            Close Session
          </button>
        ) : (
          <button onClick={reopenSession} className="btn-outline flex-1 text-sm">
            Reopen Session
          </button>
        )}
        <button onClick={() => exportSession('xlsx')} className="btn-gold flex-1 text-sm">
          Export XLSX
        </button>
        <button onClick={() => exportSession('csv')} className="btn-outline flex-1 text-sm">
          CSV
        </button>
      </div>

      {/* Recent Sales */}
      {sales.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Sales Log ({sales.length})
          </h2>
          <div className="space-y-2">
            {sales.map(sale => (
              <div key={sale.id} className="card flex items-center justify-between">
                <div>
                  <p className="font-medium text-white text-sm">{sale.product_name}</p>
                  <p className="text-gray-400 text-xs">
                    {sale.quantity}x @ ${parseFloat(sale.price_charged).toFixed(2)}
                    {' · '}
                    {new Date(sale.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-gold text-sm">
                    ${(sale.quantity * parseFloat(sale.price_charged)).toFixed(2)}
                  </span>
                  {isActive && (
                    <button
                      onClick={() => undoSale(sale.id)}
                      className="text-red-400 hover:text-red-300 text-xs"
                      title="Undo sale"
                    >
                      Undo
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
