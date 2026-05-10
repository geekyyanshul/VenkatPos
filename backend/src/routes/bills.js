const express = require('express');
const router = express.Router();
const billService = require('../services/billService');

router.post('/', async (req, res) => {
  try {
    const { order_id,discount } = req.body;
    if (!order_id) return res.status(400).json({ error: 'order_id required' });
    const bill = await billService.generateBill(order_id,discount);
    res.status(201).json(bill);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/by-order/:order_id', async (req, res) => {
  try {
    const bill = await billService.getBillByOrderId(req.params.order_id);
    res.json(bill);
  } catch (err) {
    handleError(res, err);
  }
});

function handleError(res, err) {
  if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
  if (err.name === 'NotFoundError') return res.status(404).json({ error: err.message });
  if (err.name === 'ConflictError') return res.status(409).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
}

module.exports = router;