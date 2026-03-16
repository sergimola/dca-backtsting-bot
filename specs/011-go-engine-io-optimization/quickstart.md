# Quickstart: Go Engine I/O Optimization

**Feature**: 011-go-engine-io-optimization | **Date**: 2026-03-15

This guide covers how to build, run, and verify the key behaviours introduced by this feature.

---

## Prerequisites

- Go 1.22+ installed
- Node.js 20 LTS + npm
- Docker with Postgres and ClickHouse running (`docker-compose up -d`)
- Existing database migrations applied (`npm run db:migrate`)

---

## Build the Engine with New Flags

```powershell
# From /core-engine
go build -o "../orchestrator/api/core-engine.exe" ./cmd/engine/main.go
```

The binary now accepts two new flags:

| Flag | Default | Description |
|---|---|---|
| `--log-level` | `INFO` | Slog verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `--progress-interval-ms` | `250` | Ticker interval in milliseconds |

---

## Verify Silent Hot Loop (SC-001, SC-006)

Run the engine against a real dataset and confirm no hot-loop output appears on stderr:

```powershell
$config = '{"trading_pair":"BTC/USDT","start_date":"2024-01-01T00:00:00Z","end_date":"2024-12-31T23:59:00Z",...}'
$config | & ".\orchestrator\api\core-engine.exe" --log-level INFO 2>stderr.txt 1>stdout.txt

# Verify stderr is empty (only slog WARN-and-above events if any):
Get-Content .\stderr.txt    # should be empty for a clean run

# Verify stdout contains only progress lines + one result line:
Get-Content .\stdout.txt | ForEach-Object { ($_ | ConvertFrom-Json).type }
# Expected: "progress", "progress", ..., "result"
```

---

## Verify Progress Ticker Output

```powershell
$config = '{"trading_pair":"BTC/USDT",...}'
$config | & ".\orchestrator\api\core-engine.exe" --progress-interval-ms 1000 2>$null |
  Where-Object { ($_ | ConvertFrom-Json).type -eq "progress" } |
  Select-Object -First 3 |
  ForEach-Object { $_ | ConvertFrom-Json | Select-Object type, percent, candles_per_second }
```

Expected output (approximate):
```
type      percent candles_per_second
----      ------- ------------------
progress  12.3    587000
progress  31.7    601000
progress  50.1    594000
```

---

## Verify Final Result Schema

```powershell
$resultLine = Get-Content .\stdout.txt | Select-Object -Last 1
$result = $resultLine | ConvertFrom-Json

# Verify top-level structure:
$result.type                    # "result"
$result.pnlSummary.roi          # e.g., 12.5
$result.pnlSummary.maxDrawdown  # e.g., 4.2
$result.pnlSummary.totalFees    # e.g., 18.3
$result.tradeEvents.Count       # e.g., 480
$result.safetyOrderUsage        # [{ level: "1", count: 42 }, ...]
$result.executionTimeMs         # e.g., 4821
$result.candleCount             # e.g., 331200
```

---

## Verify DEBUG Logging

```powershell
$config = '{"trading_pair":"BTC/USDT",...}'
$config | & ".\orchestrator\api\core-engine.exe" --log-level DEBUG 2>debug.txt 1>$null | Out-Null
# stderr should contain slog text entries:
Select-String -Path .\debug.txt -Pattern "DEBUG"
# Expected: entries like "time=... level=DEBUG msg=FirstCandle symbol=BTCUSDT ..."
```

---

## Run Go Unit Tests

```powershell
# From /core-engine
go test ./... -v -count=1
# All existing tests must pass. New tests cover:
#   - TestProgressTicker_EmitsAtInterval
#   - TestAggregateBacktestEvents_RoiAndFees
#   - TestBuildTradeEvents_MapsCorrectly
#   - TestSafetyOrderUsage_SortedAscending
#   - TestLogLevelFlag_InfoSuppressesDebug
```

---

## Run Orchestrator Tests

```powershell
# From /orchestrator/api
npm test
# All existing tests must pass. New tests cover:
#   - BacktestService readline streaming (progress handler invoked)
#   - BacktestService result line → BacktestExecutionResult mapping
#   - BackgroundWorker progress handler → updateProgress()
#   - BacktestJobRepository updateProgress() writes correct columns
```

---

## Database Migration

```powershell
# From /orchestrator/api — apply new migration adding progress + current_metrics:
npm run db:generate  # generates migration 0002_*.sql
npm run db:migrate   # applies migration

# Verify schema:
# backtests table should now have columns: progress (integer), current_metrics (jsonb)
```

---

## Verify Live Progress in Running Backtest

Start the orchestrator API and submit a multi-year backtest:

```powershell
# Start API in background
npm run dev &

# Submit backtest
$body = @{
  trading_pair = "BTC/USDT"; start_date = "2022-01-01T00:00:00Z"
  end_date = "2024-12-31T23:59:00Z"; price_entry = "50000"
  # ... all required fields
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri http://localhost:3000/backtests -Method POST -Body $body -ContentType "application/json"
$jobId = $response.job_id

# Poll progress
do {
  Start-Sleep -Seconds 1
  $status = Invoke-RestMethod -Uri "http://localhost:3000/backtests/$jobId/status"
  Write-Host "Status: $($status.status) | Progress: $($status.progress)%"
} until ($status.status -in @("completed", "failed"))
```

Expected: `progress` increments from 0 to ~95+ before status becomes `completed`.

---

## Environment Variables for Engine Flags

The BacktestService reads these environment variables to pass flags to the engine binary:

| Env var | Default | Effect |
|---|---|---|
| `ENGINE_LOG_LEVEL` | `INFO` | Sets `--log-level` flag |
| `ENGINE_PROGRESS_INTERVAL_MS` | `250` | Sets `--progress-interval-ms` flag |

Set these in `.env` or `docker-compose.yml` to adjust engine behaviour without code changes.
