const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');

class ValidationError extends Error { constructor(msg) { super(msg); this.name = 'ValidationError'; } }
class NotFoundError extends Error { constructor(msg) { super(msg); this.name = 'NotFoundError'; } }
class ConflictError extends Error { constructor(msg) { super(msg); this.name = 'ConflictError'; } }

async function generateBill(order_id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      'SELECT outlet_id, status FROM orders WHERE order_id = $1 FOR UPDATE',
      [order_id]
    );
    if (orderResult.rowCount === 0) {
      throw new NotFoundError('order not found');
    }
    const { outlet_id, status } = orderResult.rows[0];

    if (status !== 'SERVED' && status !== 'READY') {
      throw new ValidationError('bill can only be generated for SERVED or READY orders, current status: ' + status);
    }

    const existing = await client.query(
      'SELECT bill_id FROM bills WHERE order_id = $1',
      [order_id]
    );
    if (existing.rowCount > 0) {
      throw new ConflictError('bill already exists for this order');
    }

    const taxResult = await client.query(
      'SELECT tax_rate FROM outlets WHERE outlet_id = $1',
      [outlet_id]
    );
    const tax_rate = parseFloat(taxResult.rows[0].tax_rate);

    const itemsResult = await client.query(
      'SELECT quantity, unit_price FROM order_items WHERE order_id = $1',
      [order_id]
    );
    let subtotal = 0;
    for (const item of itemsResult.rows) {
      subtotal += parseFloat(item.unit_price) * item.quantity;
    }
    const tax_amount = +(subtotal * tax_rate).toFixed(2);
    const total = +(subtotal + tax_amount).toFixed(2);

    const bill_id = uuidv4();
    await client.query(
      `INSERT INTO bills (bill_id, order_id, subtotal, tax_amount, total, status)
       VALUES ($1, $2, $3, $4, $5, 'UNPAID')`,
      [bill_id, order_id, subtotal.toFixed(2), tax_amount, total]
    );

    await client.query('COMMIT');

    return { bill_id, order_id, subtotal: subtotal.toFixed(2), tax_amount, total, status: 'UNPAID' };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      throw new ConflictError('bill already exists for this order');
    }
    throw err;
  } finally {
    client.release();
  }
}

async function getBillByOrderId(order_id) {
  const result = await pool.query(
    'SELECT * FROM bills WHERE order_id = $1',
    [order_id]
  );
  if (result.rowCount === 0) {
    throw new NotFoundError('bill not found for this order');
  }
  return result.rows[0];
}

module.exports = { generateBill, getBillByOrderId, ValidationError, NotFoundError, ConflictError };