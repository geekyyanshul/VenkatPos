# Restaurant POS System — Architecture

**Author:** Venkatraman R Iyer
**Repository:** github.com/venkatiyer01/pos-app
**Live demo:** pos-frontend-three-iota.vercel.app
**Stack:** React 19 · Express 5 · PostgreSQL · Render · Supabase · Vercel

---

## 0. Reading guide

This document is organised so an evaluator can read sections out of order:

- **Section 1–Section 2** — what the system is and how it's structured.
- **Section 3** — concurrency and consistency guarantees, the heart of the design.
- **Section 4** — event-driven architecture (outbox pattern + worker + SSE).
- **Section 5** — offline capability and conflict resolution.
- **Section 6** — scaling strategy and explicit bottleneck analysis.
- **Section 7** — failure scenarios with detection and recovery for each.
- **Section 8** — trade-offs taken and the alternatives rejected.
- **Section 9** — evolution path to microservices.

---

## 1. Goals and non-goals

**Goals.** Build a multi-tenant restaurant POS that:

- Maintains correctness under concurrent modification by multiple devices
- Survives intermittent network connectivity at the device level
- Guarantees financial correctness — no double charges, no duplicate orders, no oversold inventory
- Provides an audit trail durable enough to reconstruct any past state
- Scales to 10,000+ orders/hour with a documented growth path

**Non-goals.** Things deliberately out of scope for this submission:

- Authentication and per-user authorisation (route-middleware shaped to add JWT later, but not implemented here)
- Geographic replication / multi-region failover
- A real message broker — Kafka/RabbitMQ are the production target; this implementation simulates the consumer side with an in-process event bus
- A polished waiter UI for offline mode — the offline architecture is implemented and tested end-to-end at the API level; the frontend integration is left as a documented design

These are flagged explicitly because evaluating *what's not built* is as important as evaluating what is.

---

## 2. High-level architecture

```
                        ┌─────────────────────────────────┐
                        │  CLIENT TIER — React 19 SPA     │
                        │  (Vercel CDN)                    │
                        │                                  │
                        │  Pages · Components · API layer  │
                        │  IndexedDB queue (offline mode)  │
                        └────────────────┬─────────────────┘
                                         │ HTTPS · REST · JSON · CORS
                                         │ SSE for live events
                                         ▼
        ┌────────────────────────────────────────────────────────┐
        │  API TIER — Express 5 on Node.js 20+ (Render)           │
        │                                                          │
        │  Routes:    orders · bills · payments · sync · events    │
        │  Services:  state machine · billing · payments · sync    │
        │  Outbox:    recordEvent() — atomic with state changes    │
        │  Worker:    polls outbox, dispatches via in-process bus  │
        │  SSE:       /events/stream — live consumer feed          │
        └────────────────────────────────────────────────────────┘
                                         │ pg pool · SQL · SSL · Transactions
                                         ▼
        ┌────────────────────────────────────────────────────────┐
        │  DATA TIER — PostgreSQL on Supabase                      │
        │                                                          │
        │  Tenant:     outlets · menu_items · inventory            │
        │  Orders:     orders (UUID + version) · order_items       │
        │  Financial:  bills · payments (split-capable)            │
        │  Safety:     idempotency_keys · sync_operations          │
        │  Events:     outbox_events                               │
        └────────────────────────────────────────────────────────┘
```

### Why three tiers, why these boundaries

The boundary between client and API is over HTTPS. The boundary between API and DB is over a connection-pooled SSL channel. Each tier scales independently — the React build is static and served from a CDN edge, the API is stateless and horizontally scalable, the database is the single point of truth with vertical scaling first and a documented sharding path.

The two newer boundaries inside the API tier deserve naming:

- **Service layer ↔ outbox.** Services write to the outbox in the same transaction as their state changes. This is the boundary that solves the dual-write problem (Section 4).
- **Outbox ↔ worker.** The worker is the only consumer of `outbox_events`. Services don't talk to the worker directly. This decouples event production from event consumption — services don't know whether anyone is listening.

---

## 3. Concurrency and consistency model

The system uses **four distinct concurrency techniques**, each chosen to match a specific access pattern. The choice of technique is the single most important set of decisions in the design, so each one is justified individually.

### 3.1 Optimistic locking on order state

Every `orders` row carries an integer `version` column. State transitions execute as:

```sql
UPDATE orders 
SET status = $new_status, version = version + 1, updated_at = NOW()
WHERE order_id = $id AND version = $expected_version
```

If two devices both read version 3 and both try to write version 4, only one wins; the second's UPDATE matches zero rows and the service throws `ConflictError` (HTTP 409). The client refetches and decides what to do.

**Why optimistic here.** Order state transitions are **rare conflict events**. A waiter and a kitchen display rarely fight over the same order at the same instant. Paying for a round-trip on conflict is cheap; paying for serialised access on every transition would be wasteful.

**Trade-off rejected.** Pessimistic locking on orders would correctly serialise transitions but would queue every status change on the order's row lock. Under load this becomes a hotspot. Optimistic locking lets the database stay parallel.

### 3.2 Pessimistic locking on inventory

When an order moves `CREATED → CONFIRMED`, the service deducts stock. This requires:

```sql
SELECT stock FROM inventory WHERE menu_item_id = $1 FOR UPDATE
```

inside the transaction. The row-level lock serialises **only** concurrent confirmations on the **same menu item**. Other inventory rows remain free for parallel updates.

**Why pessimistic here.** Inventory conflicts are **common and costly**. During lunch rush, two waiters might confirm orders for the last available paneer tikka within milliseconds of each other. With optimistic locking, both reads see "stock = 1", both write "stock = 0", and the restaurant has oversold. The cost of a brief wait is much less than the cost of telling a customer their order can't be fulfilled.

**Trade-off rejected.** A simpler approach would be a single global lock. That serialises *all* inventory changes globally and kills throughput. Row-level locking gives correctness with parallelism.

### 3.3 Idempotency keys on payments

Every payment request carries an `Idempotency-Key` header (UUID, generated client-side). Inside the same transaction that records the payment, the server:

1. Looks up the key in `idempotency_keys`. If found, returns the cached response.
2. If not found, processes the payment, then writes the response under the key, then commits.

A retry of a failed request with the same key always returns the same outcome — never a duplicate charge.

**Why this matters.** Network timeouts on payment requests are the most dangerous failure mode in any commerce system. Without idempotency keys, the client doesn't know whether a timeout means "didn't reach the server" or "reached the server but response was lost". With idempotency keys, the answer is "retry safely until you get a response."

**Implementation note.** The cache lookup happens *inside* the transaction, not before it. This prevents a race where two simultaneous requests with the same key both miss the cache, both process the payment, and only one wins the cache insert.

### 3.4 Per-operation conflict resolution on offline sync

Operations submitted from offline clients use a fourth technique: **per-operation-type conflict policies**, not a blanket "last-write-wins" rule.

| Operation type | Policy | Reasoning |
|---|---|---|
| `create_order` | Always applied | UUIDs are collision-free; the same `client_op_id` replayed returns the cached result |
| `transition_order` | Version-based | Reuses the order optimistic lock; conflict returns server state |
| `cancel_order` | Idempotent | Cancelling an already-cancelled order succeeds silently |
| `create_payment` | Reuses payment idempotency | `client_op_id` becomes the payment idempotency key |

This is detailed in Section 5. The key insight is that **last-write-wins is the wrong model for financial systems** — it's fine for a Google Doc, fatal for "did we charge this card?". Different operations have different conflict semantics, and the system honours that difference.

---

## 4. Event-driven architecture

### 4.1 The dual-write problem

A naive implementation would do:

```javascript
await client.query('COMMIT');           // state change persisted
eventBus.emit('order.created', { ... }); // event fires
```

This has a window of failure: if the process crashes between COMMIT and emit, the state changed but the event never fired. Reversing the order — emit first, then commit — has the opposite problem: the event fires for a state change that gets rolled back.

This is the **dual-write problem** and it's why naive event-driven systems quietly lose events.

### 4.2 The outbox pattern

The fix is to make the event part of the same transaction as the state change. In this codebase, every state-changing service calls:

```javascript
await recordEvent(client, 'order.created', order_id, payload);
```

inside its existing transaction. This INSERTs into `outbox_events`. Either both the state change and the event commit, or neither does. There is no failure window.

A separate worker process polls `outbox_events`:

```sql
SELECT event_id, event_type, aggregate_id, payload
FROM outbox_events
WHERE processed_at IS NULL AND attempts < 5
ORDER BY created_at ASC
LIMIT 50
FOR UPDATE SKIP LOCKED
```

The `FOR UPDATE SKIP LOCKED` clause is what makes this scalable: multiple workers can run in parallel without coordination. Each one grabs a batch and locks those rows; others skip past locked rows and grab different ones. PostgreSQL handles all the concurrency.

For each event, the worker:

1. Logs it as structured JSON (in production: ships to a log aggregator)
2. Emits to an in-process `eventBus` for local subscribers (currently: the SSE endpoint)
3. Marks the row processed

If dispatch fails, `attempts` increments and `last_error` records the message. The next poll picks the row up again. After 5 failures the row is excluded from the worker's query — that's poison-message handling. In production these go to a dead-letter table for human investigation.

### 4.3 Live consumer — SSE endpoint

`GET /events/stream` is a Server-Sent Events endpoint. Connected clients (browser, curl, future kitchen display) receive every event as it's dispatched. The endpoint subscribes to the in-process `eventBus`, forwards events with type-aware filtering (`?type=order.created,inventory.deducted`), and cleans up the subscription on disconnect.

SSE was chosen over WebSockets because the data flow is one-way (server → client), SSE works over plain HTTP with automatic browser reconnection, and there's no handshake overhead. WebSockets would be appropriate if the client also needed to push.

### 4.4 Event types currently flowing

| Event | When | Consumers |
|---|---|---|
| `order.created` | New order accepted | Analytics, audit log, kitchen display preview |
| `order.status_changed` | Any state transition | Kitchen display, waiter dashboard, audit log |
| `inventory.deducted` | CREATED → CONFIRMED | Restocking alerts, analytics |
| `payment.recorded` | Each payment (split or full) | Receipt printer, daily reconciliation |
| `bill.paid` | Bill becomes fully paid | Table-clear notification, receipt printer |

### 4.5 Why this design rather than emit-direct-to-broker

In a future Kafka-based version, services would not call `kafkaProducer.send()` directly. They'd still write to the outbox; the worker would publish to Kafka. This preserves the transactional guarantee (Kafka publish is not transactional with Postgres) and means a Kafka outage doesn't take down order taking.

---

## 5. Offline capability

### 5.1 The scenario

A waiter's tablet loses connectivity mid-shift (router restart, ISP blip, anything). Over the next 20 minutes the waiter takes 4 orders, confirms 2, cancels 1, and processes a payment. Connectivity returns. All operations need to land on the server, in order, idempotently, with proper handling of the rare case where server state has changed independently.

### 5.2 The client-side model (designed, partially implemented)

The frontend maintains an **operation queue in IndexedDB**. Every action the waiter takes — order creation, transition, payment — is wrapped in an envelope:

```json
{
  "client_op_id": "uuid-generated-on-device",
  "type": "create_order",
  "client_timestamp": "2026-05-07T21:00:00Z",
  "payload": { ... }
}
```

While online, the queue drains immediately — each op is sent to the server and removed from the queue on success. While offline, the queue accumulates. On reconnect, the queue is submitted as a batch via `POST /sync`.

The `client_op_id` is generated **at the moment the action happens on the device**, not at the moment of sync. This is critical: if the sync request itself fails halfway, retrying with the same `client_op_id` is idempotent.

### 5.3 The server-side endpoint

`POST /sync` accepts:

```json
{
  "device_id": "tablet-7",
  "operations": [ { ... }, { ... }, { ... } ]
}
```

and returns per-operation results:

```json
{
  "results": [
    { "client_op_id": "...", "status": "applied", "server_state": { ... } },
    { "client_op_id": "...", "status": "conflict", "reason": "version mismatch", "server_state": { ... } },
    { "client_op_id": "...", "status": "rejected", "reason": "outlet not found" }
  ]
}
```

Each operation is processed in its own transaction. If op #2 conflicts, op #1 still committed and op #3 still gets a chance. This is "best-effort sequential" — losing all 4 ops because one had a conflict is worse for the restaurant than syncing the 3 that worked.

### 5.4 Conflict resolution policy

The four operation types have different policies, documented in Section 3.4. The most interesting case is `transition_order`:

1. Client sends a transition with `expected_version` (the version it last saw before going offline).
2. Server compares against current version.
3. If equal → apply via the normal optimistic lock path.
4. If different → return `status: conflict` with the **current server state**.
5. Client now has all the information needed to surface the conflict to the waiter: *"this order was modified by another device while you were offline — do you want to apply your change anyway?"*

This is fundamentally different from "last-write-wins" because the client can't apply blind overrides without explicit user choice. For a financial system this is the right model.

### 5.5 Clock skew

`client_timestamp` is recorded but **never used for ordering or conflict resolution**. Tablet clocks are unreliable. Server time (`server_timestamp` in `sync_operations`) is authoritative. The client timestamp is kept for forensic auditing — "this device thought this happened at 9:05 PM."

### 5.6 Idempotency at the sync level

The sync endpoint itself is idempotent. The `sync_operations` table has `client_op_id` as PRIMARY KEY. If a sync request is retried (network flake during the sync request itself), every operation in the batch is checked against the cache first. Already-processed ops return cached results without re-execution.

---

## 6. Scaling to 10,000+ orders/hour

### 6.1 What 10k orders/hour actually means

10,000 / 3600 = **2.78 orders/second average**. But average is misleading for restaurants. Real load is bursty:

- Lunch rush (12:00–13:30): 5–10x average
- Dinner rush (19:00–21:30): 5–10x average
- Off-peak: 0.1x average

So a system designed for 10k orders/hour must comfortably handle ~30 orders/second peak, with headroom for spikes.

Each "order" here is not one HTTP request — a typical order generates 5–10 requests (list menu, create order, multiple status transitions, generate bill, pay). So the API target is closer to **150–300 requests/second peak**.

### 6.2 Bottleneck analysis — where the current system breaks

The single Render instance + Supabase free-tier setup will hit the wall in this order:

1. **Connection pool exhaustion (first wall).** With 20 connections in the pool and the worker also holding connections, peak concurrency saturates around 50–100 RPS depending on request shape. Symptoms: requests queue waiting for a connection, p99 latency explodes.

2. **Single Express process CPU (~200 RPS).** Express on Node hits a CPU ceiling in the low hundreds of req/s for JSON-heavy workloads. Symptoms: event loop lag, response times degrade across the board.

3. **Hot inventory rows (~500 confirmations/sec on the same item).** The pessimistic lock on `SELECT ... FOR UPDATE` serialises confirmations of orders containing the same menu item. A single very popular item becomes a contention point.

4. **Postgres write throughput on a single instance (~2k inserts/sec on Supabase free tier).** Eventually the write side of the database becomes the bottleneck.

### 6.3 Scaling plan

| Scale level | Bottleneck addressed | Change |
|---|---|---|
| **Today (single instance)** | — | Current architecture, suitable up to ~50 RPS |
| **Horizontal API scale** | Connection pool, CPU | Run N stateless API instances behind a load balancer; each has its own pool. Connection budget on Postgres remains the constraint — use PgBouncer to multiplex thousands of API connections onto hundreds of DB connections. |
| **Read replica** | Read query load on primary | Send all `GET /orders`, `GET /menu`, `GET /bills/by-order/...` to a read replica. The primary handles writes only. |
| **Cache layer (Redis)** | Hot reads on rarely-changing data | Cache outlet records and menu items (they change infrequently). Cache TTL 5 minutes; bust on menu update. Removes 70%+ of read load. |
| **Queue-based decoupling** | Event throughput | Replace in-process worker dispatch with Kafka/Redpanda. Multiple workers consume in parallel; downstream systems (analytics, webhooks, search index) become independent consumers. |
| **Inventory partitioning** | Hot-row contention | Shard inventory by outlet — one outlet's pasta sauce contention doesn't slow another outlet. For super-popular items at one outlet, switch to atomic decrement via Redis (lose strict consistency, gain throughput; only acceptable for non-critical items where slight oversell is recoverable). |
| **Database sharding** | Single primary write throughput | Shard orders by outlet. Each outlet's data lives on one shard. Cross-outlet queries (chain-wide reporting) hit a separate analytics replica. |

### 6.4 What stays the same

Every layer above is additive — none of them change the application code. Services still write to the outbox; the outbox table just lives on a sharded primary. The worker still polls; it just publishes to Kafka instead of an in-process bus. The architecture supports the growth.

---

## 7. Failure scenarios

| Scenario | Detection | Behaviour | Recovery |
|---|---|---|---|
| **Network partition: client ↔ API** | Client times out | Client queues operations locally (offline mode) | On reconnect, `POST /sync` with queued ops; `client_op_id` makes retries safe |
| **Network partition: API ↔ DB** | `pg` connection error | Request fails with 500; no partial state because all writes are in transactions | API instance retries; load balancer routes to healthy instance |
| **API process crash mid-request** | Container restart | Transaction rolls back automatically (Postgres releases on connection loss) | No corruption; client retries get a clean state |
| **API process crash after COMMIT, before response** | Client times out | State change persisted, but client doesn't know | If the request had an idempotency key (payments) or `client_op_id` (sync), retry returns cached response. Without one (current order creation), the client has the UUID it sent and can GET to verify. |
| **Worker process crash mid-batch** | Health check fails | Locked rows release on connection loss; events stay unprocessed | Worker restarts and picks them up; `attempts` count tracks retries |
| **Poison message (event always fails to dispatch)** | `attempts >= 5` | Row excluded from worker query | Manual investigation; in production, alert + dead-letter table |
| **Concurrent confirmation of last-stock item** | Both transactions see "stock = 1" before either deducts | Pessimistic lock on `inventory` row serialises them; second one sees stock = 0 and throws `ValidationError` | Order stays in CREATED; UI tells the waiter "out of stock" |
| **Concurrent transition of same order** | Two devices both UPDATE with same expected version | First wins; second's UPDATE matches zero rows; `ConflictError` (409) | Client refetches and re-evaluates |
| **Duplicate payment request (network retry)** | Same `Idempotency-Key` arrives twice | Second request finds cached response | Same response returned; no duplicate charge |
| **Tablet syncs same batch twice** | Same `client_op_id`s in `sync_operations` table | Cached results returned for already-processed ops | No duplicate orders, no duplicate payments |
| **Stale offline transition (server moved on)** | `expected_version` mismatches `orders.version` | Returns `status: conflict` with current server state | Client surfaces conflict to user; user explicitly decides |
| **Clock skew on offline device** | `client_timestamp` may be wildly wrong | Server uses its own time for ordering; client time is forensic only | No impact on correctness |
| **Database connection pool exhaustion** | Requests queue waiting for connection | New requests wait or timeout | Operationally: increase pool size or scale API horizontally with PgBouncer |
| **Supabase outage** | All queries fail | Health check returns 500; load balancer marks instance unhealthy | When Supabase recovers, instances become healthy again; no client data loss because clients are in offline mode during the outage |

---

## 8. Trade-offs

**Optimistic locking (orders) vs pessimistic (inventory).** Mixing the two is deliberate. Optimistic is right when conflicts are rare and the cost of redo is low. Pessimistic is right when conflicts are common and the cost of getting it wrong (overselling) is high. Using one technique everywhere would either create unnecessary contention or accept dangerous race conditions.

**Outbox pattern vs direct event emission.** Direct emit (`eventBus.emit` after COMMIT) is simpler and has lower latency, but loses events on process crash. The outbox adds ~1 second of polling latency in exchange for at-least-once delivery and full event durability. For an order management system, audit completeness wins.

**In-process worker vs separate process.** The worker code is structured to run standalone (`if (require.main === module) run()`). Today it's started inside `server.js` so its `eventBus.emit` reaches the same process the SSE endpoint subscribes to. Trade-off: simpler operationally, but worker scales with the API. Production evolution: replace in-process bus with Kafka, then worker can run anywhere.

**Per-operation transactions in sync vs batch transaction.** A single transaction wrapping the whole sync batch would give all-or-nothing semantics. Per-op transactions mean partial success on conflicts. For offline restaurant ops, partial success is the right answer — losing 4 orders because one had a conflict is worse than syncing 3 and reporting 1.

**Compute-paid-on-demand vs `paid_amount` column.** Adding a `paid_amount` column to `bills` would avoid the SUM query on every payment. Trade-off: requires keeping it consistent with `payments` (denormalisation hazard) and a schema migration. The SUM is fast enough at our scale (indexed) that the consistency simplification is worth more than the marginal performance.

**SSE vs WebSockets for live events.** SSE is one-way, works over plain HTTP, has built-in browser reconnect. WebSockets are bidirectional and add complexity. The event stream is one-way, so SSE is the right tool.

**UUID primary keys vs SERIAL integers.** UUIDs allow client-side ID generation (essential for the sync endpoint's idempotency model), make IDs non-guessable, and prevent leaking transaction volume. Trade-off: 16 bytes vs 4, slightly worse index locality. For a financial system the security and offline-capability wins decisively.

**Price snapshots in `order_items` vs joining to current `menu_items`.** Storing the price at order creation time means menu price changes don't retroactively change historical bills. Standard financial-systems practice. Costs an extra column.

---

## 9. Evolution to microservices

If this system grew to need independent team ownership, the natural service boundaries are:

| Service | Owns | Why split |
|---|---|---|
| **Order service** | Orders, order_items, state machine | The hottest write path; needs independent scaling |
| **Inventory service** | Inventory, stock deductions | Different consistency model; potential for eventual-consistency relaxation per outlet |
| **Billing service** | Bills, tax/discount calculation | Slow-changing logic; can be deployed independently |
| **Payment service** | Payments, idempotency keys | Compliance boundary; PCI scope can be isolated |
| **Sync service** | sync_operations, conflict resolution | Different traffic profile (bursty on reconnect); can be scaled independently |
| **Event dispatcher** | Outbox consumer + Kafka producer | Separated from API entirely; can scale workers independently |

Inter-service communication would use the event bus that already exists in concept (today's outbox + worker, tomorrow's Kafka). Order service publishes `order.confirmed`; inventory service consumes it and decides whether to deduct. The split is compatible with today's code because services already communicate via events, just in-process.

The hardest split is order ↔ inventory, because today's code holds them in one transaction (`SELECT FOR UPDATE` on inventory inside the order state transition). The microservices version would replace this with the **saga pattern**: order service tentatively confirms; inventory service either confirms (consume `inventory.deducted` event) or rejects (`inventory.insufficient`); on rejection, order service compensates by transitioning order back to CREATED.

---

## 10. What I'd do next given more time

In rough priority order:

1. **Frontend offline mode** — the server-side `/sync` endpoint is fully built and tested; the IndexedDB queue on the React side is designed but not implemented in this submission.
2. **Real broker** — replace in-process eventBus with Kafka or Redpanda. Same code, swap one module.
3. **Decimal arithmetic** — replace `parseFloat` and JavaScript number math with `decimal.js` for monetary amounts. Current 0.01 tolerance is a stopgap.
4. **Authentication** — JWT middleware at the route layer. Routes already structured to accept it.
5. **Read replica routing** — split read traffic to a read replica.
6. **Observability** — structured logging exists (worker uses JSON); add request tracing (OpenTelemetry) and metrics (Prometheus).
7. **Saga pattern for order ↔ inventory** — preparation for the microservices evolution above.
