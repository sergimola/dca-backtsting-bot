import 'dotenv/config';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1_000;

export async function runMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL || 'postgresql://dca_user:dca_pass@localhost:5432/dca_bot';
  const migrationsFolder = path.resolve(__dirname, '../../drizzle');
  console.log('[migrate] Running Drizzle migrations from', migrationsFolder);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      const db = drizzle(client);
      await migrate(db, { migrationsFolder });
      await client.end().catch(() => {}); // always close the client after successful migration
      console.log('[migrate] ✓ Migrations complete');
      return;
    } catch (err: any) {
      lastError = err;
      await client.end().catch(() => {});
      const isTransient = err?.code === 'ECONNRESET' || err?.code === 'ECONNREFUSED' || err?.cause?.code === 'ECONNRESET' || err?.cause?.code === 'ECONNREFUSED';
      if (isTransient && attempt < MAX_RETRIES) {
        console.warn(`[migrate] Connection failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// 3. And make sure it actually executes when you run the command!
if (process.argv[1].endsWith('migrate.ts')) {
  runMigrations().catch((err) => {
    console.error('[migrate] ❌ Migration failed', err);
    process.exit(1);
  });
}