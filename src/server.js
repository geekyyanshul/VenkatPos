const express = require('express');
const { pool } = require('./db');
const ordersRouter = require('./routes/orders');
const billsRouter = require('./routes/bills');
const paymentsRouter = require('./routes/payments');

const app = express();
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as now');
    res.json({ status: 'ok', db_time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.use('/orders', ordersRouter);
app.use('/bills', billsRouter);
app.use('/payments', paymentsRouter);

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`POS server running on http://localhost:${PORT}`);
});