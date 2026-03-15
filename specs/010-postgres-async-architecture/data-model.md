# Data Model: Postgres Async Architecture

**Branch**: `010-postgres-async-architecture`  
**Generated**: 2026-03-15  
**Source**: spec.md FR-007, FR-008 + research.md decisions

---

## Entity 1: `backtests` (Postgres table)

Represents a single backtest run from submission through terminal state.

### Drizzle Schema

```ts
// orchestrator/api/src/db/schema.ts
import {
  pgTable, uuid, text, jsonb, timestamp, check
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const backtests = pgTable('backtests', {
  id:           uuid('id').primaryKey().defaultRandom(),
  status:       text('status').notNull().default('pending'),
  config:       jsonb('config').notNull().$type<BacktestConfig>(),
  summary:      jsonb('summary').$type<PnlSummary | null>(),
  trades:       jsonb('trades').$type<TradeEvent[] | null>(),
  safetyOrders: jsonb('safety_orders').$type<SafetyOrder[] | null>(),
  errorMessage: text('error_message'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('backtests_status_check',
    sql`${t.status} IN ('pending','running','completed','failed')`),
]);
```

### Field Descriptions

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | UUID PK | No | Auto-generated UUID v4, returned as `job_id` in 202 response |
| `status` | TEXT (CHECK) | No | Lifecycle state: `pending` → `running` → `completed` \| `failed`. Default: `pending` |
| `config` | JSONB | No | Full `ApiBacktestRequest` payload as submitted by the user |
| `summary` | JSONB | Yes | `PnlSummary` object returned by Go engine (null until `completed`) |
| `trades` | JSONB | Yes | Array of `TradeEvent` objects (null until `completed`) |
| `safety_orders` | JSONB | Yes | Array of safety-order sub-events per trade (null until `completed`) |
| `error_message` | TEXT | Yes | Captured stderr from the Go engine process (null unless `failed`) |
| `created_at` | TIMESTAMPTZ | No | Submission timestamp. Used for ORDER BY in list queries |
| `updated_at` | TIMESTAMPTZ | No | Last status change timestamp |

### Status State Machine

```
[POST /backtest] → pending
                     │
        BackgroundWorker.tick() claims job
                     ↓
                  running
                   / \
              exit 0  exit ≠ 0 or JSON parse error
                 /       \
           completed     failed
```

### List vs Single Result SELECT

**List endpoint** (`GET /backtests`) — excludes heavy JSONB columns:
```ts
const { trades, safetyOrders, ...listCols } = getTableColumns(backtests);
// listCols: id, status, config, summary, errorMessage, createdAt, updatedAt
```

**Single result endpoint** (`GET /backtests/:id`) — full row:
```ts
const row = await db.select().from(backtests).where(eq(backtests.id, id)).limit(1);
```

---

## Entity 2: `market_data_syncs` (Postgres table)

Represents a completed download of 1-minute OHLCV market data for a specific trading symbol. Used by `GapResolver` to determine whether a requested date range is already covered before initiating ClickHouse queries.

### Drizzle Schema

```ts
export const marketDataSyncs = pgTable('market_data_syncs', {
  id:         uuid('id').primaryKey().defaultRandom(),
  symbol:     text('symbol').notNull(),
  startDate:  timestamp('start_date', { withTimezone: true }).notNull(),
  endDate:    timestamp('end_date', { withTimezone: true }).notNull(),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

### Field Descriptions

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | UUID PK | No | Auto-generated UUID v4 |
| `symbol` | TEXT | No | Normalized trading symbol, e.g. `BTCUSDC` (slash-stripped, uppercase) |
| `start_date` | TIMESTAMPTZ | No | Timestamp of the first candle in the downloaded range |
| `end_date` | TIMESTAMPTZ | No | Timestamp of the **actual last downloaded candle** (NOT the user's configured backtest `end_date`; NOT `Date.now()`). Updated by `BinanceDownloader` after each successful download. |
| `created_at` | TIMESTAMPTZ | No | When this sync record was first created |
| `updated_at` | TIMESTAMPTZ | No | When this sync record was last modified |

### `end_date` Invariant

> **CRITICAL**: `end_date` MUST always equal the `open_timestamp` of the last successfully downloaded and stored candle. It is tracked in `BinanceDownloader` by updating `lastCandleTs` on every pagination page. This ensures that `GapResolver` can reliably determine whether a future request's end falls within the already-synced window.

### Gap Resolver Query Pattern

```ts
// Check if [requestedStart, requestedEnd] is fully covered
const [covered] = await db
  .select({ id: marketDataSyncs.id })
  .from(marketDataSyncs)
  .where(and(
    eq(marketDataSyncs.symbol, symbol),
    lte(marketDataSyncs.startDate, requestedStart),
    gte(marketDataSyncs.endDate, requestedEnd),
  ))
  .limit(1);

if (covered) return { hasGap: false }; // skip ClickHouse
```

---

## Entity 3: `BacktestConfig` (TypeScript type)

The JSON payload stored in `backtests.config`. Matches the existing `ApiBacktestRequest` interface verbatim.

```ts
// Same shape as the existing ApiBacktestRequest in src/types/configuration.ts
export type BacktestConfig = {
  trading_pair: string;
  start_date: string;
  end_date: string;
  price_entry: string;
  price_scale: string;
  amount_scale: string;
  number_of_orders: number;
  amount_per_trade: string;
  margin_type: 'cross' | 'isolated';
  multiplier: number;
  take_profit_distance_percent: string;
  account_balance: string;
  exit_on_last_order: boolean;
};
```

---

## Entity 4: `PnlSummary` (TypeScript type)

The JSON payload stored in `backtests.summary`. Shape produced by the Go engine's `ResultAggregator`.

```ts
export type PnlSummary = {
  total_pnl: string;           // decimal string
  roi_percent: string;         // decimal string
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  max_drawdown: string;        // decimal string
  total_fees: string;          // decimal string
  execution_time_ms: number;
};
```

---

## Entity 5: `BacktestJobRow` (TypeScript type — list projection)

The TypeScript type returned by the list endpoint — the `backtests` table row with `trades` and `safetyOrders` columns omitted.

```ts
export type BacktestJobRow = Omit<typeof backtests.$inferSelect, 'trades' | 'safetyOrders'>;
```

---

## Database Migrations

Migrations are stored in `orchestrator/api/drizzle/` and generated by `npx drizzle-kit generate`. Applied at startup via `migrate()` before `app.listen()`.

```
orchestrator/api/drizzle/
├── 0001_create_backtests.sql          # backtests table + status CHECK
└── 0002_create_market_data_syncs.sql  # market_data_syncs table
```

### `drizzle.config.ts`

```ts
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
```
