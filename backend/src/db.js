const { Pool } = require('pg');
require('dotenv').config();

// A connection pool reuses connections instead of opening a new one per query.
// In a POS handling 10k orders/hr, this matters a lot.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  database: process.env.DATABASE_URL ? undefined : 'pos_system',
  // Other options (host, user, password, port) default to your local Postgres.
  // On a Mac with Homebrew Postgres, this just works.
  max: 20,                       // max 20 connections in the pool
  idleTimeoutMillis: 30000,      // close idle connections after 30s
});

module.exports = { pool };