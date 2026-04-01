# Quickstart: Optimizer Workspace (016)

**Branch**: `016-optimizer-workspace` | **Date**: 2026-04-01

---

## Developer Setup Checklist

Before working on this feature, confirm the following are operational:

- [ ] ClickHouse running locally (`localhost:9000`) with `dca_bot` database populated
- [ ] `core-engine.exe` builds successfully: `cd core-engine && go build -o ../orchestrator/api/core-engine.exe ./cmd/engine/`
- [ ] Node.js API runs without errors: `cd orchestrator/api && npm run dev`
- [ ] Frontend dev server runs: `cd frontend && npm run dev`
- [ ] All existing tests pass: `cd core-engine && go test ./...` and `cd orchestrator/api && npx jest --no-coverage`

---

## Phase 1: Go Pre-Flight Math

### What gets built
New `--preflight` and `--batch-preflight` flags in `cmd/engine/main.go`, backed by a new `domain/config/preflight.go` function.

### Key files

| File | Action |
|------|--------|
| `core-engine/domain/config/preflight.go` | **New**: `ComputePreFlight(cfg *Config) *PreFlightResult` |
| `core-engine/domain/config/preflight_test.go` | **New**: TDD unit tests (canonical data from spec §Canonical Test Data) |
| `core-engine/cmd/engine/main.go` | **Modify**: add `--preflight` / `--batch-preflight` flag dispatch |
| `core-engine/cmd/engine/preflight_types.go` | **New**: `PreFlightResult`, `PreFlightLadderEntry` structs |

### How `ComputePreFlight` works

```go
// Normalized $100 entry — all ladder math relative to this entry price
const normalizedEntry = "100"

func ComputePreFlight(cfg *Config) (*PreFlightResult, error) {
    entry, _ := decimal.NewFromString(normalizedEntry)
    prices, err := cfg.ComputePriceSequence(entry)     // reuses sequences.go
    if err != nil { return nil, err }
    amounts, err := cfg.ComputeAmountSequence(cfg.AmountPerTrade()) // absolute mode
    if err != nil { return nil, err }

    ladder := make([]PreFlightLadderEntry, cfg.NumberOfOrders())
    cumulative := decimal.Zero
    for i := 0; i < cfg.NumberOfOrders(); i++ {
        cumulative = cumulative.Add(amounts[i])
        pct := prices[i].Sub(entry).Div(entry).Mul(decimal.NewFromInt(100)).Round(8)
        ladder[i] = PreFlightLadderEntry{
            Level:          i + 1,
            TriggerPricePct: pct,
            TriggerPrice:   prices[i],
            OrderSize:      amounts[i],
            CumulativeCost: cumulative,
        }
    }
    maxDD := decimal.Zero
    if len(ladder) > 0 { maxDD = ladder[len(ladder)-1].TriggerPricePct }
    return &PreFlightResult{
        MaxDrawdownCoveredPct: maxDD,
        TotalCapitalRequired:  cumulative,
        Ladder:               ladder,
    }, nil
}
```

### Test the Pre-Flight binary
```sh
# Build
cd core-engine && go build -o ../orchestrator/api/core-engine.exe ./cmd/engine/

# Single Pre-Flight (canonical test case from spec)
echo '{"trading_pair":"BTCUSDC","price_entry":"1.5","price_scale":"1.5","amount_scale":"2.0","number_of_orders":3,"amount_per_trade":"200","multiplier":1,"take_profit_distance_percent":"0.5","account_balance":"10000","start_date":"2025-01-01T00:00:00Z","end_date":"2025-06-30T00:00:00Z","clickhouse_addr":"","clickhouse_db":"","clickhouse_user":"","clickhouse_password":""}' | ./orchestrator/api/core-engine.exe --preflight

# Expected: max_drawdown_covered_pct="-7.12500000", total_capital_required="1500.00000000"
```

---

## Phase 2: Go Batch Execution

### What gets built
New `--batch-config` execution path in `main.go`. New `LoadAll()` method on candle loader. New `runBatchBacktest` function.

### Key files

| File | Action |
|------|--------|
| `core-engine/application/orchestrator/clickhouse_loader.go` | **Modify**: add `Candle` struct (exported) + `LoadAll() ([]Candle, error)` |
| `core-engine/application/orchestrator/batch.go` | **New**: `GroupConfig`, `CandleGroup`, `runBatchBacktest`, worker pool |
| `core-engine/cmd/engine/main.go` | **Modify**: add `--batch-config` flag dispatch → calls `runBatchBacktest` |
| `core-engine/application/orchestrator/batch_test.go` | **New**: table-driven tests; grouping logic; race-detector clean |

### Run tests with race detector
```sh
cd core-engine && go test -race ./application/orchestrator/... && go test -race ./cmd/...
```

### Verify batch execution
```sh
# Create a minimal batch config
$batchJson = '[
  {"run_id":"run-001","trading_pair":"BTCUSDC","start_date":"2025-01-01T00:00:00Z","end_date":"2025-01-07T00:00:00Z","price_entry":"2.0","price_scale":"1.1","amount_scale":"2.0","number_of_orders":5,"amount_per_trade":"200","multiplier":1,"take_profit_distance_percent":"0.5","account_balance":"10000","clickhouse_addr":"localhost:9000","clickhouse_db":"dca_bot","clickhouse_user":"default","clickhouse_password":"","exit_on_last_order":false},
  {"run_id":"run-002","trading_pair":"BTCUSDC","start_date":"2025-01-01T00:00:00Z","end_date":"2025-01-07T00:00:00Z","price_entry":"2.0","price_scale":"1.5","amount_scale":"2.0","number_of_orders":5,"amount_per_trade":"200","multiplier":1,"take_profit_distance_percent":"0.5","account_balance":"10000","clickhouse_addr":"localhost:9000","clickhouse_db":"dca_bot","clickhouse_user":"default","clickhouse_password":"","exit_on_last_order":false}
]'
$batchJson | Out-File -Encoding utf8 /tmp/batch.json

.\orchestrator\api\core-engine.exe --batch-config /tmp/batch.json
# Expect: 2 result lines (tagged run-001, run-002) + 1 batch_summary line
# Expect: exactly 1 ClickHouse query (both configs share same symbol/dates)
```

---

## Phase 3: Node.js Combinatorics & Pruning

### What gets built
Three new route files and a `SweepService` class.

### Key files

| File | Action |
|------|--------|
| `orchestrator/api/src/services/SweepService.ts` | **New**: Cartesian expansion, batch preflight invocation, pruning logic |
| `orchestrator/api/src/services/OptimizerSessionStore.ts` | **New**: In-memory session registry (Map<sessionId, OptimizerSession>) |
| `orchestrator/api/src/routes/optimizer.routes.ts` | **New**: 4 endpoints (count, sweep, execute, cancel) |
| `orchestrator/api/src/types/optimizer.ts` | **New**: TypeScript interfaces from data-model |
| `orchestrator/api/src/services/SweepService.test.ts` | **New**: unit tests — Cartesian, O(k) check, pruning |
| `orchestrator/api/src/services/OptimizerService.integration.test.ts` | **New**: integration test with real batch-preflight binary |

### Test the sweep API
```sh
cd orchestrator/api && npm run dev   # Start in another terminal

# Test combinatorial count
curl -X POST http://localhost:3000/optimizer/sweep/count \
  -H "Content-Type: application/json" \
  -d '{"accountBalance":"10000","parameters":[{"name":"price_scale","mode":"list","listValues":["1.0","1.5","2.0"]},{"name":"take_profit_distance_percent","mode":"list","listValues":["0.5","1.0"]}]}'
# Expect: {"generated":6,"pruned":0,"valid":6,"overLimit":false}

# Test over-limit rejection
curl -X POST http://localhost:3000/optimizer/sweep/count \
  -H "Content-Type: application/json" \
  -d '{"accountBalance":"10000","parameters":[{"name":"price_scale","mode":"range","range":{"start":"1.0","end":"100.0","step":"0.01"}}]}'
# Expect: 400 {"error":"combination_limit_exceeded","count":9901,"limit":10000}
```

---

## Phase 4: Frontend Optimizer UI

### What gets built
New `OptimizerPage` with `useOptimizer` hook, Configurator, Pre-Flight Visualizer, Execution Dashboard, and Quant Matrix.

### Key files

| File | Action |
|------|--------|
| `frontend/src/pages/OptimizerPage.tsx` | **New**: Top-level page with Left/Right split panel |
| `frontend/src/hooks/useOptimizer.ts` | **New**: Session state machine, SSE consumer, cancellation |
| `frontend/src/components/optimizer/OptimizerConfigurator.tsx` | **New**: Left panel with Fixed/Sweep toggles |
| `frontend/src/components/optimizer/SweepParameterField.tsx` | **New**: Parameter row with toggle + input + Range popover |
| `frontend/src/components/optimizer/CombinatorialFooter.tsx` | **New**: Sticky footer with live counts + Launch button |
| `frontend/src/components/optimizer/PreFlightVisualizer.tsx` | **New**: Right panel idle state (heatmap zone chart) |
| `frontend/src/components/optimizer/ExecutionDashboard.tsx` | **New**: Right panel running state (progress bar + leaderboard) |
| `frontend/src/components/optimizer/QuantMatrix.tsx` | **New**: Right panel complete state (heatmap + data grid) |
| `frontend/src/components/optimizer/HeatmapGrid.tsx` | **New**: 2D SVG heatmap cell grid |
| `frontend/src/components/optimizer/LeaderboardGrid.tsx` | **New**: Sortable results table with row actions |
| `frontend/src/components/LeftSidebar.tsx` | **Modify**: Add "Optimizer" nav item |
| `frontend/src/__tests__/components/optimizer/` | **New**: Jest tests for each component |

### Add sidebar route
```tsx
// In LeftSidebar.tsx — add alongside existing nav items
<NavItem to="/optimizer" icon={<ChartIcon />} label="Optimizer" />
```

```tsx
// In App.tsx routes
<Route path="/optimizer" element={<OptimizerPage />} />
```

### Verify the UI end-to-end
1. Start API with `npm run dev` and frontend with `npm run dev`
2. Navigate to `http://localhost:5173/optimizer`
3. Toggle `price_scale` to Sweep mode, enter `1.0, 1.5, 2.0`
4. Toggle `take_profit_distance_percent` to Sweep mode, enter `0.5, 1.0`
5. Observe footer: `Generated: 6 | Pruned: 0 | Valid Runs: 6`
6. Click "Launch Sweep" — observe right panel transition to Execution Dashboard
7. Verify all 6 runs appear in Leaderboard sorted by PnL
8. After completion, verify Heatmap (2× 3 grid) renders with colored cells
9. Click "Open in Single Run" on top row — verify Single Run page pre-fills

---

## Acceptance Criteria Verification

Run these to confirm all spec acceptance criteria are satisfied:

```sh
# Go Pre-Flight (spec canonical test case from §Canonical Test Data)
cd core-engine && go test ./domain/config/... -run TestPreFlight -v

# Go batch I/O elimination (SC-001)
cd core-engine && go test ./application/orchestrator/... -run TestBatchCandleGrouping -v

# Go race detector (FR-004)
cd core-engine && go test -race ./... 

# Node.js Cartesian + pruning (US3 scenarios)
cd orchestrator/api && npx jest SweepService --no-coverage --verbose

# Frontend component tests
cd frontend && npx jest optimizer --no-coverage --verbose
```
