const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /outlets — list all outlets
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT outlet_id, name, tax_rate FROM outlets ORDER BY outlet_id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// GET /outlets/:id/menu — list menu items for an outlet
router.get('/:id/menu', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT menu_item_id, name, price FROM menu_items WHERE outlet_id = $1 ORDER BY menu_item_id',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;
