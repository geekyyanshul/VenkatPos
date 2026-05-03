const BASE = '/api';

export async function listOrders(outletId) {
  const res = await fetch(`${BASE}/orders?outlet_id=${outletId}`);
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch orders');
  return res.json();
}

export async function getOrder(orderId) {
  const res = await fetch(`${BASE}/orders/${orderId}`);
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch order');
  return res.json();
}

export async function createOrder(payload) {
  const res = await fetch(`${BASE}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create order');
  return data;
}

export async function transitionOrder(orderId, newStatus) {
  const res = await fetch(`${BASE}/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_status: newStatus }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update order status');
  return data;
}
