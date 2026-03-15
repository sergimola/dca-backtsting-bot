# API Contracts: Postgres Async Architecture

**Branch**: `010-postgres-async-architecture`  
**Generated**: 2026-03-15  
**Source**: spec.md FR-010 through FR-019 + data-model.md

---

## Overview

This document defines the full HTTP API surface exposed by the `orchestrator/api` Node.js service after the async refactor. All existing endpoints are replaced or modified; the synchronous `POST /backtest → 200` contract is superseded by the new `POST /backtest → 202` async contract.

---

## Endpoint 1: `POST /backtest`

### Purpose
Submit a new backtest job. Returns immediately with a job ID. Execution happens asynchronously in the background worker.

### Request

```http
POST /backtest
Content-Type: application/json
```

**Body** — same `ApiBacktestRequest` schema as today (all 13 SDD §4.1 fields), with the `same_month_guard` date range restriction removed:

```jsonc
{
  "trading_pair": "BTC/USDC",
  "start_date": "2021-01-01T00:00:00Z",    // ✅ can span multiple years
  "end_date": "2024-12-31T23:59:59Z",      // ✅ no 1-month limit
  "price_entry": "95000.00",
  "price_scale": "1.05",
  "amount_scale": "1.5",
  "number_of_orders": 10,
  "amount_per_trade": "0.05",
  "margin_type": "cross",
  "multiplier": 1,
  "take_profit_distance_percent": "2.0",
  "account_balance": "10000.00",
  "exit_on_last_order": false
}
```

### Response — `202 Accepted`

Returned immediately after the Postgres INSERT, BEFORE the Go engine is spawned.

```jsonc
{
  "job_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "pending",
  "message": "Backtest job accepted. Poll GET /backtests/{job_id}/status for progress."
}
```

### Response — `400 Bad Request` (validation error)

Same `ValidationError` envelope as today. Triggers on missing/invalid fields.

```jsonc
{
  "error": {
    "code": "VALIDATION_OUT_OF_BOUNDS",
    "http_status": 400,
    "message": "end_date must be >= start_date",
    "timestamp": "2026-03-15T12:00:00.000Z"
  }
}
```

### Response — `503 Service Unavailable` (Postgres unavailable)

```jsonc
{
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "http_status": 503,
    "message": "Unable to persist backtest job. Retry shortly.",
    "timestamp": "2026-03-15T12:00:00.000Z"
  }
}
```

### Constitution Gate: HTTP 202 Detachment

> The HTTP response lifecycle for this endpoint MUST be fully closed before the Go engine process is spawned. No `await` on the engine execution can appear in the request handler. SLO: respond within 500ms.

---

## Endpoint 2: `GET /backtests/:id/status`

### Purpose
Lightweight polling endpoint. Returns only the job lifecycle status. Frontend polls this at ~2s intervals until terminal state.

### Request

```http
GET /backtests/f47ac10b-58cc-4372-a567-0e02b2c3d479/status
```

### Response — `200 OK`

```jsonc
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "running",        // or: pending | completed | failed
  "error_message": null       // populated only when status = 'failed'
}
```

### Response — `404 Not Found`

```jsonc
{
  "error": {
    "code": "NOT_FOUND",
    "http_status": 404,
    "message": "Backtest job not found: f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "timestamp": "2026-03-15T12:00:00.000Z"
  }
}
```

---

## Endpoint 3: `GET /backtests/:id`

### Purpose
Retrieve the full result for a single completed (or failed) backtest job, including the `trades` and `safetyOrders` arrays.

### Request

```http
GET /backtests/f47ac10b-58cc-4372-a567-0e02b2c3d479
```

### Response — `200 OK`

```jsonc
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "completed",
  "config": {
    "trading_pair": "BTC/USDC",
    "start_date": "2021-01-01T00:00:00Z",
    "end_date": "2024-12-31T23:59:59Z"
    // ... all 13 fields
  },
  "summary": {
    "total_pnl": "4821.35000000",
    "roi_percent": "48.21350000",
    "total_trades": 127,
    "winning_trades": 108,
    "losing_trades": 19,
    "max_drawdown": "-1240.00000000",
    "total_fees": "182.44000000",
    "execution_time_ms": 3241
  },
  "trades": [
    // Full TradeEvent[] array — only present here, never in the list endpoint
  ],
  "safety_orders": [
    // Full SafetyOrder[] array
  ],
  "error_message": null,
  "created_at": "2026-03-15T12:00:00.000Z",
  "updated_at": "2026-03-15T12:03:21.000Z"
}
```

### Response — `404 Not Found`

Same envelope as Endpoint 2.

---

## Endpoint 4: `GET /backtests`

### Purpose
List all backtest jobs (all statuses) ordered by submission time descending. Used by the frontend sidebar.

### Constitution Gate: Select Omission

> This endpoint's SELECT query MUST explicitly exclude the `trades` and `safety_orders` JSONB columns. These columns are NEVER present in the list payload. Full result retrieval requires `GET /backtests/:id`.

### Request

```http
GET /backtests
```

### Response — `200 OK`

```jsonc
[
  {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "status": "completed",
    "config": { "trading_pair": "BTC/USDC", "start_date": "...", "end_date": "...", /* ... */ },
    "summary": { "total_pnl": "4821.35000000", "roi_percent": "48.21350000" /* ... */ },
    // ↑ trades and safety_orders are intentionally absent
    "error_message": null,
    "created_at": "2026-03-15T12:00:00.000Z",
    "updated_at": "2026-03-15T12:03:21.000Z"
  },
  {
    "id": "a1b2c3d4-...",
    "status": "pending",
    "config": { /* ... */ },
    "summary": null,
    "error_message": null,
    "created_at": "2026-03-15T12:05:00.000Z",
    "updated_at": "2026-03-15T12:05:00.000Z"
  }
]
```

---

## Endpoint 5: `GET /health` (unchanged)

Existing health endpoint. No changes in this feature.

---

## Internal Contract: `BackgroundWorker` Lifecycle

Not an HTTP endpoint — this is the internal contract between the Express app and the background worker process.

### Startup

`BackgroundWorker.start()` is called in `main.ts` AFTER `await migrate(db, ...)` and BEFORE `app.listen(PORT)`.

### Job Processing Flow

```
tick() fires every 2000ms
  │
  ├─ guard: if (isProcessing) return early — no overlap
  │
  ├─ DB: UPDATE backtests SET status='running' WHERE id=(
  │       SELECT id FROM backtests WHERE status='pending'
  │       ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
  │     ) RETURNING *
  │
  ├─ if no job: do nothing, wait for next tick
  │
  ├─ spawn: child_process.spawn(binaryPath, args)  ← NEVER exec()
  │         stdout: stream chunks into string buffer (no size cap)
  │         stderr: accumulated for error_message
  │
  ├─ on 'close' with exit code 0:
  │    parse stdout as JSON
  │    UPDATE backtests SET status='completed', summary=…, trades=…, safety_orders=… WHERE id=jobId
  │
  ├─ on 'close' with exit code ≠ 0 OR JSON.parse failure:
  │    UPDATE backtests SET status='failed', error_message=stderr WHERE id=jobId
  │
  └─ always: isProcessing = false
```

### Buffer Safety Contract

> `child_process.spawn` MUST be used. The stdout `data` event fires in chunks. The worker assembles them into a string:
> ```ts
> let output = '';
> proc.stdout.on('data', (chunk) => { output += chunk.toString(); });
> ```
> This approach has NO upper bound on output size. `child_process.exec` is FORBIDDEN.

---

## Internal Contract: `GapResolver` Query Order

```
GapResolver.check(symbol, start, end)
  │
  Step 1: Query Postgres market_data_syncs
  │    SELECT id FROM market_data_syncs
  │    WHERE symbol = $1
  │      AND start_date <= $2
  │      AND end_date >= $3
  │    LIMIT 1
  │
  ├─ if row found: return { hasGap: false }  ← NO ClickHouse call made
  │
  Step 2 (only if no Postgres record): COUNT(*) FINAL from ClickHouse
  │    [existing COUNT logic unchanged]
  │
  └─ return { hasGap: true/false, expectedCount, actualCount }
```

> **Constitution Gate — Sync Ledger Priority**: Step 1 (Postgres) MUST execute and resolve before Step 2 (ClickHouse) is ever initiated. Tests must verify that ClickHouse is never called when the Postgres ledger has a covering record.

---

## Removed APIs / Breaking Changes

| Removed Behaviour | Replaced By |
|-------------------|-------------|
| `POST /backtest` responds `200` with full result synchronously | `POST /backtest` responds `202` with `job_id` immediately |
| `GET /backtest/:request_id` (old ID convention) | `GET /backtests/:id` (new Postgres UUID) |
| `GET /backtest?from=…&to=…` (date-range query via ResultStore) | `GET /backtests` (list all, order by created_at desc) |
| `ProcessManager.ts` | `BackgroundWorker.ts` + Postgres status column |
| `ResultStore.ts` (fs + in-memory index) | Postgres `backtests` table |
| `market_data_syncs` in ClickHouse (GapResolver queries) | `market_data_syncs` in Postgres |
