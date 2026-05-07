-- ============================================================
-- v2 schema additions for distributed POS
-- Run this against your existing Supabase database.
-- ============================================================

-- ------------------------------------------------------------
-- 1. OUTBOX EVENTS
-- ------------------------------------------------------------
-- Solves the dual-write problem: events are written in the SAME
-- transaction as the state change. A separate worker polls this
-- table and dispatches events. Guarantees at-least-once delivery.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox_events (
  event_id      UUID PRIMARY KEY,
  event_type    TEXT NOT NULL,           -- e.g. 'order.created', 'payment.completed'
  aggregate_id  TEXT NOT NULL,           -- the entity this event is about (order_id, bill_id, etc.)
  payload       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,             -- NULL = not yet dispatched
  attempts      INT NOT NULL DEFAULT 0,
  last_error    TEXT
);

-- The worker query is: WHERE processed_at IS NULL ORDER BY created_at LIMIT N FOR UPDATE SKIP LOCKED
-- This partial index makes that query fast even when the table grows large.
CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed
  ON outbox_events (created_at)
  WHERE processed_at IS NULL;


-- ------------------------------------------------------------
-- 2. SPLIT PAYMENTS
-- ------------------------------------------------------------
-- The existing `payments` table likely has 1:1 with bills. We want
-- N:1 — multiple payment rows per bill (cash + card, etc.).
-- A bill becomes PAID when SUM(payments.amount) >= bills.total.
-- ------------------------------------------------------------

-- If your existing payments table doesn't already allow multiple rows per bill,
-- this is a no-op (just adds the index). If it has a UNIQUE on bill_id, drop it:
-- ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_bill_id_key;

-- Index for the SUM(amount) query when checking if a bill is fully paid
CREATE INDEX IF NOT EXISTS idx_payments_bill_id
  ON payments (bill_id);


-- ------------------------------------------------------------
-- 3. OFFLINE SYNC LOG
-- ------------------------------------------------------------
-- Tracks operations submitted via /sync from offline clients.
-- The `client_op_id` is generated on the device and is the
-- idempotency key for that operation — same key = same outcome,
-- so retrying a sync batch is always safe.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_operations (
  client_op_id      UUID PRIMARY KEY,             -- generated on the device
  device_id         TEXT NOT NULL,                -- which tablet submitted this
  operation_type    TEXT NOT NULL,                -- 'create_order', 'transition_order', etc.
  client_timestamp  TIMESTAMPTZ NOT NULL,         -- when device performed the op
  server_timestamp  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status            TEXT NOT NULL,                -- 'applied' | 'conflict' | 'rejected'
  result_payload    JSONB,                        -- the response we sent back
  conflict_reason   TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_ops_device
  ON sync_operations (device_id, server_timestamp DESC);


-- ------------------------------------------------------------
-- 4. PERFORMANCE INDEXES (for scaling story)
-- ------------------------------------------------------------
-- These match the queries we actually run. Each one earns its place
-- in the architecture doc's bottleneck analysis.
-- ------------------------------------------------------------

-- "List orders for an outlet, newest first" — the dashboard query
CREATE INDEX IF NOT EXISTS idx_orders_outlet_created
  ON orders (outlet_id, created_at DESC);

-- Order status filtering (e.g. "show me all PREPARING orders")
CREATE INDEX IF NOT EXISTS idx_orders_outlet_status
  ON orders (outlet_id, status)
  WHERE status NOT IN ('PAID', 'CANCELLED');  -- partial index, only "live" orders

-- Order items lookup (already PK-joined but explicit index helps)
CREATE INDEX IF NOT EXISTS idx_order_items_order
  ON order_items (order_id);