const { EventEmitter } = require('events');

/**
 * In-process event bus used by the outbox worker to dispatch events
 * to local subscribers (currently: the SSE endpoint).
 *
 * In a real production system this would be replaced with a real broker
 * (Kafka, RabbitMQ, NATS, etc.). The worker would publish to the broker
 * instead of emitting locally. The rest of the system — services writing
 * to the outbox, consumers subscribing to event streams — stays the same.
 *
 * That decoupling is the whole point: the *interface* between event
 * producers and consumers is the outbox table, not the transport.
 */
const eventBus = new EventEmitter();

// Allow many subscribers (multiple SSE clients, future webhook dispatcher, etc.)
eventBus.setMaxListeners(100);

module.exports = { eventBus };