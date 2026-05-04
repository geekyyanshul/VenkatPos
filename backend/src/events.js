const { EventEmitter } = require('events');
const eventBus = new EventEmitter();

eventBus.on('order.confirmed',function(d){ console.log('confirmed',d.order_id); });
eventBus.on('order.status_changed', function(d){ console.log('order status changed', d.order_id); });
eventBus.on('payment.recorded', function(d) {console.log('payment',d.payment_id); });
module.exports = { eventBus };
