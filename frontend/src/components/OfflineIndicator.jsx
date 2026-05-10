import { useOfflineSync } from '../hooks/useOfflineSync';

/**
 * Persistent banner showing online/offline state and queue count.
 * Click "Sync now" to manually trigger drain (useful after fixing a transient issue).
 */
export default function OfflineIndicator() {
  const { isOnline, queueCount, isSyncing, lastSyncResult, syncNow } = useOfflineSync();

  // Hide when fully online with empty queue and no recent sync result
  if (isOnline && queueCount === 0 && !lastSyncResult) {
    return null;
  }

  const styles = {
    wrapper: {
      position: 'fixed',
      top: 12,
      right: 12,
      zIndex: 9999,
      padding: '8px 14px',
      borderRadius: 8,
      fontSize: 13,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
      backgroundColor: isOnline ? '#10b981' : '#ef4444',
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      backgroundColor: 'white',
      animation: isSyncing ? 'pulse 1s ease-in-out infinite' : 'none',
    },
    button: {
      background: 'rgba(255,255,255,0.2)',
      border: 'none',
      color: 'white',
      padding: '4px 8px',
      borderRadius: 4,
      cursor: 'pointer',
      fontSize: 12,
    },
  };

  return (
    <>
      <style>{`@keyframes pulse { 0%,100% {opacity:1} 50% {opacity:0.4} }`}</style>
      <div style={styles.wrapper}>
        <span style={styles.dot} />
        {!isOnline && <span>Offline — {queueCount} queued</span>}
        {isOnline && queueCount > 0 && <span>Syncing {queueCount} pending…</span>}
        {isOnline && queueCount === 0 && lastSyncResult && (
          <span>
            Synced: {lastSyncResult.applied} applied
            {lastSyncResult.conflicts > 0 && `, ${lastSyncResult.conflicts} conflicts`}
          </span>
        )}
        {isOnline && queueCount > 0 && !isSyncing && (
          <button style={styles.button} onClick={syncNow}>Sync now</button>
        )}
      </div>
    </>
  );
}