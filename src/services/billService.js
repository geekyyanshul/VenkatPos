const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');

class ValidationError extends Error { constructor(msg) { super(msg); this.name = 'ValidationError'; } }
class NotFoundError extends Error { constructor(msg) { super(msg); this.name = 'NotFoundError'; } }
class ConflictError extends Error { constructor(msg) { super(msg); this.name = 'ConflictError'; } }

async function generateBill(order_id, discount = null) {
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

    let discount_type = null;
    let discount_value = 0;
    let discount_amount = 0;
    if (discount && discount.type && discount.value) {
      if (!['FLAT', 'PERCENTAGE'].includes(discount.type)) {
        throw new ValidationError('discount.type must be FLAT or PERCENTAGE');
      }
      if (discount.value <= 0) {
        throw new ValidationError('discount.value must be positive');
      }
      discount_type = discount.type;
      discount_value = parseFloat(discount.value);
      if (discount_type === 'FLAT') {
        discount_amount = Math.min(discount_value, subtotal);
      } else {
        if (discount_value > 100) {
          throw new ValidationError('percentage discount cannot exceed 100');
        }
        discount_amount = +(subtotal * (discount_value / 100)).toFixed(2);
      }
    }

    const taxable = subtotal - discount_amount;
    const tax_amount = +(taxable * tax_rate).toFixed(2);
    const total = +(taxable + tax_amount).toFixed(2);

    const bill_id = uuidv4();
    await client.query(
      `INSERT INTO bills (bill_id, order_id, subtotal, tax_amount, total, status, discount_type, discount_value)
       VALUES ($1, $2, $3, $4, $5, 'UNPAID', $6, $7)`,
      [bill_id, order_id, subtotal.toFixed(2), tax_amount, total, discount_type, discount_value]
    );

    await client.query('COMMIT');

    return {
      bill_id, order_id,
      subtotal: subtotal.toFixed(2),
      discount_type, discount_value, discount_amount,
      tax_amount, total, status: 'UNPAID'
    };
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
    throw new NotFoundError(`no bill found for order ${order_id}`);
  }
  return result.rows[0];
}

module.exports = { generateBill, getBillByOrderId, ValidationError, NotFoundError, ConflictError };