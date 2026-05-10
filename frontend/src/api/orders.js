import { enqueue } from '../lib/offlineQueue';

const BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * Helper: detects "we couldn't reach the network" vs "server returned an error".
 * Network errors throw a TypeError ("Failed to fetch"); HTTP errors come back
 * as fetch responses with !res.ok. We only fall back to the queue on network
 * errors — if the server returned 400/500, the request was bad and queueing
 * it for retry won't fix anything.
 */
function isNetworkError(err) {
  return err instanceof TypeError && /fetch/i.test(err.message);
}

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

/**
 * Create an order with offline fallback.
 *
 * Online: hits POST /orders directly, returns the server's response.
 * Offline (or network error): queues the operation, returns an optimistic
 * local response so the UI can update immediately. The order will sync to
 * the server when connectivity returns (handled by useOfflineSync hook).
 */
export async function createOrder(payload) {
  // If we know we're offline, skip the network attempt entirely
  if (!navigator.onLine) {
    return enqueueCreateOrder(payload);
  }

  try {
    const res = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create order');
    return data;
  } catch (err) {
    // Network failure — fall back to queue
    if (isNetworkError(err)) {
      return enqueueCreateOrder(payload);
    }
    throw err;
  }
}

/**
 * Build an optimistic local response that mirrors what the server would return.
 * The order_id is the same client_op_id used for sync — when the server
 * eventually applies the operation, this id is preserved so the UI's view
 * of the order stays consistent across the offline → online transition.
 */
function enqueueCreateOrder(payload) {
  const operation = enqueue('create_order', payload);

  // Optimistic response shaped like the real createOrder response
  return {
    order_id: operation.client_op_id,
    outlet_id: payload.outlet_id,
    order_type: payload.order_type,
    table_number: payload.table_number || null,
    status: 'CREATED',
    version: 1,
    created_at: operation.client_timestamp,
    updated_at: operation.client_timestamp,
    items: payload.items.map((item, i) => ({
      order_item_id: `local-${i}`,
      menu_item_id: item.menu_item_id,
      quantity: item.quantity,
      unit_price: '0.00', // unknown until server applies; server snapshots real price
      notes: item.notes || null,
    })),
    _offline: true, // flag the UI can use to show "queued" state
  };
}

/**
 * Transition an order's status with offline fallback.
 *
 * For status transitions we include expected_version in the offline op so
 * the server can do a proper version-based conflict check at sync time.
 * If the order's version has moved on the server while we were offline,
 * the sync result will be 'conflict' and the UI can surface that to the user.
 */
export async function transitionOrder(orderId, newStatus, expectedVersion = null) {
  if (!navigator.onLine) {
    return enqueueTransition(orderId, newStatus, expectedVersion);
  }

  try {
    const res = await fetch(`${BASE}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_status: newStatus }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update order status');
    return data;
  } catch (err) {
    if (isNetworkError(err)) {
      return enqueueTransition(orderId, newStatus, expectedVersion);
    }
    throw err;
  }
}

function enqueueTransition(orderId, newStatus, expectedVersion) {
  const operation = enqueue('transition_order', {
    order_id: orderId,
    new_status: newStatus,
    expected_version: expectedVersion,
  });

  return {
    order_id: orderId,
    status: newStatus,
    _offline: true,
    _client_op_id: operation.client_op_id,
  };
}