const { pool } = require('./db');
const { eventBus } = require('./eventBus');

const POLL_INTERVAL_MS = 1000;   // how often to check for new events
const BATCH_SIZE = 50;            // how many events to grab per poll
const MAX_ATTEMPTS = 5;           // give up after this many failures

let isShuttingDown = false;

/**
 * Process one batch of pending events.
 * 
 * The query uses FOR UPDATE SKIP LOCKED, which is the magic sauce of the
 * outbox pattern: multiple worker processes can run in parallel without
 * stepping on each other. Each worker grabs a batch of rows, locking them
 * for the duration of its transaction. Other workers running the same
 * query SKIP those locked rows and grab different ones.
 * 
 * This means horizontal scaling of the worker is trivial: just run more
 * processes. No coordination needed.
 */
async function processBatch() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Grab a batch of unprocessed events, locking them so no other worker
    // picks them up while we're processing.
    const result = await client.query(
      `SELECT event_id, event_type, aggregate_id, payload, attempts
       FROM outbox_events
       WHERE processed_at IS NULL
         AND attempts < $1
       ORDER BY created_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [MAX_ATTEMPTS, BATCH_SIZE]
    );

    if (result.rowCount === 0) {
      await client.query('COMMIT');
      return 0;
    }

    for (const event of result.rows) {
      try {
        await dispatchEvent(event);

        // Mark this event as processed.
        await client.query(
          `UPDATE outbox_events 
           SET processed_at = NOW() 
           WHERE event_id = $1`,
          [event.event_id]
        );
      } catch (err) {
        // Dispatch failed — increment attempt count, record error.
        // The event stays unprocessed and will be retried on the next poll.
        // After MAX_ATTEMPTS the WHERE clause excludes it (poison-message handling).
        await client.query(
          `UPDATE outbox_events 
           SET attempts = attempts + 1, last_error = $1
           WHERE event_id = $2`,
          [err.message.slice(0, 500), event.event_id]
        );
        console.error(`[worker] dispatch failed for ${event.event_id} (${event.event_type}):`, err.message);
      }
    }

    await client.query('COMMIT');
    return result.rowCount;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[worker] batch processing error:', err);
    return 0;
  } finally {
    client.release();
  }
}

/**
 * Dispatch a single event. Currently:
 *   1. Logs to console
 *   2. Emits to in-process eventBus (so SSE clients see it)
 * 
 * In production this would also publish to Kafka/RabbitMQ, send webhooks,
 * notify analytics, etc. Each downstream system would be its own try/catch
 * so a failure in one doesn't block the others.
 */
async function dispatchEvent(event) {
  const { event_id, event_type, aggregate_id, payload } = event;

  // 1. Structured log — what would normally go to a log aggregator
  console.log(JSON.stringify({
    level: 'info',
    component: 'outbox-worker',
    event_id,
    event_type,
    aggregate_id,
    payload,
    timestamp: new Date().toISOString(),
  }));

  // 2. In-process pub/sub — the SSE endpoint subscribes to this
  eventBus.emit('event', { event_id, event_type, aggregate_id, payload });
  eventBus.emit(event_type, { event_id, aggregate_id, payload }); // type-specific subscribers
}

/**
 * Main loop. Polls forever until shutdown signal.
 */
async function run() {
  console.log('[worker] outbox dispatcher started');

  while (!isShuttingDown) {
    try {
      const processed = await processBatch();
      if (processed === 0) {
        // No work — sleep briefly. With work, loop immediately to drain queue.
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (err) {
      console.error('[worker] unexpected error in main loop:', err);
      await sleep(POLL_INTERVAL_MS);
    }
  }

  console.log('[worker] shutdown complete');
  await pool.end();
  process.exit(0);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Graceful shutdown — finish the in-flight batch, then exit.
process.on('SIGTERM', () => { isShuttingDown = true; });
process.on('SIGINT',  () => { isShuttingDown = true; });

// Start when run directly (not when required as a module)
if (require.main === module) {
  run();
}

module.exports = { processBatch, dispatchEvent, run };