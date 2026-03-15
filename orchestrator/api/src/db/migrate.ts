import 'dotenv/config'; // <-- 1. Add this at the very top

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  // 2. Add the exact same fallback here!
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://dca_user:dca_pass@localhost:5432/dca_bot',
  });

  try {
    const db = drizzle(pool);
    const migrationsFolder = path.resolve(__dirname, '../../drizzle');
    console.log('[migrate] Running Drizzle migrations from', migrationsFolder);
    await migrate(db, { migrationsFolder });
    console.log('[migrate] ✓ Migrations complete');
  } finally {
    await pool.end();
  }
}

// 3. And make sure it actually executes when you run the command!
if (process.argv[1].endsWith('migrate.ts')) {
  runMigrations().catch((err) => {
    console.error('[migrate] ❌ Migration failed', err);
    process.exit(1);
  });
}