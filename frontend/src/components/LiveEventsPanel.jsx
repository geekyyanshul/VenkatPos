import { useEffect, useState, useRef } from 'react';

const BASE = import.meta.env.VITE_API_URL || '/api';

const eventColors = {
  'order.created': '#3b82f6',
  'order.status_changed': '#8b5cf6',
  'inventory.deducted': '#f59e0b',
  'payment.recorded': '#10b981',
  'bill.paid': '#059669',
};

export default function LiveEventsPanel() {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState(() => {
    const saved = localStorage.getItem('pos.live-events.position');
    return saved ? JSON.parse(saved) : {
      right: 12,
      bottom: 12,
      width: 380,
      height: 400,
    };
  });
  const dragState = useRef(null);

  useEffect(() => {
    const es = new EventSource(`${BASE}/events/stream`);
    es.addEventListener('connected', () => setConnected(true));

    const handleEvent = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        setEvents(prev => [
          { ...parsed, _received_at: new Date().toISOString() },
          ...prev.slice(0, 49),
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
    return () => es.close();
  }, []);

  // Persist position so it survives page reloads during the demo
  useEffect(() => {
    localStorage.setItem('pos.live-events.position', JSON.stringify(position));
  }, [position]);

  // ----- Drag handling -----
  const handleHeaderMouseDown = (e) => {
    // Convert right/bottom anchoring to left/top for drag math
    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    dragState.current = {
      mode: 'drag',
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    e.preventDefault();
  };

  // ----- Resize handling -----
  const handleResizeMouseDown = (e) => {
    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    dragState.current = {
      mode: 'resize',
      startX: e.clientX,
      startY: e.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      startLeft: rect.left,
      startTop: rect.top,
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    e.preventDefault();
    e.stopPropagation();
  };

  const handleMouseMove = (e) => {
    const s = dragState.current;
    if (!s) return;

    if (s.mode === 'drag') {
      const newLeft = s.startLeft + (e.clientX - s.startX);
      const newTop = s.startTop + (e.clientY - s.startY);
      setPosition(p => ({
        ...p,
        right: window.innerWidth - newLeft - s.width,
        bottom: window.innerHeight - newTop - s.height,
      }));
    } else if (s.mode === 'resize') {
      const newWidth = Math.max(280, s.startWidth + (e.clientX - s.startX));
      const newHeight = Math.max(200, s.startHeight + (e.clientY - s.startY));
      setPosition(p => ({
        ...p,
        width: newWidth,
        height: newHeight,
      }));
    }
  };

  const handleMouseUp = () => {
    dragState.current = null;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  const styles = {
    wrapper: {
      position: 'fixed',
      right: position.right,
      bottom: position.bottom,
      width: collapsed ? 'auto' : position.width,
      height: collapsed ? 'auto' : position.height,
      backgroundColor: '#1f2937',
      color: 'white',
      borderRadius: 8,
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: 12,
      zIndex: 9998,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    },
    header: {
      padding: '10px 14px',
      backgroundColor: '#111827',
      cursor: 'move',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
      userSelect: 'none',
      flexShrink: 0,
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
      overflowY: 'auto',
      padding: 8,
      flex: 1,
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
    resizeHandle: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: 16,
      height: 16,
      cursor: 'nwse-resize',
      background: 'linear-gradient(135deg, transparent 50%, #6b7280 50%)',
      borderRadius: '0 0 8px 0',
    },
    collapseBtn: {
      background: 'none',
      border: 'none',
      color: '#9ca3af',
      cursor: 'pointer',
      fontSize: 14,
      padding: '0 4px',
    },
  };

  return (
    <div style={styles.wrapper}>
      <div
        style={styles.header}
        onMouseDown={handleHeaderMouseDown}
      >
        <div>
          <span style={styles.statusDot} />
          <strong>Live events</strong>
          {events.length > 0 && (
            <span style={{ marginLeft: 8, color: '#9ca3af' }}>({events.length})</span>
          )}
        </div>
        <button
          style={styles.collapseBtn}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? '▲' : '▼'}
        </button>
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
      {!collapsed && (
        <div style={styles.resizeHandle} onMouseDown={handleResizeMouseDown} />
      )}
    </div>
  );
}