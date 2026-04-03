# Data Model: ClickHouse Batch Promotion & Time-in-Market KPIs

**Branch**: `018-clickhouse-batch-promotion` | **Date**: 2026-04-02

## PostgreSQL Changes (Drizzle ORM)

### `sweep_run_summaries` — Extended

Adds three columns to the existing table from spec 017:

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `longest_trade_duration_ms` | `BIGINT` | No | `0` | Max position hold time in milliseconds. Open-at-end positions use `last_candle_ts - entry_ts`. |
| `max_safety_orders_used` | `INTEGER` | No | `0` | Deepest safety order rung triggered across all positions in the run. |
| `promoted_at` | `TIMESTAMPTZ` | Yes | `NULL` | Set when wide events for this run are successfully inserted into ClickHouse. `NULL` = never promoted. Drives the Leaderboard badge. |

**Index**: `(session_id, promoted_at)` — enables fast filtering of "all promoted runs for a session" during batch duplicate guard resolution.

### No Changes To

- `sweep_sessions` — unchanged
- All other existing tables — unchanged

---

## ClickHouse Changes

### `sweep_wide_events` — New Table

```sql
CREATE TABLE IF NOT EXISTS sweep_wide_events (
    session_id              UUID,
    run_id                  UUID,
    schema_version          UInt8,
    trade_id                String,
    timestamp               DateTime64(3, 'UTC'),
    event_type              LowCardinality(String),
    symbol                  LowCardinality(String),
    candle_open             Decimal64(8),
    candle_high             Decimal64(8),
    candle_low              Decimal64(8),
    candle_close            Decimal64(8),
    candle_volume           Decimal64(8),
    running_account_balance Decimal64(8),
    global_candle_count     UInt64,
    position_state          LowCardinality(String),
    average_entry_price     Decimal64(8),
    position_quantity       Decimal64(8),
    total_capital_deployed  Decimal64(8),
    fees_accumulated        Decimal64(8),
    take_profit_price       Decimal64(8),
    liquidation_price       Decimal64(8),
    filled_orders_count     UInt32,
    unrealized_pnl          Decimal64(8),
    current_drawdown_pct    Decimal64(8),
    action_price            Decimal64(8),
    action_quantity         Decimal64(8),
    action_fee              Decimal64(8),
    order_number            UInt32
) ENGINE = MergeTree()
PARTITION BY session_id
ORDER BY (session_id, run_id, timestamp);
```

**Design Notes**:
- `session_id` and `run_id` use ClickHouse `UUID` type — 16-byte fixed-width, faster than String for indexing and partitioning.
- `event_type` and `symbol` use `LowCardinality(String)` — cardinality is small and fixed, this halves storage for these columns.
- `PARTITION BY session_id` enables `DROP PARTITION` for instant zero-scan deletion on session removal.
- `ORDER BY (session_id, run_id, timestamp)` — primary key. Optimal for Grafana queries that filter on `session_id` and `run_id` and scan chronologically.
- Engine: `MergeTree` (not `ReplacingMergeTree`) — duplicate prevention uses pre-deletion strategy (see D-003).

---

## Go Engine Result Payload — Extended

Two new integer fields added to `BatchRunResultOutput`:

```go
LongestTradeDurationMs int64 `json:"longest_trade_duration_ms"`
MaxSafetyOrdersUsed    int   `json:"max_safety_orders_used"`
```

New config field for stdout-streaming wide events in batch promotion mode:

```go
WideEventsToStdout *bool `json:"wide_events_to_stdout,omitempty"`
```

When `wide_events_to_stdout = true`, each wide event is emitted as a JSON line with a type discriminator:
```json
{"type":"wide_event","run_id":"<uuid>","schema_version":1,"trade_id":"...","timestamp":"...","event_type":"ENTRY",...}
```

---

## API Entities

### `BatchPromotionRequest`
```typescript
interface BatchPromotionRequest {
  run_ids: string[];  // max 200; session_id from URL param
}
```

### `BatchPromotionStatus` (transient, in-memory)
```typescript
interface BatchPromotionStatus {
  session_id: string;
  total: number;
  completed: number;
  failed: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
}
```

### SSE Events (Promotion Stream)
```typescript
// Progress
{ type: 'promotion_progress', completed: number, total: number }
// Per-run failure (non-blocking)
{ type: 'promotion_error', run_id: string, error: string }
// Terminal
{ type: 'promotion_complete', completed: number, failed: number }
{ type: 'promotion_cancelled', completed: number, total: number }
```
