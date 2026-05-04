const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const ordersRouter = require('./routes/orders');
const billsRouter = require('./routes/bills');
const paymentsRouter = require('./routes/payments');
const outletsRouter = require('./routes/outlets');

const app = express();

// Render runs us behind a reverse proxy. Trusting it makes req.ip, req.protocol,
// and any future rate-limiting middleware see the real client instead of the proxy.
app.set('trust proxy', 1);

// CORS: in prod, only allow our Vercel frontend. In dev, allow anything so local
// tools (curl, Postman, vite dev on localhost:5173) just work.
//
// CORS_ORIGIN can be a comma-separated list, e.g.:
//   CORS_ORIGIN=https://pos-frontend-three-iota.vercel.app,https://pos-frontend-three-iota-git-main.vercel.app
// That second URL is Vercel's preview deployments — useful when testing branches.
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : '*';

app.use(cors({ origin: corsOrigins }));
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as now');
    res.json({ status: 'ok', db_time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.use('/outlets', outletsRouter);
app.use('/orders', ordersRouter);
app.use('/bills', billsRouter);
app.use('/payments', paymentsRouter);

// Global error handler — catches anything thrown in routes that wasn't already
// caught by the route's own try/catch. Returns JSON so the frontend's
// `await res.json()` calls don't choke on an HTML error page.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'internal server error' });
});

const PORT = process.env.PORT || 3000;
// Bind to 0.0.0.0 explicitly — Render's load balancer needs this to reach the
// container. Defaults usually work, but being explicit avoids a class of
// "works locally, mystery 502 on Render" bugs.
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`POS server running on port ${PORT}`);
});

// Graceful shutdown: when Render redeploys, it sends SIGTERM. We finish
// in-flight requests, then close the DB pool, then exit. Without this,
// active requests get killed mid-query and Postgres connections leak.
const shutdown = async (signal) => {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(async () => {
    await pool.end();
    console.log('Server and DB pool closed. Bye.');
    process.exit(0);
  });
  // Hard timeout so a stuck connection can't hold us hostage forever.
  setTimeout(() => {
    console.error('Forcing shutdown after 10s timeout');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));