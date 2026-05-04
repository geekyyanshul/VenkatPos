import { useState } from 'react';
import { generateBill } from '../api/bills';

export default function BillCard({ orderId, bill, onBillGenerated, onPayClick }) {
  const [discountType, setDiscountType] = useState('PERCENTAGE');
  const [discountValue, setDiscountValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleGenerate(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const discount = discountValue ? { type: discountType, value: parseFloat(discountValue) } : null;
      const newBill = await generateBill(orderId, discount);
      onBillGenerated(newBill);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (bill) {
    return (
      <div className="card">
        <h3>Bill</h3>
        <table className="bill-table">
          <tbody>
            <tr><td>Subtotal</td><td>₹{parseFloat(bill.subtotal).toFixed(2)}</td></tr>
            {bill.discount_type && (
              <tr>
                <td>Discount ({bill.discount_type === 'PERCENTAGE' ? `${bill.discount_value}%` : `₹${bill.discount_value}`})</td>
                <td>−₹{parseFloat(bill.discount_amount || 0).toFixed(2)}</td>
              </tr>
            )}
            <tr><td>Tax</td><td>₹{parseFloat(bill.tax_amount).toFixed(2)}</td></tr>
            <tr className="bill-total"><td><strong>Total</strong></td><td><strong>₹{parseFloat(bill.total).toFixed(2)}</strong></td></tr>
          </tbody>
        </table>
        {bill.status === 'UNPAID' && (
          <button className="btn btn-primary" onClick={() => onPayClick(bill)}>
            Record Payment
          </button>
        )}
        {bill.status === 'PAID' && (
          <p className="success-msg">✓ Bill paid</p>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Generate Bill</h3>
      <form onSubmit={handleGenerate}>
        <div className="form-row">
          <label>Discount type</label>
          <select value={discountType} onChange={e => setDiscountType(e.target.value)}>
            <option value="PERCENTAGE">Percentage (%)</option>
            <option value="FLAT">Flat (₹)</option>
          </select>
        </div>
        <div className="form-row">
          <label>Discount value <span className="hint">(leave blank for no discount)</span></label>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 10"
            value={discountValue}
            onChange={e => setDiscountValue(e.target.value)}
          />
        </div>
        {error && <p className="error-msg">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? 'Generating…' : 'Generate Bill'}
        </button>
      </form>
    </div>
  );
}
