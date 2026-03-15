# Research: Postgres Async Architecture

**Branch**: `010-postgres-async-architecture`  
**Generated**: 2026-03-15  
**Purpose**: Resolve all technical unknowns identified in the Technical Context of plan.md before Phase 1 design begins.

---

## Unknown 1: Drizzle ORM + ESM + TypeScript Setup

**Question**: Which packages are required and how are migrations applied at startup in an ESM TypeScript project?

**Decision**: Install `drizzle-orm` + `pg` as runtime deps; `drizzle-kit` + `@types/pg` as dev deps. Use the programmatic `migrate()` from `drizzle-orm/node-postgres/migrator` to apply committed SQL migration files on startup.

**Rationale**: `drizzle-orm` ships with dual CJS/ESM output, making it natively compatible with the project's `"type": "module"` package. `pg` (node-postgres) is CJS-only but Node 18+ transparently imports it via ESM. The programmatic migrator runs pre-generated SQL files from a `./drizzle` folder without shelling out to `drizzle-kit` at runtime.

**Packages to add:**
```
npm install drizzle-orm pg
npm install -D drizzle-kit @types/pg
```

**Startup migration pattern:**
```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
await migrate(db, { migrationsFolder: './drizzle' });
```

Migration SQL files are generated via `npx drizzle-kit generate` during development, committed to the repo, and applied automatically at runtime.

**Alternatives considered**: `prisma` — heavier footprint, bespoke DSL, slower schema iteration. `knex` — no type-safe query builder, manual type annotations. Drizzle wins on type safety, ESM support, and minimal abstraction overhead.

---

## Unknown 2: Background Worker Pattern in Node.js

**Question**: For a single-process Express server, what is the correct pattern for a background worker that polls Postgres for `pending` jobs and processes them one-at-a-time?

**Decision**: Use `setInterval` polling every 2 seconds with a boolean `isProcessing` mutex to prevent overlapping runs.

**Rationale**: LISTEN/NOTIFY is more reactive but requires a dedicated long-lived PG connection outside the pool plus reconnect handling. Worker threads add cross-thread serialization overhead with no CPU benefit (the bottleneck is the Go engine I/O, not Node.js computation). For a single-run-at-a-time MVP, `setInterval` with a mutex is trivially simple and fully testable.

**Pattern:**
```ts
class BackgroundWorker {
  private isProcessing = false;

  start() {
    setInterval(() => this.tick(), 2000);
  }

  private async tick() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      const job = await this.repo.claimPending(); // UPDATE … SET status='running' RETURNING *
      if (job) await this.process(job);
    } finally {
      this.isProcessing = false;
    }
  }
}
```

**Alternatives considered**: LISTEN/NOTIFY — better latency (<100ms vs ~2s) but complex reconnect loop; out of scope for MVP. `bull`/`bullmq` Redis queues — heavy external dependency, out of constitution scope for this feature.

---

## Unknown 3: Drizzle ORM Select Column Omission

**Question**: How to SELECT from a Drizzle ORM table while explicitly excluding specific JSONB columns (`trades`, `safetyOrders`) in the list query?

**Decision**: Use `getTableColumns()` (or `getColumns()` in Drizzle ≥1.0 beta) to destructure and omit the heavy columns, then spread the rest into `.select()`.

**Pattern:**
```ts
import { getTableColumns } from 'drizzle-orm';

const { trades, safetyOrders, ...listCols } = getTableColumns(backtestsTable);
const rows = await db.select(listCols).from(backtestsTable).orderBy(desc(backtestsTable.createdAt));
// TypeScript return type automatically excludes trades and safetyOrders
```

**Alternatives considered**: `db.select({ id: backtestsTable.id, status: backtestsTable.status, ... })` — verbose, must be updated whenever columns are added. The destructure pattern is self-maintaining.

---

## Unknown 4: Sync Ledger `end_date` Accuracy

**Question**: Should `market_data_syncs.end_date` be set to the user's configured backtest `end_date`, the timestamp of the actual last downloaded candle, or `Date.now()` at loop exit?

**Decision**: Set `end_date` to the **timestamp of the actual last downloaded candle** tracked during the download loop.

**Rationale**: Using the user's configured `end_date` creates false cache hits — the record claims coverage through a future date that was never actually downloaded. Using `Date.now()` at loop exit is slightly ahead of the last candle due to processing latency and Binance's open-candle window. The last candle's actual open timestamp is the most precise and conservative value: a future request whose range ends before this timestamp is a true cache hit.

**Implementation change** to `BinanceDownloader.ts`:
```ts
let lastCandleTs = start.getTime(); // track across pages
// inside the while loop, after receiving ohlcv:
const lastTs = ohlcv[ohlcv.length - 1][0];
lastCandleTs = lastTs;       // update on every page
since = lastTs + 60_000;

// After loop exits, write to Postgres:
synced_to: new Date(lastCandleTs) // ← actual last candle, not `end`
```

**Alternatives considered**: `Date.now()` — slightly ahead of reality (processing lag + Binance open-candle discard). `end` (user's date) — can create phantom coverage gaps on re-check. Last candle timestamp is the ground truth.

---

## Unknown 5: Drizzle JSONB Column Type

**Question**: What is the correct `drizzle-orm/pg-core` column definition for storing large JSON arrays (trades, safetyOrders) as JSONB?

**Decision**: Use `jsonb().$type<T>()` for typed JSONB columns.

**Pattern:**
```ts
import { jsonb, pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const backtests = pgTable('backtests', {
  // ...
  trades:       jsonb('trades').$type<TradeEvent[]>(),
  safetyOrders: jsonb('safety_orders').$type<SafetyOrder[]>(),
});
```

The `$type<T>()` call attaches TypeScript inference to the column without affecting the DDL. The underlying Postgres type is `jsonb` — binary-stored, indexed, and efficiently parsed on retrieval.

---

## Unknown 6: Status Column Type

**Question**: Should `backtests.status` be a Postgres ENUM or a TEXT + CHECK constraint?

**Decision**: Use **TEXT column with a CHECK constraint**.

**Rationale**: Postgres ENUMs are a named database type. Renaming or removing enum values requires dropping and recreating the type in a multi-step migration. A TEXT + CHECK constraint is altered with a single `ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT` in one transaction. For a stable 4-value set, the practical difference is small, but TEXT + CHECK wins on migration simplicity, reversibility, and Drizzle ORM ergonomics.

**Pattern:**
```ts
import { text, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

status: text('status').notNull().default('pending'),
// In table check:
check('backtests_status_check', sql`status IN ('pending','running','completed','failed')`)
```

---

## Unknown 7: `market_data_syncs` Migration from ClickHouse to Postgres

**Question**: The existing `market_data_syncs` table lives in ClickHouse (created in `001_market_data.sql`). The spec mandates a Postgres `market_data_syncs` table as the primary cache ledger. How should the transition be handled?

**Decision**: Create a new `market_data_syncs` table in Postgres. Deprecate writes to the ClickHouse table (no new inserts). The existing ClickHouse table DDL is kept in `001_market_data.sql` for backward compatibility but is never written to by Node.js code after this feature. GapResolver and BinanceDownloader are rewritten to exclusively use the Postgres table.

**Rationale**: The ClickHouse table predates this feature and was manually managed. Moving it to Postgres unifies all application state in one transactional database, making the ledger consistent with the backtest job lifecycle. On-disk ClickHouse data is not migrated because any previously downloaded data will simply prompt a re-download on the first request (the Postgres ledger is empty at first startup), then fill in organically.

**Alternatives considered**: Keeping the ClickHouse table as the canonical ledger — rejected because Postgres is now the source of truth for all application metadata; having two authoritative ledgers would split the GapResolver logic.

---

## Unknown 8: Atomic `claimPending` Pattern for Background Worker

**Question**: How does the background worker claim a pending job atomically without another concurrent worker (future horizontal scaling) picking the same job?

**Decision**: Use `UPDATE … SET status = 'running' WHERE id = (SELECT id FROM backtests WHERE status = 'pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`.

**Rationale**: `FOR UPDATE SKIP LOCKED` is a Postgres-native pattern for job queues. It acquires a row lock and skips already-locked rows atomically, preventing double-processing. This is safe for both single-worker (MVP) and future multi-worker deployments without any application-level locking.

**Pattern (raw SQL via Drizzle):**
```ts
const [job] = await db.execute(sql`
  UPDATE backtests
  SET status = 'running', updated_at = NOW()
  WHERE id = (
    SELECT id FROM backtests
    WHERE status = 'pending'
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *
`);
```

---

## Summary Table

| Unknown | Resolution |
|---------|-----------|
| Drizzle + ESM packages | `drizzle-orm` + `pg`; `drizzle-kit` + `@types/pg`; programmatic `migrate()` at startup |
| Background worker pattern | `setInterval` 2s + `isProcessing` mutex; `FOR UPDATE SKIP LOCKED` claim |
| Drizzle select omission | `getTableColumns()` destructure → spread into `.select()` |
| `synced_to` accuracy | Last downloaded candle's actual timestamp (tracked per page in downloader) |
| JSONB column definition | `jsonb().$type<T[]>()` in `drizzle-orm/pg-core` |
| Status column type | `text().default('pending')` + CHECK constraint (not ENUM) |
| `market_data_syncs` migration | New Postgres table; ClickHouse table deprecated (no new writes); GapResolver rewritten |
| Atomic job claim | `UPDATE … FOR UPDATE SKIP LOCKED RETURNING *` |
