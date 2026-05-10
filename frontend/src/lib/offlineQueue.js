/**
 * Offline operation queue backed by localStorage.
 *
 * Why localStorage instead of IndexedDB:
 *   - Synchronous API — simpler to reason about, no async overhead
 *   - Survives page refresh (critical: tablet sleep + wake = data preserved)
 *   - 5MB limit is plenty for a POS use case (a few hundred queued ops max)
 *   - Production version would use IndexedDB for unlimited size + structured queries.
 *     This is the well-defined POC of the same architecture.
 *
 * Why client_op_id is generated AT ENQUEUE, not at sync time:
 *   - The id is the idempotency key on the server (sync_operations PRIMARY KEY)
 *   - Retrying a sync request with the same id = guaranteed safe, no duplicates
 *   - The optimistic UI can show eventual state immediately because id is known
 *   - Clock skew doesn't matter (id is content-addressed, not time-addressed)
 */

const STORAGE_KEY = 'pos.offline.queue.v1';
const DEVICE_ID_KEY = 'pos.device.id.v1';

/**
 * Stable per-browser device id. Generated once, persisted forever.
 * Lets the server attribute operations to a specific tablet for audit/debug.
 */
export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `device-${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function readQueue() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('[offlineQueue] failed to parse queue, resetting', err);
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

function writeQueue(queue) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  // Notify subscribers (the React hook) that the queue changed
  window.dispatchEvent(new CustomEvent('offline-queue-changed', {
    detail: { count: queue.length },
  }));
}

/**
 * Add an operation to the queue.
 * Returns the full operation object (including the generated client_op_id).
 */
export function enqueue(type, payload) {
  const operation = {
    client_op_id: crypto.randomUUID(),
    type,
    client_timestamp: new Date().toISOString(),
    payload,
  };

  const queue = readQueue();
  queue.push(operation);
  writeQueue(queue);

  return operation;
}

export function getPending() {
  return readQueue();
}

export function getQueueCount() {
  return readQueue().length;
}

/**
 * Remove operations that successfully synced. Operations still pending
 * (e.g., due to network errors) stay in the queue for retry.
 */
export function removeFromQueue(clientOpIds) {
  const idsToRemove = new Set(clientOpIds);
  const queue = readQueue();
  const remaining = queue.filter(op => !idsToRemove.has(op.client_op_id));
  writeQueue(remaining);
}

export function clearQueue() {
  writeQueue([]);
}