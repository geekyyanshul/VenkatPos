import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getOrder, transitionOrder } from '../api/orders';
import { getBillByOrder } from '../api/bills';
import StatusBadge from '../components/StatusBadge';
import BillCard from '../components/BillCard';
import PaymentForm from '../components/PaymentForm';

const NEXT_STATUS = {
  CREATED: 'CONFIRMED',
  CONFIRMED: 'PREPARING',
  PREPARING: 'READY',
  READY: 'SERVED',
  SERVED: 'PAID',
};

const NEXT_LABEL = {
  CREATED: 'Confirm Order',
  CONFIRMED: 'Start Preparing',
  PREPARING: 'Mark Ready',
  READY: 'Mark Served',
  SERVED: 'Generate Bill & Pay',
};

const CAN_CANCEL = ['CREATED', 'CONFIRMED'];
const BILL_ENABLED = ['READY', 'SERVED', 'PAID'];

function shortId(id) {
  return id ? id.slice(0, 8).toUpperCase() : '—';
}

export default function OrderDetail() {
  const { orderId } = useParams();
  const navigate = useNavigate();

  const [order, setOrder] = useState(null);
  const [bill, setBill] = useState(null);
  const [showPayForm, setShowPayForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getOrder(orderId),
      getBillByOrder(orderId).catch(err => {
        if (err.status === 404 || /not found/i.test(err.message)) return null;
        throw err;
      }),
    ])
      .then(([o, b]) => { setOrder(o); setBill(b); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [orderId]); // <-- this was missing, causing everything below to be trapped inside useEffect

  async function handleTransition(newStatus) {
    setActionError('');
    setActionLoading(true);
    try {
      const updated = await transitionOrder(orderId, newStatus);
      setOrder(updated);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancel() {
    if (!window.confirm('Cancel this order?')) return;
    await handleTransition('CANCELLED');
  }

  function handleBillGenerated(newBill) {
    setBill(newBill);
  }

  function handlePaymentSuccess(result) {
    setBill(prev => ({ ...prev, status: 'PAID' }));
    setOrder(prev => ({ ...prev, status: 'PAID' }));
    setShowPayForm(false);
  }

  if (loading) return <div className="page-center"><p>Loading order…</p></div>;
  if (error) return <div className="page-center"><p className="error-msg">{error}</p></div>;
  if (!order) return null;

  const nextStatus = NEXT_STATUS[order.status];
  const nextLabel = NEXT_LABEL[order.status];
  const canCancel = CAN_CANCEL.includes(order.status);
  const billEnabled = BILL_ENABLED.includes(order.status);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button className="btn-link back-link" onClick={() => navigate('/orders')}>← Orders</button>
          <h2>Order <code>{shortId(order.order_id)}</code></h2>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {actionError && <p className="error-msg">{actionError}</p>}

      <div className="order-detail-layout">
        <div className="order-detail-main">
          <div className="card">
            <h3>Details</h3>
            <dl className="detail-list">
              <dt>Type</dt>
              <dd>{order.order_type === 'DINE_IN' ? '🍽 Dine-in' : '🥡 Takeaway'}</dd>
              {order.table_number && <><dt>Table</dt><dd>{order.table_number}</dd></>}
              <dt>Order ID</dt>
              <dd><code>{order.order_id}</code></dd>
              <dt>Created</dt>
              <dd>{new Date(order.created_at).toLocaleString()}</dd>
            </dl>
          </div>

          <div className="card">
            <h3>Items</h3>
            <table className="items-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Unit Price</th>
                  <th>Total</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map(item => (
                  <tr key={item.order_item_id}>
                    <td>{item.name}</td>
                    <td>{item.quantity}</td>
                    <td>₹{parseFloat(item.unit_price).toFixed(2)}</td>
                    <td>₹{(parseFloat(item.unit_price) * item.quantity).toFixed(2)}</td>
                    <td>{item.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="order-detail-sidebar">
          {order.status !== 'PAID' && order.status !== 'CANCELLED' && (
            <div className="card">
              <h3>Actions</h3>
              <div className="action-buttons">
                {nextStatus && nextStatus !== 'PAID' && (
                  <button
                    className="btn btn-primary full-width"
                    onClick={() => handleTransition(nextStatus)}
                    disabled={actionLoading}
                  >
                    {actionLoading ? 'Updating…' : nextLabel}
                  </button>
                )}
                {canCancel && (
                  <button
                    className="btn btn-danger full-width"
                    onClick={handleCancel}
                    disabled={actionLoading}
                  >
                    Cancel Order
                  </button>
                )}
              </div>
            </div>
          )}

          {billEnabled && !bill && (
            <BillCard
              orderId={order.order_id}
              bill={null}
              onBillGenerated={handleBillGenerated}
            />
          )}

          {bill && !showPayForm && (
            <BillCard
              orderId={order.order_id}
              bill={bill}
              onBillGenerated={handleBillGenerated}
              onPayClick={() => setShowPayForm(true)}
            />
          )}

          {bill && showPayForm && bill.status === 'UNPAID' && (
            <PaymentForm
              bill={bill}
              onPaymentSuccess={handlePaymentSuccess}
            />
          )}

          {bill && bill.status === 'PAID' && !showPayForm && (
            <p className="success-msg">✓ Order fully paid</p>
          )}
        </div>
      </div>
    </div>
  );
}