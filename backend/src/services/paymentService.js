const crypto = require('crypto');
const { pool } = require('../db');
const { recordEvent } = require('../outbox');

class ValidationError extends Error { constructor(msg) { super(msg); this.name = 'ValidationError'; } }
class NotFoundError extends Error { constructor(msg) { super(msg); this.name = 'NotFoundError'; } }
class ConflictError extends Error { constructor(msg) { super(msg); this.name = 'ConflictError'; } }

/**
 * Record a payment against a bill. Supports split payments — multiple calls
 * for the same bill_id with different amounts/methods. The bill is marked
 * PAID only when the cumulative payments meet or exceed the bill total.
 *
 * Concurrency model:
 *   - Pessimistic lock on bills row (SELECT ... FOR UPDATE) serializes
 *     concurrent payment attempts on the same bill. Without this, two
 *     simultaneous partial payments could both observe "still owed" and
 *     both succeed without marking PAID — or worse, two final payments
 *     could both observe "now fully paid" and both try to transition the
 *     order, racing on the version column.
 *   - Idempotency-Key cache uses a transaction-local SELECT to ensure
 *     that retrying a request always returns the same response, never
 *     creates a duplicate payment row.
 *
 * Atomicity:
 *   - Payment INSERT, bill status UPDATE (when fully paid), order status
 *     UPDATE (when fully paid), idempotency cache INSERT, and outbox
 *     event INSERT are all in one transaction. Either everything happens
 *     or nothing happens — no partial states reachable.
 */
async function recordPayment(input, idempotencyKey) {
  const { bill_id, amount, method } = input;

  // ---- Validation ----
  if (!bill_id || amount === undefined || amount === null || !method) {
    throw new ValidationError('bill_id, amount, method required');
  }
  if (!['CASH', 'UPI', 'CARD'].includes(method)) {
    throw new ValidationError('method must be CASH, UPI or CARD');
  }
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) {
    throw new ValidationError('amount must be positive');
  }
  if (!idempotencyKey) {
    throw new ValidationError('Idempotency-Key header required');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ---- Idempotency check ----
    // If this key was used before, return the cached response without
    // re-executing. This makes network-level retries safe (no double charging).
    const cached = await client.query(
      'SELECT response_status, response_body FROM idempotency_keys WHERE key = $1',
      [idempotencyKey]
    );
    if (cached.rowCount > 0) {
      await client.query('COMMIT');
      return {
        cached: true,
        status: cached.rows[0].response_status,
        body: cached.rows[0].response_body,
      };
    }

    // ---- Lock the bill row ----
    // FOR UPDATE serializes concurrent payment attempts on the same bill.
    const billResult = await client.query(
      'SELECT bill_id, order_id, total, status FROM bills WHERE bill_id = $1 FOR UPDATE',
      [bill_id]
    );
    if (billResult.rowCount === 0) {
      throw new NotFoundError('bill not found');
    }
    const bill = billResult.rows[0];

    if (bill.status === 'PAID') {
      throw new ConflictError('bill is already paid');
    }

    // ---- Compute amount paid so far (NOT including this payment) ----
    const paidSoFarResult = await client.query(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE bill_id = $1',
      [bill_id]
    );
    const paidSoFar = parseFloat(paidSoFarResult.rows[0].paid);
    const billTotal = parseFloat(bill.total);
    const remaining = +(billTotal - paidSoFar).toFixed(2);

    // ---- Reject overpayment ----
    // Allow tiny rounding tolerance (1 paisa) for floating-point safety.
    if (amt > remaining + 0.01) {
      throw new ValidationError(
        `amount ${amt.toFixed(2)} exceeds remaining balance ${remaining.toFixed(2)}`
      );
    }

    // ---- Insert the payment ----
    const payment_id = crypto.randomUUID();
    await client.query(
      `INSERT INTO payments (payment_id, bill_id, amount, method)
       VALUES ($1, $2, $3, $4)`,
      [payment_id, bill_id, amt, method]
    );

    // ---- Determine if bill is now fully paid ----
    const newPaidTotal = +(paidSoFar + amt).toFixed(2);
    const isFullyPaid = newPaidTotal + 0.01 >= billTotal;

    let billStatus = 'UNPAID';
    let orderStatus = null;

    if (isFullyPaid) {
      // Mark bill PAID
      await client.query(
        `UPDATE bills SET status = 'PAID' WHERE bill_id = $1`,
        [bill_id]
      );
      billStatus = 'PAID';

      // Transition order to PAID
      // We don't optimistic-lock here because the bill FOR UPDATE already
      // serializes us — no other writer can touch the bill, and the only
      // path to PAID for the order is through paying the bill.
      await client.query(
        `UPDATE orders 
         SET status = 'PAID', version = version + 1, updated_at = NOW()
         WHERE order_id = $1`,
        [bill.order_id]
      );
      orderStatus = 'PAID';
    }

    // ---- Build response ----
    const responseBody = {
      payment_id,
      bill_id,
      amount: amt,
      method,
      bill_status: billStatus,
      paid_so_far: newPaidTotal,
      bill_total: billTotal,
      remaining: +(billTotal - newPaidTotal).toFixed(2),
    };

    // ---- Cache idempotent response ----
    await client.query(
      `INSERT INTO idempotency_keys (key, response_status, response_body)
       VALUES ($1, $2, $3)`,
      [idempotencyKey, 201, JSON.stringify(responseBody)]
    );

    // ---- Record events in the SAME transaction (outbox pattern) ----
    await recordEvent(client, 'payment.recorded', payment_id, {
      payment_id,
      bill_id,
      order_id: bill.order_id,
      amount: amt,
      method,
      paid_so_far: newPaidTotal,
      bill_total: billTotal,
    });

    if (isFullyPaid) {
      await recordEvent(client, 'bill.paid', bill_id, {
        bill_id,
        order_id: bill.order_id,
        total: billTotal,
      });
      await recordEvent(client, 'order.status_changed', bill.order_id, {
        order_id: bill.order_id,
        from: 'SERVED',
        to: 'PAID',
        triggered_by: 'payment',
      });
    }

    await client.query('COMMIT');

    return { cached: false, status: 201, body: responseBody };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { recordPayment, ValidationError, NotFoundError, ConflictError };