const { Pool } = require('pg');
require('dotenv').config();

<<<<<<< Updated upstream
=======
// A connection pool reuses connections instead of opening a new one per query.
// In a POS handling 10k orders/hr, this matters a lot.
//
>>>>>>> Stashed changes
// SSL note: managed Postgres providers (Supabase, Neon, Render Postgres) require
// SSL on all connections. The `pg` library defaults to no SSL, so we have to
// turn it on explicitly. Locally (Homebrew Postgres, no DATABASE_URL set), SSL
// stays off — local Postgres doesn't accept it.
const isHosted = !!process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  database: process.env.DATABASE_URL ? undefined : 'pos_system',
  // Other options (host, user, password, port) default to your local Postgres.
  // On a Mac with Homebrew Postgres, this just works.
  ssl: isHosted ? { rejectUnauthorized: false } : false,
  max: 20,                       // max 20 connections in the pool
  idleTimeoutMillis: 30000,      // close idle connections after 30s
});

module.exports = { pool };
