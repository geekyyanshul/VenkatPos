const BASE = '/api';

export async function getBillByOrder(orderId) {
  const res = await fetch(`${BASE}/bills/by-order/${orderId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch bill');
  return res.json();
}

export async function generateBill(orderId, discount) {
  const payload = { order_id: orderId };
  if (discount && discount.value) payload.discount = discount;
  const res = await fetch(`${BASE}/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to generate bill');
  return data;
}
