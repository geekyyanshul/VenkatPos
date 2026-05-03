const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { pool } = require('../db');

// GET /orders?outlet_id=X — list orders for an outlet
router.get('/', async (req, res) => {
  try {
    const { outlet_id } = req.query;
    if (!outlet_id) {
      return res.status(400).json({ error: 'outlet_id query param required' });
    }
    const result = await pool.query(
      `SELECT order_id, outlet_id, order_type, table_number, status, created_at, updated_at
         FROM orders WHERE outlet_id = $1 ORDER BY created_at DESC`,
      [outlet_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// POST /orders — create a new order
router.post('/', async (req, res) => {
  try {
    const order = await orderService.createOrder(req.body);
    res.status(201).json(order);
  } catch (err) {
    handleError(res, err);
  }
});

// GET /orders/:id — fetch an existing order
router.get('/:id', async (req, res) => {
  try {
    const order = await orderService.getOrderById(req.params.id);
    res.json(order);
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /orders/:id/status — transition an order to a new state
router.patch('/:id/status', async (req, res) => {
  try {
    const { new_status } = req.body;
    const order = await orderService.transitionOrder(req.params.id, new_status);
    res.json(order);
  } catch (err) {
    handleError(res, err);
  }
});

function handleError(res, err) {
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }
  if (err.name === 'NotFoundError') {
    return res.status(404).json({ error: err.message });
  }
  if (err.name === 'ConflictError') {
    return res.status(409).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
}

module.exports = router;