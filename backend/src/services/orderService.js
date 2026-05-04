const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');

// ============================================================
// Custom error types so the route layer knows what HTTP code to send
// ============================================================
class ValidationError extends Error { constructor(msg) { super(msg); this.name = 'ValidationError'; } }
class NotFoundError extends Error { constructor(msg) { super(msg); this.name = 'NotFoundError'; } }
class ConflictError extends Error { constructor(msg) { super(msg); this.name = 'ConflictError'; } }

// ============================================================
// State machine: which transitions are allowed?
// ============================================================
const ALLOWED_TRANSITIONS = {
  CREATED:   ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY'],
  READY:     ['SERVED'],
  SERVED:    ['PAID'],
  PAID:      [],
  CANCELLED: []
};

function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

// ============================================================
// Create a new order with items
// ============================================================
async function createOrder(input) {
  const { outlet_id, order_type, table_number, items } = input;

  // Validation
  if (!outlet_id || !order_type || !Array.isArray(items) || items.length === 0) {
    throw new ValidationError('outlet_id, order_type, and non-empty items are required');
  }
  if (!['DINE_IN', 'TAKEAWAY'].includes(order_type)) {
    throw new ValidationError('order_type must be DINE_IN or TAKEAWAY');
  }
  if (order_type === 'DINE_IN' && !table_number) {
    throw new ValidationError('table_number is required for DINE_IN orders');
  }
  for (const item of items) {
    if (!item.menu_item_id || !item.quantity || item.quantity <= 0) {
      throw new ValidationError('each item needs menu_item_id and positive quantity');
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify outlet exists
    const outletCheck = await client.query(
      'SELECT outlet_id FROM outlets WHERE outlet_id = $1',
      [outlet_id]
    );
    if (outletCheck.rowCount === 0) {
      throw new ValidationError(`outlet ${outlet_id} does not exist`);
    }

    // Fetch all menu items for this outlet at once
    const menuItemIds = items.map(i => i.menu_item_id);
    const menuResult = await client.query(
      'SELECT menu_item_id, price FROM menu_items WHERE menu_item_id = ANY($1) AND outlet_id = $2',
      [menuItemIds, outlet_id]
    );
    if (menuResult.rowCount !== menuItemIds.length) {
      throw new ValidationError('one or more menu items do not exist for this outlet');
    }

    // Snapshot prices
    const priceMap = {};
    for (const row of menuResult.rows) {
      priceMap[row.menu_item_id] = row.price;
    }

    // Insert order
    const order_id = uuidv4();
    await client.query(
      `INSERT INTO orders (order_id, outlet_id, order_type, table_number, status, version)
       VALUES ($1, $2, $3, $4, 'CREATED', 1)`,
      [order_id, outlet_id, order_type, table_number || null]
    );

    // Insert items
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [order_id, item.menu_item_id, item.quantity, priceMap[item.menu_item_id], item.notes || null]
      );
    }

    await client.query('COMMIT');
    return await getOrderById(order_id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================
// Fetch an order with all its items
// ============================================================
async function getOrderById(order_id) {
  const orderResult = await pool.query(
    'SELECT * FROM orders WHERE order_id = $1',
    [order_id]
  );
  if (orderResult.rowCount === 0) {
    throw new NotFoundError(`order ${order_id} not found`);
  }
  const itemsResult = await pool.query(
    `SELECT oi.*, mi.name FROM order_items oi
       JOIN menu_items mi ON mi.menu_item_id = oi.menu_item_id
       WHERE oi.order_id = $1`,
    [order_id]
  );
  return {
    ...orderResult.rows[0],
    items: itemsResult.rows
  };
}

// ============================================================
// Transition an order to a new status
// - state machine guard
// - optimistic locking via version column
// - inventory deduction (pessimistic lock) on CREATED -> CONFIRMED
// ============================================================
async function transitionOrder(order_id, new_status) {
  const { eventBus } = require('../events');

  if (!new_status || !ALLOWED_TRANSITIONS.hasOwnProperty(new_status)) {
    throw new ValidationError(`invalid target status: ${new_status}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      'SELECT status, version FROM orders WHERE order_id = $1',
      [order_id]
    );
    if (orderResult.rowCount === 0) {
      throw new NotFoundError(`order ${order_id} not found`);
    }
    const { status: current_status, version } = orderResult.rows[0];

    if (!canTransition(current_status, new_status)) {
      throw new ValidationError(`cannot transition from ${current_status} to ${new_status}`);
    }

    if (current_status === 'CREATED' && new_status === 'CONFIRMED') {
      await deductInventory(client, order_id);
    }

    const update = await client.query(
      `UPDATE orders 
       SET status = $1, version = version + 1, updated_at = NOW()
       WHERE order_id = $2 AND version = $3`,
      [new_status, order_id, version]
    );

    if (update.rowCount === 0) {
      throw new ConflictError('order was modified concurrently, please retry');
    }

    await client.query('COMMIT');

    eventBus.emit('order.status_changed', {
      order_id, from: current_status, to: new_status
    });
    if (new_status === 'CONFIRMED') {
      eventBus.emit('order.confirmed', { order_id });
    }

    return await getOrderById(order_id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================
// Deduct inventory for all items in an order
// Uses SELECT ... FOR UPDATE (pessimistic lock) so two concurrent
// confirmations can't both see "enough stock" and oversell.
// ============================================================
async function deductInventory(client, order_id) {
  const itemsResult = await client.query(
    'SELECT menu_item_id, quantity FROM order_items WHERE order_id = $1',
    [order_id]
  );

  for (const item of itemsResult.rows) {
    const stockResult = await client.query(
      'SELECT stock FROM inventory WHERE menu_item_id = $1 FOR UPDATE',
      [item.menu_item_id]
    );
    if (stockResult.rowCount === 0) {
      throw new ValidationError(`inventory not configured for menu_item ${item.menu_item_id}`);
    }
    const current_stock = stockResult.rows[0].stock;
    if (current_stock < item.quantity) {
      throw new ValidationError(
        `insufficient stock for menu_item ${item.menu_item_id}: have ${current_stock}, need ${item.quantity}`
      );
    }
    await client.query(
      'UPDATE inventory SET stock = stock - $1, updated_at = NOW() WHERE menu_item_id = $2',
      [item.quantity, item.menu_item_id]
    );
  }
}

module.exports = {
  createOrder,
  getOrderById,
  transitionOrder,
  ValidationError,
  NotFoundError,
  ConflictError
};