const STATUS_COLORS = {
  CREATED: '#6c757d',
  CONFIRMED: '#0d6efd',
  PREPARING: '#fd7e14',
  READY: '#198754',
  SERVED: '#20c997',
  PAID: '#0dcaf0',
  CANCELLED: '#dc3545',
};

export default function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || '#6c757d';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: '12px',
        background: color,
        color: '#fff',
        fontSize: '0.8rem',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      {status}
    </span>
  );
}
