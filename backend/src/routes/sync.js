const express = require('express');
const router = express.Router();
const syncService = require('../services/syncService');

/**
 * POST /sync
 * Accepts a batch of operations from an offline client, processes each
 * with appropriate conflict handling, returns per-op results.
 */
router.post('/', async (req, res) => {
  try {
    const result = await syncService.processSyncBatch(req.body);
    res.json(result);
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    console.error('[sync route]', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;