const crypto = require('crypto');

/**
 * Records an event to the outbox table.
 * 
 * CRITICAL: This function MUST be called with a transaction client
 * (not the pool), so the event insert is part of the same transaction
 * as the state change that produced it.
 * 
 * Why? This solves the "dual-write problem":
 *   - If we wrote the event AFTER COMMIT, a crash between COMMIT and
 *     the event write means the state change happened but no event fired.
 *   - If we wrote the event BEFORE COMMIT (to an external system like Kafka),
 *     a rollback would mean we announced something that never happened.
 * 
 * By writing the event to a DB table inside the same transaction, both
 * the state change and the event are committed atomically — or neither is.
 * A separate worker process polls this table and dispatches events. This
 * gives us at-least-once delivery semantics with no dual-write hazard.
 * 
 * @param {pg.Client} client - active transaction client
 * @param {string} eventType - dot-notation event name, e.g. 'order.created'
 * @param {string} aggregateId - the entity this event is about (order_id, bill_id, etc.)
 * @param {object} payload - JSON-serializable event data
 * @returns {Promise<string>} the generated event_id
 */
async function recordEvent(client, eventType, aggregateId, payload) {
  const eventId = crypto.randomUUID();

  await client.query(
    `INSERT INTO outbox_events (event_id, event_type, aggregate_id, payload)
     VALUES ($1, $2, $3, $4)`,
    [eventId, eventType, aggregateId, JSON.stringify(payload)]
  );

  return eventId;
}

module.exports = { recordEvent };