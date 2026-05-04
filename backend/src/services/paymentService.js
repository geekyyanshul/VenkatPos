const crypto = require('crypto');
const { pool } = require('../db');

class ValidationError extends Error { constructor(msg) { super(msg); this.name = 'ValidationError'; } }
class NotFoundError extends Error { constructor(msg) { super(msg); this.name = 'NotFoundError'; } }
class ConflictError extends Error { constructor(msg) { super(msg); this.name = 'ConflictError'; } }

async function recordPayment(input, idempotencyKey) {
  const { eventBus } = require('../events');
  const { bill_id, amount, method } = input;

  if (!bill_id || !amount || !method) {
    throw new ValidationError('bill_id, amount, method required');
  }
  if (!['CASH', 'UPI', 'CARD'].includes(method)) {
    throw new ValidationError('method must be CASH, UPI or CARD');
  }
  if (amount <= 0) {
    throw new ValidationError('amount must be positive');
  }
  if (!idempotencyKey) {
    throw new ValidationError('Idempotency-Key header required');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cached = await client.query(
      'SELECT response_status, response_body FROM idempotency_keys WHERE key = $1',
      [idempotencyKey]
    );
    if (cached.rowCount > 0) {
      await client.query('COMMIT');
      return { cached: true, status: cached.rows[0].response_status, body: cached.rows[0].response_body };
    }

    const billResult = await client.query(
      'SELECT bill_id, total, status FROM bills WHERE bill_id = $1 FOR UPDATE',
      [bill_id]
    );
    if (billResult.rowCount === 0) {
      throw new NotFoundError('bill not found');
    }
    const bill = billResult.rows[0];

    if (bill.status === 'PAID') {
      throw new ConflictError('bill is already paid');
    }
    if (parseFloat(amount) !== parseFloat(bill.total)) {
      throw new ValidationError('amount does not match bill total ' + bill.total);
    }

    const payment_id = crypto.randomUUID();
    await client.query(
      `INSERT INTO payments (payment_id, bill_id, amount, method)
       VALUES ($1, $2, $3, $4)`,
      [payment_id, bill_id, amount, method]
    );

    await client.query(
      `UPDATE bills SET status = 'PAID' WHERE bill_id = $1`,
      [bill_id]
    );

    await client.query(
      `UPDATE orders SET status = 'PAID', version = version + 1, updated_at = NOW()
       WHERE order_id = (SELECT order_id FROM bills WHERE bill_id = $1)`,
      [bill_id]
    );

    const responseBody = { payment_id, bill_id, amount, method, bill_status: 'PAID' };
    await client.query(
      `INSERT INTO idempotency_keys (key, response_status, response_body)
       VALUES ($1, $2, $3)`,
      [idempotencyKey, 201, JSON.stringify(responseBody)]
    );

    await client.query('COMMIT');

    eventBus.emit('payment.recorded', { payment_id, bill_id });

    return { cached: false, status: 201, body: responseBody };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { recordPayment, ValidationError, NotFoundError, ConflictError };