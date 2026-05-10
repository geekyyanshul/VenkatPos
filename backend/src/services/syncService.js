const { pool } = require('../db');
const orderService = require('./orderService');
const paymentService = require('./paymentService');

/**
 * Process a batch of operations submitted from an offline client.
 * 
 * Each operation has its own transaction — if op #2 conflicts, op #1
 * still committed. The client receives per-operation results and can
 * surface conflicts to the user (e.g., "table 5's order was already
 * confirmed by another waiter while you were offline").
 *
 * Idempotency: every operation has a client_op_id (UUID generated on
 * the device when the action originally happened). We store every
 * processed op in `sync_operations` keyed by client_op_id. Re-syncing
 * the same batch (network flake during the sync request itself)
 * returns cached results without re-executing. This makes /sync itself
 * safe to retry.
 *
 * Conflict resolution is per-operation-type:
 *   - create_order:     always applied (UUID dedup; can't conflict)
 *   - transition_order: version-based optimistic locking
 *   - cancel_order:     idempotent
 *   - create_payment:   delegates to payment idempotency key
 */
async function processSyncBatch({ device_id, operations }) {
  if (!device_id || !Array.isArray(operations)) {
    const err = new Error('device_id and operations[] required');
    err.name = 'ValidationError';
    throw err;
  }

  const results = [];

  for (const op of operations) {
    const result = await processOperation(device_id, op);
    results.push(result);
  }

  return { results };
}

/**
 * Process a single operation. Wraps each in its own transaction so
 * one failure doesn't roll back the others.
 */
async function processOperation(device_id, op) {
  const { client_op_id, type, client_timestamp, payload } = op;

  // ---- Validate the operation envelope ----
  if (!client_op_id || !type || !client_timestamp) {
    return {
      client_op_id: client_op_id || null,
      status: 'rejected',
      reason: 'client_op_id, type, client_timestamp required',
    };
  }

  // ---- Check if we've seen this op before (idempotency) ----
  // Done outside the per-op transaction so the cached read is fast
  // and never blocks a concurrent op processing on a different op_id.
  const cached = await pool.query(
    'SELECT status, result_payload, conflict_reason FROM sync_operations WHERE client_op_id = $1',
    [client_op_id]
  );
  if (cached.rowCount > 0) {
    return {
      client_op_id,
      status: cached.rows[0].status,
      cached: true,
      ...(cached.rows[0].result_payload || {}),
      ...(cached.rows[0].conflict_reason && { reason: cached.rows[0].conflict_reason }),
    };
  }

  // ---- Dispatch by type ----
  let outcome;
  try {
    switch (type) {
      case 'create_order':
        outcome = await applyCreateOrder(payload);
        break;
      case 'transition_order':
        outcome = await applyTransitionOrder(payload);
        break;
      case 'cancel_order':
        outcome = await applyCancelOrder(payload);
        break;
      case 'create_payment':
        outcome = await applyCreatePayment(payload, client_op_id);
        break;
      default:
        outcome = { status: 'rejected', reason: `unknown operation type: ${type}` };
    }
  } catch (err) {
    // Map service errors to sync outcomes.
    if (err.name === 'ConflictError') {
      outcome = { status: 'conflict', reason: err.message };
    } else if (err.name === 'ValidationError' || err.name === 'NotFoundError') {
      outcome = { status: 'rejected', reason: err.message };
    } else {
      // Unexpected error — log it, don't cache the failure (so retry works).
      console.error(`[sync] unexpected error for op ${client_op_id}:`, err);
      return {
        client_op_id,
        status: 'error',
        reason: 'internal error, safe to retry',
      };
    }
  }

  // ---- Record the operation outcome in sync_operations ----
  // Cached for future retries. Note we record both successes and
  // policy-based failures (conflict, rejected) — but NOT unexpected
  // errors, so transient issues can be retried.
  await pool.query(
    `INSERT INTO sync_operations 
     (client_op_id, device_id, operation_type, client_timestamp, status, result_payload, conflict_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      client_op_id,
      device_id,
      type,
      client_timestamp,
      outcome.status,
      outcome.server_state ? JSON.stringify({ server_state: outcome.server_state }) : null,
      outcome.reason || null,
    ]
  );

  return { client_op_id, ...outcome };
}

// ---- Per-operation handlers ----

async function applyCreateOrder(payload) {
  // create_order has no real conflict surface — UUIDs prevent duplicate
  // creation if the same client_op_id is replayed (caught above), and
  // a brand-new order can't collide with anything.
  const order = await orderService.createOrder(payload);
  return { status: 'applied', server_state: order };
}

async function applyTransitionOrder(payload) {
  const { order_id, new_status, expected_version } = payload;

  // If the client provides expected_version, check it BEFORE the transition
  // so we can return a structured conflict (with current server state) rather
  // than just letting the underlying optimistic lock throw.
  if (expected_version !== undefined) {
    const current = await pool.query(
      'SELECT version, status FROM orders WHERE order_id = $1',
      [order_id]
    );
    if (current.rowCount === 0) {
      const err = new Error(`order ${order_id} not found`);
      err.name = 'NotFoundError';
      throw err;
    }
    if (current.rows[0].version !== expected_version) {
      // The server has moved on since the client last saw this order.
      // Return server state so the client can decide what to do (e.g.,
      // surface to the waiter: "this order was already confirmed by
      // another device while you were offline").
      const fullOrder = await orderService.getOrderById(order_id);
      return {
        status: 'conflict',
        reason: `version mismatch: client expected ${expected_version}, server is ${current.rows[0].version}`,
        server_state: fullOrder,
      };
    }
  }

  const order = await orderService.transitionOrder(order_id, new_status);
  return { status: 'applied', server_state: order };
}

async function applyCancelOrder(payload) {
  const { order_id } = payload;
  
  // Cancel is idempotent — if order is already CANCELLED, that's success.
  const current = await pool.query(
    'SELECT status FROM orders WHERE order_id = $1',
    [order_id]
  );
  if (current.rowCount === 0) {
    const err = new Error(`order ${order_id} not found`);
    err.name = 'NotFoundError';
    throw err;
  }
  if (current.rows[0].status === 'CANCELLED') {
    const fullOrder = await orderService.getOrderById(order_id);
    return { status: 'applied', server_state: fullOrder, idempotent: true };
  }

  const order = await orderService.transitionOrder(order_id, 'CANCELLED');
  return { status: 'applied', server_state: order };
}

async function applyCreatePayment(payload, client_op_id) {
  // Reuse client_op_id as the payment idempotency key — they serve the
  // same purpose. This way: if the device already submitted this payment
  // before going offline (and it succeeded), syncing again is a no-op.
  const result = await paymentService.recordPayment(payload, client_op_id);
  return { 
    status: result.cached ? 'applied' : 'applied',
    server_state: result.body,
    idempotent: result.cached,
  };
}

module.exports = { processSyncBatch };