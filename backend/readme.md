# POS System

A fault-tolerant, multi-tenant Point-of-Sale backend built with Node.js and PostgreSQL. Handles order lifecycle, billing with discounts and taxes, payments with idempotency, and inventory deduction — all with strong consistency guarantees on financial and inventory operations.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design document including consistency model, concurrency strategy, failure scenarios, offline-sync design, and scaling strategy.

## Features

- Order CRUD with line items and modifiers (notes per item)
- Dine-in and takeaway order types
- Strict order state machine: `CREATED → CONFIRMED → PREPARING → READY → SERVED → PAID`, with `CANCELLED` reachable from `CREATED` or `CONFIRMED`
- Multi-outlet (multi-tenant) with per-outlet menu and tax rate
- Inventory tracking with deduction on order confirmation
- Bill generation with flat or percentage discounts and per-outlet tax
- Payments with multiple methods (CASH, UPI, CARD)
- Idempotency keys on payments for safe retries
- In-process event bus (`order.confirmed`, `order.status_changed`, `payment.recorded`)
- Both pessimistic (`SELECT ... FOR UPDATE`) and optimistic (`version` column) locking
- Database-level guards: `UNIQUE(order_id)` on bills, `CHECK (stock >= 0)` on inventory, `CHECK` on order status

## Stack

- **Node.js** + **Express** (web framework)
- **PostgreSQL** (database)
- **node-postgres (`pg`)** (database driver, with connection pooling)
- **uuid** (client-generatable order IDs)

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL 14+

### Install and run

```bash
# Install backend dependencies
npm install

# Create the database
createdb pos_system

# Apply schema and seed data
psql -f schema.sql pos_system
psql -f seed.sql pos_system

# Start the backend server
node src/server.js
```

Backend runs on `http://localhost:3000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend dev server runs on `http://localhost:5173` and proxies `/api/*` → `http://localhost:3000`.
Open `http://localhost:5173` in a browser, select an outlet, and manage orders end-to-end.

## API

### Health check
GET /health

### Outlets
**List outlets**
GET /outlets

**Get menu items for outlet**
GET /outlets/:outlet_id/menu

### Orders
**List orders for an outlet**
GET /orders?outlet_id=1

**Create order**
POST /orders
Body: {
"outlet_id": 1,
"order_type": "DINE_IN" | "TAKEAWAY",
"table_number": 5,                   // required for DINE_IN
"items": [
{ "menu_item_id": 1, "quantity": 2, "notes": "extra spicy" }
]
}

**Get order**
GET /orders/:order_id

**Transition order state**
PATCH /orders/:order_id/status
Body: { "new_status": "CONFIRMED" }

Allowed transitions: see ARCHITECTURE.md §5. Inventory is deducted atomically on `CREATED → CONFIRMED`.

### Bills

**Generate bill**
POST /bills
Body: {
"order_id": "...",
"discount": { "type": "PERCENTAGE" | "FLAT", "value": 10 }    // optional
}

A bill can only be generated for orders in `READY` or `SERVED` state. Attempting to generate a duplicate bill returns 409.

**Get bill for an order**
GET /bills/by-order/:order_id

### Payments

**Record payment**
POST /payments
Headers:
Idempotency-Key: <unique-string>      // required
Body: {
"bill_id": "...",
"amount": 504,
"method": "CASH" | "UPI" | "CARD"
}

Sending the same `Idempotency-Key` twice returns the original response without recording a second payment.

## Sample end-to-end flow

```bash
# 1. Create order at outlet 1
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"outlet_id":1,"order_type":"DINE_IN","table_number":5,"items":[{"menu_item_id":1,"quantity":2}]}'
# -> returns { "order_id": "...", "status": "CREATED", ... }

# 2. Walk through the state machine
curl -X PATCH http://localhost:3000/orders/<ORDER_ID>/status \
  -H "Content-Type: application/json" -d '{"new_status":"CONFIRMED"}'
# (then PREPARING, READY, SERVED in turn)

# 3. Generate bill with 10% discount
curl -X POST http://localhost:3000/bills \
  -H "Content-Type: application/json" \
  -d '{"order_id":"<ORDER_ID>","discount":{"type":"PERCENTAGE","value":10}}'
# -> returns { "bill_id": "...", "total": 472.5, ... }

# 4. Pay the bill
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: pay-001" \
  -d '{"bill_id":"<BILL_ID>","amount":472.5,"method":"UPI"}'

# 5. Retrying step 4 with the same Idempotency-Key returns the original response.
#    Only one row exists in the payments table.
```

## What is built vs. designed

This implementation focuses on a solid online-only core with strong consistency on financial and inventory operations. Some assignment items are designed in detail in `ARCHITECTURE.md` rather than implemented in code, due to time constraints:

**Implemented:** order lifecycle and state machine, multi-tenancy via outlet_id, inventory with pessimistic locking, billing with discounts and tax, payments with idempotency keys, in-process event bus, optimistic locking on order updates, defense-in-depth at both application and database layers.

**Designed but not implemented:** offline-capable clients with sync (§9 of ARCHITECTURE.md), split payments across multiple methods, idempotency on order creation (same pattern as payments), authentication/authorization, scaling to 10k+ orders/hour (§10), microservices split (§12).

## Project structure
pos-system/
├── schema.sql                      # database schema
├── seed.sql                        # sample outlets, menu, inventory
├── package.json
├── README.md                       # this file
├── ARCHITECTURE.md                 # full architecture design
└── src/
├── server.js                   # Express entry point
├── db.js                       # PostgreSQL connection pool
├── events.js                   # in-process event bus
├── routes/
│   ├── orders.js
│   ├── bills.js
│   └── payments.js
└── services/
├── orderService.js         # order lifecycle, state machine, inventory deduction
├── billService.js          # bill generation with tax + discount
└── paymentService.js       # payment recording with idempotency


