const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');

router.post('/', async (req, res) => {
  try {
    const idempotencyKey = req.header('Idempotency-Key');
    const result = await paymentService.recordPayment(req.body, idempotencyKey);
    res.status(result.status).json(result.body);
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