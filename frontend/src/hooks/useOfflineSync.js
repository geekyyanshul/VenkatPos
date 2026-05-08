import { useEffect, useState, useCallback, useRef } from 'react';
import { getPending, removeFromQueue, getDeviceId, getQueueCount } from '../lib/offlineQueue';

const BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * React hook that handles offline detection, queue management, and auto-sync.
 *
 * Behavior:
 *   - Tracks navigator.onLine and listens to online/offline events
 *   - Subscribes to queue changes (via the custom event from offlineQueue.js)
 *   - When connection comes back online with queued ops, drains the queue
 *     by calling POST /sync with all pending operations
 *   - Per-op results: 'applied' ops are removed from queue; 'conflict' and
 *     'rejected' ops are also removed (they're terminal — server has spoken)
 *   - 'error' results stay in queue for retry on next sync trigger
 */
export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueCount, setQueueCount] = useState(getQueueCount());
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState(null);
  const syncInFlight = useRef(false);

  /**
   * Drain the queue by submitting all pending ops to /sync.
   * Guarded by a ref so concurrent triggers (online event + manual call)
   * don't double-submit the same operations.
   */
  const syncNow = useCallback(async () => {
    if (syncInFlight.current) return;
    if (!navigator.onLine) return;

    const pending = getPending();
    if (pending.length === 0) return;

    syncInFlight.current = true;
    setIsSyncing(true);

    try {
      const res = await fetch(`${BASE}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: getDeviceId(),
          operations: pending,
        }),
      });

      if (!res.ok) {
        // Server-level failure (5xx, network error after partial response).
        // Keep the queue intact — we'll retry on next trigger.
        console.error('[sync] server returned', res.status);
        return;
      }

      const data = await res.json();
      const results = data.results || [];

      // Remove ops that the server reached a terminal decision on.
      // 'applied' = success. 'conflict' and 'rejected' = server has decided,
      // no point retrying. 'error' = transient, keep for retry.
      const terminalIds = results
        .filter(r => r.status === 'applied' || r.status === 'conflict' || r.status === 'rejected')
        .map(r => r.client_op_id);

      if (terminalIds.length > 0) {
        removeFromQueue(terminalIds);
      }

      setLastSyncResult({
        timestamp: new Date().toISOString(),
        applied: results.filter(r => r.status === 'applied').length,
        conflicts: results.filter(r => r.status === 'conflict').length,
        rejected: results.filter(r => r.status === 'rejected').length,
        errors: results.filter(r => r.status === 'error').length,
      });

      // Surface conflicts to the console for the demo
      const conflicts = results.filter(r => r.status === 'conflict');
      if (conflicts.length > 0) {
        console.warn('[sync] conflicts detected:', conflicts);
      }
    } catch (err) {
      console.error('[sync] failed:', err);
    } finally {
      syncInFlight.current = false;
      setIsSyncing(false);
      setQueueCount(getQueueCount());
    }
  }, []);

  // Track online/offline state
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Auto-drain the queue when we come back online
      syncNow();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncNow]);

  // Track queue changes (when other code calls enqueue/removeFromQueue)
  useEffect(() => {
    const handleQueueChange = (e) => {
      setQueueCount(e.detail?.count ?? getQueueCount());
    };
    window.addEventListener('offline-queue-changed', handleQueueChange);
    return () => window.removeEventListener('offline-queue-changed', handleQueueChange);
  }, []);

  // On mount, if we're already online and have pending ops, sync immediately.
  // This handles the case where the app reloads with queued ops from a previous session.
  useEffect(() => {
    if (navigator.onLine && getQueueCount() > 0) {
      syncNow();
    }
  }, [syncNow]);

  return {
    isOnline,
    queueCount,
    isSyncing,
    lastSyncResult,
    syncNow,
  };
}