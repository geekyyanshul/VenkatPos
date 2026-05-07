const express = require('express');
const { eventBus } = require('../eventBus');

const router = express.Router();

/**
 * GET /events/stream
 * 
 * Server-Sent Events (SSE) endpoint that streams outbox events to any
 * connected client in real time. The flow is:
 * 
 *   1. Service writes event to outbox table (in transaction)
 *   2. Worker picks it up, dispatches to in-process eventBus
 *   3. THIS endpoint subscribes to eventBus and forwards to HTTP clients
 * 
 * This lets the frontend (or a curl session, or a video demo) watch the
 * event stream live. In production the same architecture supports:
 *   - Frontend live updates (kitchen display showing new orders instantly)
 *   - Webhook delivery to third-party systems
 *   - Real-time analytics dashboards
 * 
 * SSE was chosen over WebSockets because the data flow is one-way
 * (server -> client) and SSE works over plain HTTP with automatic
 * reconnection built into the browser EventSource API. WebSockets would
 * be overkill for a notification stream.
 */
router.get('/stream', (req, res) => {
  // SSE protocol headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx/proxy buffering

  // Optional: filter by event type via ?type=order.created,inventory.deducted
  const filter = req.query.type
    ? new Set(req.query.type.split(','))
    : null;

  // Tell the client we're connected
  res.write(`event: connected\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);

  // The handler we'll subscribe and unsubscribe with the same reference,
  // so cleanup actually works when the client disconnects.
  const handler = (event) => {
    if (filter && !filter.has(event.event_type)) return;
    res.write(`event: ${event.event_type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  eventBus.on('event', handler);

  // Heartbeat every 15s so proxies/load balancers don't kill an idle connection.
  // The colon prefix makes it an SSE comment that clients silently ignore.
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 15000);

  // Cleanup when the client disconnects (closes tab, navigates away, etc.)
  req.on('close', () => {
    clearInterval(heartbeat);
    eventBus.off('event', handler);
  });
});

module.exports = router;