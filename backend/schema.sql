-- ============================================================
-- POS System Schema
-- One file. All tables. Run with: psql -f schema.sql pos_system
-- ============================================================

-- Drop existing tables (so we can re-run this file cleanly)
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS bills CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS menu_items CASCADE;
DROP TABLE IF EXISTS outlets CASCADE;
DROP TABLE IF EXISTS idempotency_keys CASCADE;

-- ============================================================
-- OUTLETS: each row is a restaurant (multi-tenant)
-- ============================================================
CREATE TABLE outlets (
  outlet_id     SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  tax_rate      NUMERIC(5,4) NOT NULL DEFAULT 0.05,  -- 5% default
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- MENU_ITEMS: dishes available at an outlet
-- ============================================================
CREATE TABLE menu_items (
  menu_item_id  SERIAL PRIMARY KEY,
  outlet_id     INTEGER NOT NULL REFERENCES outlets(outlet_id),
  name          TEXT NOT NULL,
  price         NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_menu_items_outlet ON menu_items(outlet_id);

-- ============================================================
-- INVENTORY: stock per menu item
-- ============================================================
CREATE TABLE inventory (
  menu_item_id  INTEGER PRIMARY KEY REFERENCES menu_items(menu_item_id),
  stock         INTEGER NOT NULL CHECK (stock >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ORDERS: one row per customer order
-- ============================================================
CREATE TABLE orders (
  order_id      UUID PRIMARY KEY,
  outlet_id     INTEGER NOT NULL REFERENCES outlets(outlet_id),
  order_type    TEXT NOT NULL CHECK (order_type IN ('DINE_IN', 'TAKEAWAY')),
  table_number  INTEGER,  -- NULL for takeaway
  status        TEXT NOT NULL DEFAULT 'CREATED'
                CHECK (status IN ('CREATED','CONFIRMED','PREPARING','READY','SERVED','PAID','CANCELLED')),
  version       INTEGER NOT NULL DEFAULT 1,  -- for optimistic locking
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_outlet_status ON orders(outlet_id, status);

-- ============================================================
-- ORDER_ITEMS: items within an order
-- ============================================================
CREATE TABLE order_items (
  order_item_id SERIAL PRIMARY KEY,
  order_id      UUID NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  menu_item_id  INTEGER NOT NULL REFERENCES menu_items(menu_item_id),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  unit_price    NUMERIC(10,2) NOT NULL,  -- snapshot of price at order time
  notes         TEXT  -- modifiers like "no onions"
);

CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ============================================================
-- BILLS: one bill per order, generated when order is SERVED
-- ============================================================
CREATE TABLE bills (
  bill_id        UUID PRIMARY KEY,
  order_id       UUID NOT NULL UNIQUE REFERENCES orders(order_id),
  -- ☝️ UNIQUE here is critical: prevents two bills for the same order
  subtotal       NUMERIC(10,2) NOT NULL,
  discount_type  TEXT CHECK (discount_type IN ('FLAT', 'PERCENTAGE')),
  discount_value NUMERIC(10,2),
  tax_amount     NUMERIC(10,2) NOT NULL,
  total          NUMERIC(10,2) NOT NULL,
  status         TEXT NOT NULL DEFAULT 'UNPAID'
                 CHECK (status IN ('UNPAID', 'PAID')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PAYMENTS: one or more payments per bill (split payments later)
-- ============================================================
CREATE TABLE payments (
  payment_id    UUID PRIMARY KEY,
  bill_id       UUID NOT NULL REFERENCES bills(bill_id),
  amount        NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  method        TEXT NOT NULL CHECK (method IN ('CASH', 'UPI', 'CARD')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_bill ON payments(bill_id);

-- ============================================================
-- IDEMPOTENCY_KEYS: cache of processed requests for safe retries
-- ============================================================
CREATE TABLE idempotency_keys (
  key             TEXT PRIMARY KEY,
  response_status INTEGER NOT NULL,
  response_body   JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);