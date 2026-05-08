import { useEffect, useState, useRef } from 'react';

const BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * Live event stream panel — subscribes to GET /events/stream via EventSource
 * and displays events in real time. This is the visual proof that the
 * outbox -> worker -> SSE pipeline is working end to end.
 *
 * EventSource is used instead of WebSocket because:
 *   - Server -> client only; no upstream messages needed
 *   - Auto-reconnect built into the browser
 *   - Works over plain HTTP (no upgrade handshake)
 */
export default function LiveEventsPanel() {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    const es = new EventSource(`${BASE}/events/stream`);
    eventSourceRef.current = es;

    es.addEventListener('connected', () => setConnected(true));

    // Generic handler — every event type we care about
    const handleEvent = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        setEvents(prev => [
          { ...parsed, _received_at: new Date().toISOString() },
          ...prev.slice(0, 49), // keep last 50
        ]);
      } catch (err) {
        console.error('[LiveEventsPanel] failed to parse event', err);
      }
    };

    ['order.created', 'order.status_changed', 'inventory.deducted',
     'payment.recorded', 'bill.paid'].forEach(type => {
      es.addEventListener(type, handleEvent);
    });

    es.onerror = () => setConnected(false);

    return () => {
      es.close();
    };
  }, []);

  const eventColors = {
    'order.created': '#3b82f6',
    'order.status_changed': '#8b5cf6',
    'inventory.deducted': '#f59e0b',
    'payment.recorded': '#10b981',
    'bill.paid': '#059669',
  };

  const styles = {
    wrapper: {
      position: 'fixed',
      bottom: 12,
      right: 12,
      width: collapsed ? 'auto' : 380,
      maxHeight: collapsed ? 'auto' : 400,
      backgroundColor: '#1f2937',
      color: 'white',
      borderRadius: 8,
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: 12,
      zIndex: 9998,
      overflow: 'hidden',
    },
    header: {
      padding: '10px 14px',
      backgroundColor: '#111827',
      cursor: 'pointer',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      backgroundColor: connected ? '#10b981' : '#ef4444',
      display: 'inline-block',
      marginRight: 6,
    },
    list: {
      maxHeight: 340,
      overflowY: 'auto',
      padding: 8,
    },
    event: {
      padding: 8,
      marginBottom: 6,
      borderRadius: 4,
      backgroundColor: '#374151',
      borderLeft: '3px solid',
    },
    eventType: {
      fontWeight: 600,
      fontSize: 11,
    },
    aggregateId: {
      fontSize: 10,
      color: '#9ca3af',
      fontFamily: 'monospace',
      marginTop: 2,
    },
    timestamp: {
      fontSize: 10,
      color: '#6b7280',
      marginTop: 2,
    },
    empty: {
      padding: 20,
      textAlign: 'center',
      color: '#6b7280',
    },
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.header} onClick={() => setCollapsed(!collapsed)}>
        <div>
          <span style={styles.statusDot} />
          <strong>Live events</strong>
          {events.length > 0 && <span style={{ marginLeft: 8, color: '#9ca3af' }}>({events.length})</span>}
        </div>
        <span style={{ color: '#9ca3af' }}>{collapsed ? '▲' : '▼'}</span>
      </div>
      {!collapsed && (
        <div style={styles.list}>
          {events.length === 0 ? (
            <div style={styles.empty}>Waiting for events…<br />Try creating an order.</div>
          ) : (
            events.map((evt) => (
              <div
                key={evt.event_id}
                style={{ ...styles.event, borderLeftColor: eventColors[evt.event_type] || '#6b7280' }}
              >
                <div style={styles.eventType}>{evt.event_type}</div>
                <div style={styles.aggregateId}>{evt.aggregate_id?.slice(0, 8)}…</div>
                <div style={styles.timestamp}>
                  {new Date(evt._received_at).toLocaleTimeString()}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}