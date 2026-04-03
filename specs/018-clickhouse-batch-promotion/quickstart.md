# Quickstart: ClickHouse Batch Promotion & Time-in-Market KPIs

**Branch**: `018-clickhouse-batch-promotion` | **Date**: 2026-04-02

## Prerequisites

- Spec 017 (Pro Optimizer Workspace) fully implemented and merged
- ClickHouse running (docker-compose service from spec 008)
- Go engine buildable: `cd core-engine && go build -o ../orchestrator/api/core-engine.exe ./cmd/engine/`
- Node.js API running: `cd orchestrator/api && npm run dev`

## Step 1 — Apply ClickHouse DDL

```sql
-- Run against the ClickHouse instance
CREATE TABLE IF NOT EXISTS sweep_wide_events (
    session_id UUID, run_id UUID,
    schema_version UInt8, trade_id String,
    timestamp DateTime64(3, 'UTC'),
    event_type LowCardinality(String), symbol LowCardinality(String),
    candle_open Decimal64(8), candle_high Decimal64(8),
    candle_low Decimal64(8), candle_close Decimal64(8), candle_volume Decimal64(8),
    running_account_balance Decimal64(8), global_candle_count UInt64,
    position_state LowCardinality(String), average_entry_price Decimal64(8),
    position_quantity Decimal64(8), total_capital_deployed Decimal64(8),
    fees_accumulated Decimal64(8), take_profit_price Decimal64(8),
    liquidation_price Decimal64(8), filled_orders_count UInt32,
    unrealized_pnl Decimal64(8), current_drawdown_pct Decimal64(8),
    action_price Decimal64(8), action_quantity Decimal64(8),
    action_fee Decimal64(8), order_number UInt32
) ENGINE = MergeTree()
PARTITION BY session_id
ORDER BY (session_id, run_id, timestamp);
```

## Step 2 — Apply Postgres Migration

```bash
cd orchestrator/api && npx drizzle-kit push
```

The migration adds `longest_trade_duration_ms`, `max_safety_orders_used`, and `promoted_at` to `sweep_run_summaries`.

## Step 3 — Rebuild Go Engine

```bash
cd core-engine
go build -o ../orchestrator/api/core-engine.exe ./cmd/engine/
```

## Step 4 — Restart API

```bash
cd orchestrator/api && npm run dev
```

## Step 5 — Manual Smoke Test

```bash
# 1. Run a sweep and get a session_id from the history list
# 2. Promote 2 runs:
curl -X POST http://localhost:3000/optimizer/session/<sessionId>/promote \
  -H 'Content-Type: application/json' \
  -d '{"run_ids":["run-uuid-1","run-uuid-2"]}'

# 3. Verify ClickHouse insertion:
curl "http://localhost:8123?query=SELECT%20count()%20FROM%20data.sweep_wide_events%20WHERE%20session_id%20%3D%20'<sessionId>'&user=admin&password=admin"

# 4. Verify promoted_at set in Postgres:
# Use Drizzle Studio or psql:
# SELECT run_id, promoted_at FROM sweep_run_summaries WHERE session_id = '<sessionId>';
```
