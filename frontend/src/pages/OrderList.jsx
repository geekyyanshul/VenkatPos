import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listOrders } from '../api/orders';
import { useOutlet } from '../context/OutletContext';
import StatusBadge from '../components/StatusBadge';

function formatTime(iso) {
  return new Date(iso).toLocaleString();
}

function shortId(id) {
  return id ? id.slice(0, 8).toUpperCase() : '—';
}

export default function OrderList() {
  const { outlet, setOutlet } = useOutlet();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const fetchOrders = useCallback(() => {
    if (!outlet) return;
    listOrders(outlet.outlet_id)
      .then(data => { setOrders(data); setError(''); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [outlet]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 10000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  if (!outlet) {
    return (
      <div className="page-center">
        <p>No outlet selected. <button className="btn-link" onClick={() => navigate('/')}>Choose outlet</button></p>
      </div>
    );
  }

  const STATUS_ORDER = ['CREATED', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'PAID', 'CANCELLED'];
  const grouped = STATUS_ORDER.reduce((acc, s) => {
    const rows = orders.filter(o => o.status === s);
    if (rows.length > 0) acc[s] = rows;
    return acc;
  }, {});

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>{outlet.name}</h2>
          <span className="subtitle">Orders</span>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => { setOutlet(null); navigate('/'); }}>
            Switch Outlet
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/orders/new')}>
            + New Order
          </button>
        </div>
      </div>

      {loading && <p>Loading orders…</p>}
      {error && <p className="error-msg">{error}</p>}

      {!loading && orders.length === 0 && (
        <p className="empty-state">No orders yet. Create one to get started.</p>
      )}

      {Object.entries(grouped).map(([status, rows]) => (
        <div key={status} className="status-group">
          <h3 className="group-heading"><StatusBadge status={status} /> <span>{rows.length}</span></h3>
          <table className="orders-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Type</th>
                <th>Table</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(order => (
                <tr key={order.order_id} onClick={() => navigate(`/orders/${order.order_id}`)} className="clickable-row">
                  <td><code>{shortId(order.order_id)}</code></td>
                  <td>{order.order_type === 'DINE_IN' ? '🍽 Dine-in' : '🥡 Takeaway'}</td>
                  <td>{order.table_number ?? '—'}</td>
                  <td>{formatTime(order.created_at)}</td>
                  <td><button className="btn btn-sm">View →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
