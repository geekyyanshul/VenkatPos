import { useState, useRef } from 'react';
import { recordPayment } from '../api/payments';

function randomUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
}

export default function PaymentForm({ bill, onPaymentSuccess }) {
  const [amount, setAmount] = useState(String(bill.total));
  const [method, setMethod] = useState('CASH');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Idempotency key is generated once and reused on retries
  const idempotencyKey = useRef(randomUUID());

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await recordPayment(bill.bill_id, parseFloat(amount), method, idempotencyKey.current);
      onPaymentSuccess(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h3>Record Payment</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label>Amount (₹)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            required
          />
        </div>
        <div className="form-row">
          <label>Method</label>
          <select value={method} onChange={e => setMethod(e.target.value)}>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card</option>
          </select>
        </div>
        {error && <p className="error-msg">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? 'Processing…' : 'Record Payment'}
        </button>
      </form>
    </div>
  );
}
