import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createOrder } from '../api/orders';
import { getMenuItems } from '../api/outlets';
import { useOutlet } from '../context/OutletContext';
import MenuItemPicker from '../components/MenuItemPicker';

export default function CreateOrder() {
  const { outlet } = useOutlet();
  const navigate = useNavigate();

  const [orderType, setOrderType] = useState('DINE_IN');
  const [tableNumber, setTableNumber] = useState('');
  const [menuItems, setMenuItems] = useState([]);
  const [cartItems, setCartItems] = useState([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!outlet) return;
    getMenuItems(outlet.outlet_id)
      .then(setMenuItems)
      .catch(err => setMenuError(err.message))
      .finally(() => setMenuLoading(false));
  }, [outlet]);

  function addItem(item) {
    setCartItems(prev => {
      const existing = prev.find(c => c.menu_item_id === item.menu_item_id);
      if (existing) {
        return prev.map(c => c.menu_item_id === item.menu_item_id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { menu_item_id: item.menu_item_id, quantity: 1, notes: '', unit_price: item.price, name: item.name }];
    });
  }

  function removeItem(menuItemId) {
    setCartItems(prev => {
      const existing = prev.find(c => c.menu_item_id === menuItemId);
      if (!existing || existing.quantity <= 1) {
        return prev.filter(c => c.menu_item_id !== menuItemId);
      }
      return prev.map(c => c.menu_item_id === menuItemId ? { ...c, quantity: c.quantity - 1 } : c);
    });
  }

  function updateNote(menuItemId, notes) {
    setCartItems(prev => prev.map(c => c.menu_item_id === menuItemId ? { ...c, notes } : c));
  }

  const subtotal = cartItems.reduce((sum, c) => sum + parseFloat(c.unit_price) * c.quantity, 0);

  async function handleSubmit(e) {
    e.preventDefault();
    if (cartItems.length === 0) { setSubmitError('Add at least one item.'); return; }
    setSubmitError('');
    setSubmitting(true);
    try {
      const payload = {
        outlet_id: outlet.outlet_id,
        order_type: orderType,
        table_number: orderType === 'DINE_IN' ? parseInt(tableNumber, 10) : undefined,
        items: cartItems.map(c => ({
          menu_item_id: c.menu_item_id,
          quantity: c.quantity,
          notes: c.notes || undefined,
        })),
      };
      const order = await createOrder(payload);
      navigate(`/orders/${order.order_id}`);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!outlet) {
    return <div className="page-center"><p>No outlet selected. <button className="btn-link" onClick={() => navigate('/')}>Choose outlet</button></p></div>;
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button className="btn-link back-link" onClick={() => navigate('/orders')}>← Orders</button>
          <h2>New Order — {outlet.name}</h2>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="create-order-layout">
        <div className="create-order-main">
          <div className="card">
            <h3>Order Details</h3>
            <div className="form-row">
              <label>Order Type</label>
              <div className="radio-group">
                <label>
                  <input type="radio" value="DINE_IN" checked={orderType === 'DINE_IN'} onChange={() => setOrderType('DINE_IN')} />
                  🍽 Dine-in
                </label>
                <label>
                  <input type="radio" value="TAKEAWAY" checked={orderType === 'TAKEAWAY'} onChange={() => setOrderType('TAKEAWAY')} />
                  🥡 Takeaway
                </label>
              </div>
            </div>
            {orderType === 'DINE_IN' && (
              <div className="form-row">
                <label>Table Number</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={tableNumber}
                  onChange={e => setTableNumber(e.target.value)}
                  placeholder="e.g. 5"
                />
              </div>
            )}
          </div>

          <div className="card">
            <h3>Menu Items</h3>
            {menuLoading && <p>Loading menu…</p>}
            {menuError && <p className="error-msg">{menuError}</p>}
            {!menuLoading && !menuError && (
              <MenuItemPicker
                menuItems={menuItems}
                cartItems={cartItems}
                onAdd={addItem}
                onRemove={removeItem}
                onNoteChange={updateNote}
              />
            )}
          </div>
        </div>

        <div className="create-order-sidebar">
          <div className="card cart-summary">
            <h3>Order Summary</h3>
            {cartItems.length === 0 && <p className="empty-state">No items added yet.</p>}
            {cartItems.map(c => (
              <div key={c.menu_item_id} className="cart-row">
                <span>{c.name} × {c.quantity}</span>
                <span>₹{(parseFloat(c.unit_price) * c.quantity).toFixed(2)}</span>
              </div>
            ))}
            {cartItems.length > 0 && (
              <div className="cart-subtotal">
                <strong>Subtotal</strong>
                <strong>₹{subtotal.toFixed(2)}</strong>
              </div>
            )}
            {submitError && <p className="error-msg">{submitError}</p>}
            <button className="btn btn-primary full-width" type="submit" disabled={submitting || cartItems.length === 0}>
              {submitting ? 'Creating…' : 'Place Order'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
