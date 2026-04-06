# Quickstart: Engine Stop-Loss Mechanism

**Feature**: 019-engine-stop-loss  
**Date**: April 3, 2026

---

## Prerequisites

- Go 1.22+ (in PATH, `go version`)
- Node.js 20+ (in PATH, `node --version`)
- ClickHouse running on `localhost:18123` (HTTP) / `localhost:9000` (native TCP)
- PostgreSQL running with Drizzle migrations applied
- Frontend devserver (optional, for UI changes)

---

## Development Setup

```powershell
# Clone / switch to feature branch
cd "D:\personal\bot-dca\dca-bot\DCA Backtesting bot"
git checkout 019-engine-stop-loss

# Build the Go engine
cd core-engine
go build -o "../orchestrator/api/core-engine.exe" ./cmd/engine/
```

---

## Running Go Engine Tests

```powershell
cd "D:\personal\bot-dca\dca-bot\DCA Backtesting bot\core-engine"

# All tests (Green Light Protocol check — must be all green before any changes)
go test ./...

# Stop-loss specific tests only
go test ./domain/position/... -run "TestStopLoss" -v

# Config tests (includes new SL validation)
go test ./domain/config/... -v

# Aggregator tests
go test ./cmd/engine/... -v

# With race detector
go test -race ./...
```

---

## Running a Manual Stop-Loss Backtest

Create a JSON request file (e.g., `test-sl.json`):

```json
{
  "trading_pair": "BTC/USDC",
  "start_date": "2025-01-01T00:00:00Z",
  "end_date": "2026-01-01T00:00:00Z",
  "price_entry": "2.0",
  "price_scale": "1.1",
  "amount_scale": "2.0",
  "number_of_orders": 10,
  "amount_per_trade": "1000",
  "margin_type": "cross",
  "multiplier": 1,
  "take_profit_distance_percent": "1.0",
  "account_balance": "10000",
  "monthly_addition": "0",
  "exit_on_last_order": false,
  "clickhouse_addr": "localhost:9000",
  "clickhouse_db": "data",
  "clickhouse_user": "admin",
  "clickhouse_password": "admin",
  "stop_loss_enabled": true,
  "stop_loss_percent": "5",
  "stop_loss_baseline": "average_entries",
  "stop_loss_timeout_minutes": 60
}
```

```powershell
cd "D:\personal\bot-dca\dca-bot\DCA Backtesting bot\core-engine"
Get-Content "..\test-sl.json" | ..\orchestrator\api\core-engine.exe
```

Expected result payload will include `total_stops_triggered` and `total_take_profits`.

---

## Running the Drizzle Migration

```powershell
cd "D:\personal\bot-dca\dca-bot\DCA Backtesting bot\orchestrator\api"
npm run db:migrate
```

Verify the new column was added:
```powershell
# Using psql or any Postgres client
# SELECT column_name FROM information_schema.columns WHERE table_name = 'sweep_run_summaries';
```

---

## Running TypeScript/API Tests

```powershell
cd "D:\personal\bot-dca\dca-bot\DCA Backtesting bot\orchestrator\api"
npm test -- --testPathPattern="stop_loss|sweep"
```

---

## Running Frontend Tests

```powershell
cd "D:\personal\bot-dca\dca-bot\DCA Backtesting bot\frontend"
npx jest --testPathPatterns="StopLoss|Configurator|LeaderboardGrid" --no-coverage
```

---

## Canonical Test Case (Copy-Paste Verification)

Use this to verify the SL trigger calculation is correct:

- Entry price: `$100.00`
- SL percent: `5`
- Expected trigger (`first_entry`): `$95.00000000`
- Expected trigger after SO1 fill (avg_entry=$97.00, `average_entries`): `$92.15000000`

If the engine test for these produces different values, there is a precision or logic bug.

---

## Key Files to Modify

```
core-engine/
  domain/config/config.go                    ← 4 new fields, validation, options, JSON
  domain/position/position.go                ← 6 new SL fields on Position struct
  domain/position/events.go                  ← StopLossExecutedEvent
  domain/position/minute_loop.go             ← Step 3c.5 SL check; exitOnLastOrder guard
  domain/position/stop_loss_test.go          ← NEW: BDD unit tests
  cmd/engine/main.go                         ← EngineRequest + EngineResultPayload
  cmd/engine/aggregator.go                   ← SL count + win rate

orchestrator/api/
  src/db/schema.ts                           ← totalStopsTriggered column
  drizzle/0005_019_stop_loss_kpis.sql        ← NEW migration
  src/services/SweepPersistenceService.ts    ← map total_stops_triggered from result
  src/types/index.ts                         ← SL fields in ApiSweepRunConfig, EngineResultLine

frontend/src/
  components/OptimizerConfigurator.tsx       ← 4 SL parameter fields
  components/LeaderboardGrid.tsx             ← total_stops_triggered column
```
