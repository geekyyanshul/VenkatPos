const { Pool } = require('pg');
require('dotenv').config();

// SSL note: managed Postgres providers (Supabase, Neon, Render Postgres) require
// SSL on all connections. The `pg` library defaults to no SSL, so we have to
// turn it on explicitly. Locally (Homebrew Postgres, no DATABASE_URL set), SSL
// stays off — local Postgres doesn't accept it.
const isHosted = !!process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  database: process.env.DATABASE_URL ? undefined : 'pos_system',
  ssl: isHosted ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
});

module.exports = { pool };