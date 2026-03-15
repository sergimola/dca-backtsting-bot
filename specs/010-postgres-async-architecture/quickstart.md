# Quickstart: Postgres Async Architecture

**Branch**: `010-postgres-async-architecture`  
**Generated**: 2026-03-15

---

## Prerequisites

- Docker Desktop running
- Node.js 18+ installed
- Go 1.21+ installed (for core-engine binary)
- The project checked out on branch `010-postgres-async-architecture`

---

## 1. Start Infrastructure

From the **project root** (`DCA Backtesting bot/`):

```bash
docker-compose up -d
```

This starts three services:
- **ClickHouse** on ports `18123` (HTTP) / `19000` (TCP) — market data storage
- **Postgres** on port `5432` — backtest jobs + sync ledger
- **pgAdmin** on port `5050` — web UI for Postgres inspection

Wait ~10 seconds for Postgres to be ready. Log in to pgAdmin at `http://localhost:5050` with `admin@admin.com` / `admin` to inspect tables after migrations run.

---

## 2. Install New Dependencies

From `orchestrator/api/`:

```bash
npm install drizzle-orm pg
npm install -D drizzle-kit @types/pg
```

---

## 3. Configure Environment Variables

Copy `.env.example` to `.env` in `orchestrator/api/` and fill in:

```dotenv
# Existing ClickHouse config
CLICKHOUSE_HOST=localhost
CLICKHOUSE_HTTP_PORT=18123
CLICKHOUSE_NATIVE_PORT=19000
CLICKHOUSE_DATABASE=data
CLICKHOUSE_USER=admin
CLICKHOUSE_PASSWORD=admin

# New Postgres config
DATABASE_URL=postgresql://dca_user:dca_pass@localhost:5432/dca_bot
PGHOST=localhost
PGPORT=5432
PGUSER=dca_user
PGPASSWORD=dca_pass
PGDATABASE=dca_bot

# Existing engine config
CORE_ENGINE_BINARY_PATH=./core-engine.exe
```

---

## 4. Build the Core Engine

From `core-engine/`:

```bash
go build -o "../orchestrator/api/core-engine.exe" ./cmd/engine/main.go
```

---

## 5. Generate & Apply Migrations

```bash
cd orchestrator/api

# Generate SQL migration files from schema (run once after schema changes)
npx drizzle-kit generate

# Migrations are applied automatically at startup — no manual step needed.
# To apply manually for inspection:
npx drizzle-kit migrate
```

Migration files are committed to the repo under `orchestrator/api/drizzle/`. They are applied by `migrate()` before `app.listen()`.

---

## 6. Start the API

```bash
cd orchestrator/api
npm run dev
```

You should see:

```
[STARTUP] Running Postgres migrations...
[STARTUP] Migrations applied successfully.
[STARTUP] BackgroundWorker started (polling every 2000ms)
[STARTUP] API listening on port 3001
```

The background worker is now polling for `pending` jobs every 2 seconds.

---

## 7. Smoke Test: Submit a Multi-Year Backtest

```bash
curl -X POST http://localhost:3001/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "trading_pair": "BTC/USDC",
    "start_date": "2022-01-01T00:00:00Z",
    "end_date":   "2024-12-31T23:59:59Z",
    "price_entry": "42000.00",
    "price_scale": "1.05",
    "amount_scale": "1.5",
    "number_of_orders": 8,
    "amount_per_trade": "0.05",
    "margin_type": "cross",
    "multiplier": 1,
    "take_profit_distance_percent": "2.0",
    "account_balance": "10000.00",
    "exit_on_last_order": false
  }'
```

**Expected response** (within 500ms):
```jsonc
{
  "job_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "pending",
  "message": "Backtest job accepted. Poll GET /backtests/{job_id}/status for progress."
}
```

Note: a 3-year backtest request would have previously failed with `same_month_guard` validation error. It now succeeds.

---

## 8. Poll for Status

```bash
curl http://localhost:3001/backtests/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx/status
# → { "id": "...", "status": "running", "error_message": null }

# After the engine finishes:
curl http://localhost:3001/backtests/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx/status
# → { "id": "...", "status": "completed", "error_message": null }
```

---

## 9. Retrieve Full Result

```bash
curl http://localhost:3001/backtests/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
# → Full payload with trades[] and safetyOrders[]
```

---

## 10. List All Backtests (Verify Select Omission)

```bash
curl http://localhost:3001/backtests
# → Array of jobs WITHOUT trades or safetyOrders fields
```

---

## 11. Verify No `same_month_guard` Error

```bash
curl -X POST http://localhost:3001/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "trading_pair": "BTC/USDC",
    "start_date": "2020-01-01T00:00:00Z",
    "end_date":   "2025-01-01T00:00:00Z",
    ...
  }'
# Expected: 202 Accepted (NOT 400 same_month_guard)
```

---

## Constitution Gate Verification

| Gate | Manual Verification |
|------|-------------------|
| HTTP 202 Detachment | Submit a request → response arrives within 500ms; Go process PID appears in logs seconds later |
| Select Omission | `GET /backtests` response — use `jq '.[0] | keys'` to verify no `trades` or `safety_orders` key |
| Sync Ledger Priority | Run with ClickHouse offline (stop container) — second request for same symbol still returns 202 (cache hit from Postgres) |
| Buffer Overflow Guard | `grep -r "child_process.exec" orchestrator/api/src/` — should return zero matches |
| File System Eradication | `grep -r "ProcessManager\|ResultStore\|readFileSync" orchestrator/api/src/` — should return zero matches |
| Sync Ledger `end_date` | After download, query pgAdmin: `SELECT end_date FROM market_data_syncs` — should be last candle timestamp, not user's `end_date` |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ECONNREFUSED :5432` on startup | Postgres not running | `docker-compose up -d postgres` |
| `relation "backtests" does not exist` | Migrations not applied | Check startup logs; try `npx drizzle-kit migrate` manually |
| `202` received but job stays `pending` indefinitely | BackgroundWorker not started | Check logs for `BackgroundWorker started` message |
| `failed` status, error_message = `"unexpected end of JSON input"` | Go engine produced no output (binary path wrong or binary not built) | Rebuild Go engine; verify `CORE_ENGINE_BINARY_PATH` in `.env` |
| `400 same_month_guard` still returned | Old `configuration.ts` still has the guard | Confirm the `same_month_guard` block was removed in `validateBacktestRequest()` |
| pgAdmin shows no tables | Migrations failed silently | Run with `NODE_ENV=development` and check console for Drizzle migration errors |
