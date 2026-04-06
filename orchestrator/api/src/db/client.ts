/**
 * Drizzle DB Client (T006)
 *
 * Single pg.Pool + drizzle instance shared across the process.
 * Import `db` from this module everywhere you need database access.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 30_000, // allow time for Docker/WSL2 network transients
});

// Prevent idle clients that are terminated by Postgres (e.g. admin command,
// idle-in-transaction timeout) from crashing the process with an unhandled
// 'error' event. The pool itself handles reconnection transparently.
pool.on('error', (err) => {
  console.error('[db] Pool client error (client will be discarded):', err.message);
});

export const db = drizzle(pool, { schema });
export { pool };
