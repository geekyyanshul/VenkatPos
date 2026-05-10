const BASE = import.meta.env.VITE_API_URL || '/api';

export async function recordPayment(billId, amount, method, idempotencyKey) {
  const res = await fetch(`${BASE}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ bill_id: billId, amount: parseFloat(amount), method }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to record payment');
  return data;
}
