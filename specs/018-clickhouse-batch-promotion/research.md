# Research: ClickHouse Batch Promotion & Time-in-Market KPIs

**Branch**: `018-clickhouse-batch-promotion` | **Date**: 2026-04-02

## Decision Log

### D-001: ClickHouse Client (Node.js)

**Decision**: Reuse the existing `@clickhouse/client` singleton (`ClickHouseClient.ts`).  
**Rationale**: Already used for market data inserts. Shared HTTP client is stateless and safe under concurrent use.  
**Alternatives considered**: A native TCP client (`@clickhouse/client-node`) — unnecessary overhead for this use case.

---

### D-002: Wide Event Insertion Approach

**Decision**: Node.js intercepts Go engine stdout, buffers events, and bulk-inserts into ClickHouse. 1,000-row minimum batch; flush-on-exit for final partial buffer.  
**Rationale**: Go engine already knows nothing about ClickHouse authentication in the batch sweep path. Consistent with spec 008 architecture where Node.js owns all ClickHouse writes.  
**Pattern reference**: Mirrors `ClickHouseWriter.insertBatch()` used for OHLCV data.

---

### D-003: ClickHouse Pre-Deletion for Duplicate Guard (Bulk IN Clause)

**Decision**: A single `ALTER TABLE sweep_wide_events DELETE WHERE session_id = '<id>' AND run_id IN ('id-1', 'id-2', ...)` before insertion. NOT a per-run loop.  
**Rationale**: ClickHouse Mutations (`ALTER TABLE ... DELETE`) are heavy background processes that rewrite data parts. Running 200 individual mutations for a 200-config re-promotion will queue 200 background operations and choke ClickHouse. Grouping all previously-promoted `run_id`s into a single `IN (...)` clause reduces this to exactly one mutation — regardless of how many runs are being re-promoted.  
**Implementation note**: The Node.js promotion handler MUST: (1) query Postgres for which `run_id`s in the batch have non-null `promoted_at`; (2) if any exist, issue exactly ONE `ALTER TABLE ... DELETE WHERE session_id = ? AND run_id IN (...)` bulk mutation; (3) then proceed with engine execution and ClickHouse inserts.

---

### D-004: Promotion Progress via SSE

**Decision**: SSE stream on `POST /optimizer/session/:sessionId/promote`. Same pattern as `POST /session/:sessionId/execute`.  
**Rationale**: Already implemented and understood by the frontend `useOptimizer` hook. Avoids adding a polling endpoint. SSE is one-way and closes cleanly when the promotion completes.  
**Event schema**: `{ "type": "promotion_progress", "completed": N, "total": M }` and `{ "type": "promotion_complete" }` and `{ "type": "promotion_error", "run_id": "...", "error": "..." }`.

---

### D-005: Wide Event Schema — Reuse Existing `WideEvent` Struct

**Decision**: Reuse the existing `WideEvent` Go struct (`application/orchestrator/wide_event.go`) verbatim. No new fields needed beyond the existing `run_id` field already present on the struct.  
**Finding**: `WideEvent.RunID` (field `run_id`) already exists in the struct. The engine already emits `run_id` on every wide event when writing to a `.jsonl` file. The Node.js side just needs to read this field from the emitted JSON lines.  
**Caveat**: Wide events are currently written to a temporary `.jsonl` file and the file path is returned in the result payload (`WideEventFile`). For batch promotion, the Go engine needs to emit wide events **directly to stdout** as JSON lines (not to a file). This requires a new CLI flag or config field to switch the wide event output destination from file to stdout.

---

### D-006: Go Engine — Wide Events to Stdout (New Mode for Batch Promotion)

**Decision**: Add a new field `wide_events_to_stdout: true` to the `EngineRequest` config struct. When set, the engine writes wide events to `os.Stdout` as JSON lines with a `"type": "wide_event"` discriminator field. Result summary is also emitted normally at the end.  
**Rationale**: Current batch mode writes wide events to a temp file. Stdout streaming is preferred for the batch promotion path because it avoids filesystem I/O, disk cleanup, and file-path passing between processes.  
**Format emitted**: `{"type":"wide_event", "run_id":"...", ...WideEvent fields...}\n`

---

### D-007: ClickHouse `sweep_wide_events` DDL

**Decision**: `MergeTree` engine, `PARTITION BY session_id`, `ORDER BY (session_id, run_id, timestamp)`.  
**UUID fields**: `session_id UUID` and `run_id UUID`. ClickHouse natively supports `UUID` type — 16 bytes fixed-width, significantly faster than String for indexing.  
**Full DDL**:
```sql
CREATE TABLE IF NOT EXISTS sweep_wide_events (
    session_id    UUID,
    run_id        UUID,
    schema_version UInt8,
    trade_id      String,
    timestamp     DateTime64(3, 'UTC'),
    event_type    LowCardinality(String),
    symbol        LowCardinality(String),
    candle_open   Decimal64(8),
    candle_high   Decimal64(8),
    candle_low    Decimal64(8),
    candle_close  Decimal64(8),
    candle_volume Decimal64(8),
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

---

### D-008: PostgreSQL Schema Additions

**Decision**: Two Drizzle ORM migrations needed.  
**Migration 1 — `sweep_run_summaries` additions**:
```sql
ALTER TABLE sweep_run_summaries
  ADD COLUMN longest_trade_duration_ms BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN max_safety_orders_used    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN promoted_at               TIMESTAMPTZ;
```
**Migration 2 — Index**: Index on `(session_id, promoted_at)` for efficient filtering of promoted rows.

---

### D-009: Go Engine — Time-in-Market KPIs

**Decision**: Compute both KPIs in the existing `position` domain package by tracking per-position entry timestamp and safety order count.  
**`longest_trade_duration_ms`**: Computed by maintaining a running max. At position close, compute `closeMs - entryMs`. At backtest end, for any still-open positions compute `lastCandleMs - entryMs`. Take the max across all.  
**`max_safety_orders_used`**: Track the count of safety orders filled per position. At position close (or backtest end), compare with running max.  
**Output field**: Added to the existing `BatchRunResultOutput` struct (alongside `roi`, `maxDrawdown`, etc.).

---

### D-010: Playwright MCP Testing Strategy

**Decision**: End-to-end tests via Playwright MCP tools will cover the full promotion workflow in a running dev environment (orchestrator + Go engine + ClickHouse + Grafana all running via docker-compose).  
**DB direct verification**: ClickHouse via `curl http://localhost:8123?query=SELECT...` in test teardown. Postgres via `psql` or Drizzle Studio.  
**Test scenarios**: (1) Select rows → promote → verify ClickHouse count; (2) re-promote → verify no-double-insert; (3) delete session → verify partition drop; (4) Grafana dropdown populates correctly.
