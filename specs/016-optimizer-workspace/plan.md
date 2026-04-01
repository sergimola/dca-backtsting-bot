# Implementation Plan: Optimizer Workspace (Parameter Sweep & High-Concurrency Execution)

**Branch**: `016-optimizer-workspace` | **Date**: 2026-04-01 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/016-optimizer-workspace/spec.md`

## Summary

Build a dedicated Optimizer Workspace that allows combinatorial parameter sweeps over the existing DCA backtest engine. The feature spans four architectural layers:

1. **Go Engine (Pre-Flight)**: New `--preflight` / `--batch-preflight` flags backed by the existing `domain/config` sequences API. Zero new math code — reuse `ComputePriceSequence` and `ComputeAmountSequence` with a normalized $100 entry.
2. **Go Engine (Batch Execution)**: New `--batch-config` flag that groups configs by `(symbol, start_date, end_date)`, queries ClickHouse once per group, caches `[]Candle` in RAM, then executes all runs concurrently via a `runtime.NumCPU()` worker pool. Each worker has a completely fresh `Orchestrator` + `PositionStateMachine`; only the read-only candle slice is shared.
3. **Node.js API**: New `SweepService` with O(k) combination-count check, Cartesian product expansion, batch-Pre-Flight pruning, and SSE streaming of batch results.
4. **Frontend**: New `OptimizerPage` with Fixed/Sweep Configurator (left panel) and three right-panel states: Pre-Flight Visualizer (idle), Execution Dashboard (running), Quant Matrix (complete).

## Technical Context

**Language/Version**: Go 1.22 (core engine) · TypeScript 5.x + Node.js 20 (orchestrator API) · TypeScript 5.x + React 18 (frontend)
**Primary Dependencies**: shopspring/decimal (Go fixed-point) · Express 4 (API) · Vite + Tailwind CSS (frontend) · Headless UI (popovers)
**Storage**: ClickHouse (candle data — read-only in this feature) · In-memory only for sweep results (FR-034; no DB writes for optimizer runs)
**Testing**: `go test` + `go test -race` (Go) · Jest 29 (Node.js/React)
**Target Platform**: Local developer machine (Windows/Linux/macOS); same CI environment as existing features
**Project Type**: Full-stack feature extension (CLI + REST API + Single-Page App)
**Performance Goals**: 100+ runs/minute for a 6-month 1-minute-resolution dataset on 8-core hardware (SC-007) · O(k) combination count (k = number of swept params) · Pre-Flight Visualizer updates ≤2s after param change
**Constraints**: No new DB schema or migrations (in-memory results only) · No new Go module dependencies · Hard cap of 10,000 combinations before allocation · Must pass `go test -race ./...` with zero data races
**Scale/Scope**: Up to 10,000 sweep combinations · Up to 8 concurrent Go workers · SSE stream to a single frontend consumer per session

## Constitution Check

*Status: PASS — no violations.*

| Gate | How this feature satisfies it |
|------|-------------------------------|
| **Simulation-only / No live trading** | Optimizer is a parameter-sweep tool over the existing backtest engine. No live exchange calls. No new I/O paths that could reach a broker. |
| **Green Light Protocol** | All existing `go test ./...` and `npx jest` must remain green before any work begins. All new code ships with TDD unit tests. No merge permitted with failing tests. |
| **Fixed-point arithmetic** | Pre-Flight ladder math uses `decimal.Decimal` (shopspring) throughout in Go. `ComputePreFlight` wraps existing `ComputePriceSequence`/`ComputeAmountSequence` — both proven correct against canonical test vectors (spec §Canonical Test Data). Node.js uses `decimal.js` only for Range step expansion (presentation math; not monetary). No monetary re-computation in Node.js or React. |
| **BDD acceptance criteria** | All 8 user stories have Given/When/Then scenarios. Key invariants covered: 1 ClickHouse query per (symbol, date) group (US1-1); fixed-point determinism (US2-2); Cartesian cardinality match (US3-1); pruning counts (US3-3); race-free concurrency (US1-7). |
| **Architecture / Ports-and-Adapters** | Pre-Flight math lives in `domain/config/preflight.go` (pure domain, zero I/O). Batch execution lives in `application/orchestrator/batch.go` (uses existing ClickHouse adapter). API routes live in `orchestrator/api/src/routes/optimizer.routes.ts`. No domain logic in API or UI layers. |
| **Gap-Down / Execution Rules** | Batch mode runs the identical `Orchestrator.RunBacktest` path as single-run. No changes to candle-evaluation order or fill logic. |

**Post-design re-evaluation**: No new violations introduced. The `CandleGroup` / `LoadAll()` addition to `clickhouse_loader.go` is an adapter concern (infrastructure layer) — compliant.

## Project Structure

### Documentation (this feature)

```text
specs/016-optimizer-workspace/
├── plan.md             ← This file
├── spec.md
├── research.md         ← Phase 0: 7 research decisions
├── data-model.md       ← Phase 1: entity schemas for all 3 layers
├── quickstart.md       ← Phase 1: setup + verification commands
├── contracts/
│   ├── go-engine-cli.md    ← CLI flag contract (3 modes)
│   └── nodejs-api.md       ← HTTP endpoint contract (4 endpoints)
└── tasks.md            ← Phase 2 output (created by /speckit.tasks)
```

### Source Code Changes

```text
core-engine/
├── domain/config/
│   ├── preflight.go             NEW — ComputePreFlight(), PreFlightResult, PreFlightLadderEntry
│   └── preflight_test.go        NEW — TDD, canonical test vectors from spec
├── application/orchestrator/
│   ├── batch.go                 NEW — CandleGroup, runBatchBacktest, worker pool
│   ├── batch_test.go            NEW — grouping logic, race-detector clean
│   └── clickhouse_loader.go     MODIFY — export Candle struct, add LoadAll()
└── cmd/engine/
    ├── main.go                  MODIFY — flag dispatch: --preflight, --batch-preflight, --batch-config
    └── preflight_types.go       NEW — BatchJobConfig, BatchResultPayload (batch-level types only; PreFlightResult and PreFlightLadderEntry live in domain/config/preflight.go)

orchestrator/api/src/
├── routes/
│   └── optimizer.routes.ts      NEW — 4 endpoints (count, sweep, execute, cancel)
├── services/
│   ├── SweepService.ts          NEW — Cartesian, O(k) check, batch-preflight invocation, pruning
│   ├── SweepService.test.ts     NEW — unit tests
│   ├── OptimizerSessionStore.ts NEW — in-memory Map<sessionId, OptimizerSession>
│   └── OptimizerService.integration.test.ts  NEW
└── types/
    └── optimizer.ts             NEW — TypeScript interfaces (data-model)

frontend/src/
├── pages/
│   └── OptimizerPage.tsx        NEW — top-level page (25%/75% split layout)
├── hooks/
│   └── useOptimizer.ts          NEW — session state machine + SSE consumer
├── components/
│   ├── LeftSidebar.tsx          MODIFY — add Optimizer nav item
│   └── optimizer/
│       ├── OptimizerConfigurator.tsx    NEW
│       ├── SweepParameterField.tsx      NEW
│       ├── CombinatorialFooter.tsx      NEW
│       ├── PreFlightVisualizer.tsx      NEW
│       ├── ExecutionDashboard.tsx       NEW
│       ├── QuantMatrix.tsx              NEW
│       ├── HeatmapGrid.tsx              NEW
│       └── LeaderboardGrid.tsx          NEW
└── __tests__/components/optimizer/     NEW — Jest tests per component
```

## Complexity Tracking

No constitution violations. No complexity justification required.

---

## Implementation Phases

> **Phase ordering note**: This plan sequences Pre-Flight (Phase 1) before Batch Execution (Phase 2) to align with the dependency chain (US3 Pruning requires Pre-Flight). In `tasks.md`, US1 (Batch Execution) is Phase 3 and US2 (Pre-Flight) is Phase 4; this is equally valid because US1 and US2 are independent and can develop in parallel. Both orderings converge at US3.

### Phase 1 — Go Engine: Pre-Flight Math

**Scope**: `domain/config/` + `cmd/engine/main.go` (flag dispatch only). Zero ClickHouse I/O. Fully unit-testable in isolation.

**Objective**: Implement the `--preflight` and `--batch-preflight` CLI modes so Node.js can invoke them for Smart Pruning.

#### 1.1 — `domain/config/preflight.go`

**New file.** Contains:

```go
// PreFlightLadderEntry captures one rung of the DCA safety-order ladder.
type PreFlightLadderEntry struct {
    Level           int             `json:"level"`
    TriggerPricePct decimal.Decimal `json:"trigger_price_pct"`
    TriggerPrice    decimal.Decimal `json:"trigger_price"`
    OrderSize       decimal.Decimal `json:"order_size"`
    CumulativeCost  decimal.Decimal `json:"cumulative_cost"`
}

// PreFlightResult is the output of ComputePreFlight.
type PreFlightResult struct {
    RunID                 string               `json:"run_id"`
    MaxDrawdownCoveredPct decimal.Decimal      `json:"max_drawdown_covered_pct"`
    TotalCapitalRequired  decimal.Decimal      `json:"total_capital_required"`
    Ladder                []PreFlightLadderEntry `json:"ladder"`
}

// ComputePreFlight calculates the DCA ladder assuming a normalized $100 entry.
// Uses ComputePriceSequence and ComputeAmountSequence — no I/O.
// All arithmetic: decimal.Decimal (ROUND_HALF_UP, 8dp). Deterministic.
func ComputePreFlight(cfg *Config) (*PreFlightResult, error)
```

**Algorithm**:
1. `entry = decimal.NewFromInt(100)` (normalized)
2. `prices = cfg.ComputePriceSequence(entry)` → P_0…P_{N-1}
3. `amounts = cfg.ComputeAmountSequence(cfg.AmountPerTrade())` → A_0…A_{N-1}
4. Build `[]PreFlightLadderEntry`: level, `triggerPricePct = (P_i - P_0) / P_0 * 100`, cumulative sum
5. `MaxDrawdownCoveredPct = ladder[N-1].TriggerPricePct` (deepest rung; 0 if N=0)
6. `TotalCapitalRequired = cumulative cost at last rung`

**Binding test vectors** (`preflight_test.go`, from spec §Canonical Test Data):

| Input | Field | Expected |
|-------|-------|----------|
| price_entry=1.5, price_scale=1.5, amount_scale=2.0, N=3, amount_per_trade=200 | SO1 trigger_price_pct | `-1.50000000` |
| (continued) | SO2 trigger_price_pct | `-3.75000000` |
| (continued) | SO3 trigger_price_pct | `-7.12500000` |
| (continued) | total_capital_required | `1500.00000000` |
| (continued) | max_drawdown_covered_pct | `-7.12500000` |
| N=0 | total_capital_required | `100.00000000` |
| N=0 | max_drawdown_covered_pct | `0.00000000` |

#### 1.2 — `cmd/engine/main.go` — Flag Dispatch

Add `--preflight` (bool) and `--batch-preflight` (string, file path) flags. Routing before the existing stdin-decode path:

```go
preflight      := flag.Bool("preflight", false, "Run Pre-Flight math and exit")
batchPreflight := flag.String("batch-preflight", "", "Path to batch-preflight input JSON file")
batchConfig    := flag.String("batch-config", "", "Path to batch backtest config JSON file")
flag.Parse()

switch {
case *preflight:
    runPreFlight()          // reads stdin, writes stdout, exits
case *batchPreflight != "":
    runBatchPreFlight(*batchPreflight)  // reads file, writes stdout, exits
case *batchConfig != "":
    runBatchBacktest(*batchConfig)      // Phase 2
default:
    runSingleBacktest()     // existing path
}
```

**Deliverables**: `preflight.go`, `preflight_test.go`, `preflight_types.go`, updated `main.go` dispatch.

**Definition of Done**:
- [ ] `go test ./domain/config/... -run TestPreFlight` passes with all canonical vectors (2 test configs: N=3 with 5 field assertions, N=0 with 2 field assertions)
- [ ] `--preflight` flag emits correct JSON on stdout, no ClickHouse connection attempted
- [ ] `--batch-preflight` processes 5-element input file, returns matching 5-element result array
- [ ] `go test -race ./...` reports zero data races

---

### Phase 2 — Go Engine: Batch Execution & Worker Pool

**Scope**: `application/orchestrator/` (new `batch.go`) and `clickhouse_loader.go` (add `Candle` export + `LoadAll`). Requires ClickHouse running locally for integration tests.

**Objective**: Accept `--batch-config`, group configs, query once per group, execute concurrently with isolated workers, stream tagged results to stdout.

#### 2.1 — Export `Candle` struct + `LoadAll()` method

**Modify** `clickhouse_loader.go`:

```go
// Candle is the exported domain type for a single OHLCV bar.
// The loader previously used an anonymous struct; this formalizes it for batch sharing.
type Candle struct {
    Timestamp time.Time
    Open      decimal.Decimal
    High      decimal.Decimal
    Low       decimal.Decimal
    Close     decimal.Decimal
    Volume    decimal.Decimal
}

// LoadAll materializes all candles for the configured symbol/date range into a slice.
// Used by batch mode to create the shared read-only candle cache.
func (l *ClickHouseCandleLoader) LoadAll() ([]Candle, error)
```

#### 2.2 — `application/orchestrator/batch.go`

**New file.** Key types and functions:

```go
// groupKey is the deduplication key for the ClickHouse candle cache.
type groupKey struct {
    Symbol    string
    StartDate string
    EndDate   string
}

// candleCache maps a groupKey to its materialized []Candle slice.
// Populated sequentially before the worker pool starts (no concurrent writes).
type candleCache map[groupKey][]Candle

// BatchJob is the unit of work dispatched to a worker goroutine.
type BatchJob struct {
    Config  BatchJobConfig
    Candles []Candle   // read-only slice from cache; shared by reference (no mutex needed)
}

// runBatchBacktest is the main entry point for --batch-config mode.
// 1. Reads and parses the JSON file.
// 2. Groups configs by (symbol, startDate, endDate).
// 3. For each group: opens ClickHouseCandleLoader, calls LoadAll(), stores in cache.
// 4. Dispatches BatchJob entries to a runtime.NumCPU()-sized worker pool.
// 5. A single result-writer goroutine serializes worker output to stdout (no concurrent stdout writes).
// 6. Emits final batch_summary line.
func runBatchBacktest(filePath string, logLevel string, wideEventDir string) error

// runSingleBatchRun executes one backtest with a fresh Orchestrator + PSM.
// IMPORTANT: Orchestrator and PositionStateMachine are stack-local per call.
// job.Candles is passed as a value (slice header copy; underlying array shared read-only).
func runSingleBatchRun(job BatchJob) BatchResultPayload
```

**Worker pool implementation**:
```go
numWorkers := runtime.NumCPU()
jobs    := make(chan BatchJob, len(configs))
results := make(chan BatchResultPayload, len(configs))

var wg sync.WaitGroup
for i := 0; i < numWorkers; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for job := range jobs {
            results <- runSingleBatchRun(job)
        }
    }()
}

// Feed all jobs
for _, job := range allJobs { jobs <- job }
close(jobs)

// Single result-writer goroutine (serializes stdout)
go func() {
    enc := json.NewEncoder(os.Stdout)
    for result := range results {
        _ = enc.Encode(result)
    }
}()

wg.Wait()
close(results)
```

**Candle sharing**: `job.Candles` is a slice header copy. Both the original slice in `candleCache` and the worker's copy point to the same underlying array. Workers only read (no append, no index writes) → zero data races.

**stdout safety**: Only one goroutine (result-writer) calls `enc.Encode` → no concurrent stdout writes.

#### 2.3 — `batch_test.go`

Test coverage:
- **Grouping test**: 5 configs with 2 distinct (symbol, date) groups → exactly 2 `LoadAll()` calls (mock ClickHouse loader).
- **Concurrent execution test**: 10 configs, run pool, verify all 10 results arrive, no goroutine leaks.
- **Race detector test**: same 10-config run with `-race` → zero races.
- **Cross-contamination test**: 2 configs with different `safety_order_size` → each result's `tradeEvents` reflects its own config, not the other's.
- **Error isolation test**: 1 config with invalid params → error result emitted; remaining 9 configs complete successfully.

**Deliverables**: `batch.go`, `batch_test.go`, updated `clickhouse_loader.go`, updated `main.go` dispatch.

**Definition of Done**:
- [ ] `./core-engine.exe --batch-config <2-config-same-symbol-file>` emits 2 result lines + 1 batch_summary with exactly 1 ClickHouse query (verified via query counter mock)
- [ ] `go test -race ./application/orchestrator/... -run TestBatch` passes with zero races
- [ ] Worker pool size = `runtime.NumCPU()` verified in test
- [ ] Error-run isolation test passes (9/10 complete when 1 fails)

---

### Phase 3 — Node.js API: Combinatorics & Pruning

**Scope**: `orchestrator/api/src/` — new service, new routes, new TypeScript types. Requires Phase 1 (batch-preflight binary).

**Objective**: Provide three HTTP endpoints — sweep count (lightweight), full sweep validation (Cartesian + Pre-Flight pruning), and SSE execution streaming.

#### 3.1 — `types/optimizer.ts`

All TypeScript interfaces from the data-model: `SweepParameter`, `SweepRange`, `SweepDefinition`, `GeneratedConfig`, `PruningResult`, `PruneReason`, `SweepCountResponse`, `OptimizerSession`, `BatchRunResult`, `SweepPhase`.

#### 3.2 — `services/SweepService.ts`

**Key methods**:

```typescript
class SweepService {
  // O(k) size check. Returns count; throws SweepLimitExceededError if > MAX_COMBINATIONS (10_000).
  calculateCombinationCount(parameters: SweepParameter[]): number

  // Expands ranges to value lists using decimal.js for float-safe step arithmetic.
  expandRangeToValues(range: SweepRange): string[]

  // Builds full Cartesian product. Only called if count <= MAX_COMBINATIONS.
  // Time: O(N * k) where N = combo count, k = params. Memory: ~N * k * 16 bytes.
  buildCartesianProduct(symbol: string, fixedParams: FixedParams, sweepParams: SweepParameter[]): GeneratedConfig[]

  // Writes configs to a temp JSON file, spawns Go --batch-preflight, parses results.
  // Returns map of run_id → PreFlightResult.
  invokeBatchPreFlight(configs: GeneratedConfig[]): Promise<Map<string, PreFlightSummary>>

  // Filters configs against exchange rules (base_order < $10) and account balance.
  pruneConfigs(configs: GeneratedConfig[], preFlightMap: Map<string, PreFlightSummary>, accountBalance: string): PruningResult
}
```

**Range expansion** (using `decimal.js` for step safety):
```typescript
import Decimal from 'decimal.js';

expandRangeToValues({ start, end, step }: SweepRange): string[] {
  const s = new Decimal(start), e = new Decimal(end), st = new Decimal(step);
  if (st.lte(0)) throw new ValidationError('step must be > 0');
  if (s.gt(e))   throw new ValidationError('start must be <= end');
  const values: string[] = [];
  for (let v = s; v.lte(e); v = v.plus(st)) {
    values.push(v.toFixed(8));
  }
  return values;
}
```

**Cartesian product** (iterative reduce, no stack risk):
```typescript
function cartesian<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap(combo => arr.map(val => [...combo, val])),
    [[]]
  );
}
```

#### 3.3 — `services/OptimizerSessionStore.ts`

**In-memory registry** (Map-based, no DB):
```typescript
class OptimizerSessionStore {
  private sessions = new Map<string, OptimizerSession>();
  create(session: OptimizerSession): void
  get(sessionId: string): OptimizerSession | undefined
  update(sessionId: string, patch: Partial<OptimizerSession>): void
  delete(sessionId: string): void
}
```

Sessions survive only for the Node.js process lifetime (FR-034 — ephemeral workspace).

#### 3.4 — `routes/optimizer.routes.ts`

Four routes mounting on `/optimizer`:

| Route | Handler |
|-------|---------|
| `POST /sweep/count` | `calculateCombinationCount` → lightweight count only |
| `POST /sweep` | Full expand + batch-preflight + pruning → returns `SweepResponse` |
| `POST /session/:sessionId/execute` | Spawns `--batch-config`, SSE-streams results |
| `DELETE /session/:sessionId` | Cancels engine process, marks session cancelled |

**SSE streaming pattern** (reuses BacktestService readline):
```typescript
// Set SSE headers
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');

const proc = spawn(binaryPath, ['--batch-config', tempFile]);
const rl = createInterface({ input: proc.stdout! });
rl.on('line', (line) => {
  res.write(`data: ${line}\n\n`);
});
proc.on('close', () => {
  session.store.update(sessionId, { phase: 'complete', completedAt: new Date() });
  res.end();
});

// Store process ref for cancellation
session.store.update(sessionId, { engineProcess: proc, phase: 'running' });
```

**Cancellation**:
```typescript
// DELETE /session/:sessionId
const session = store.get(sessionId);
if (session?.engineProcess) {
  session.engineProcess.kill('SIGTERM');
  store.update(sessionId, { phase: 'cancelled', cancelledAt: new Date() });
}
```

#### 3.5 — Tests

**`SweepService.test.ts`** (unit, no binary required):
- `calculateCombinationCount`: 3×2 = 6 ✓; 10,001 → throws 400
- `expandRangeToValues`: 1.0→2.0 step 0.5 → [1.0,1.5,2.0]; float-safe
- `buildCartesianProduct`: 3×2 → 6 distinct configs with unique run_ids
- `pruneConfigs`: 100 configs, 15 capital-exceed, 5 base-order-below → pruned=20, valid=80

**`SweepService.integration.test.ts`** (requires compiled binary):
- `invokeBatchPreFlight` with 3 known configs → returns correct `max_drawdown_covered_pct`

**Deliverables**: `optimizer.ts`, `SweepService.ts`, `SweepService.test.ts`, `OptimizerSessionStore.ts`, `optimizer.routes.ts`, integration test.

**Definition of Done**:
- [ ] `POST /optimizer/sweep/count` returns 6 for 3×2 sweep
- [ ] `POST /optimizer/sweep/count` returns 400 for sweep producing 15,000 combinations
- [ ] `POST /optimizer/sweep` returns correct pruning summary (canonical US3-3 scenario)
- [ ] `POST /session/:id/execute` SSE-streams all run results
- [ ] `DELETE /session/:id` terminates engine and closes SSE connection
- [ ] All unit tests pass; integration test skipped when binary absent

---

### Phase 4 — Frontend: Optimizer UI

**Scope**: `frontend/src/` — new page, hooks, and 8 new components. Modifies `LeftSidebar.tsx` and `App.tsx`.

**Objective**: Deliver the full Optimizer Workspace UI: Configurator (left panel) + three right-panel states.

#### 4.1 — Routing & Layout (`OptimizerPage.tsx`)

```tsx
// App.tsx: add route
<Route path="/optimizer" element={<OptimizerPage />} />

// OptimizerPage.tsx: 25/75 split
<div className="flex h-screen">
  <div className="w-1/4 min-w-[300px] border-r flex flex-col flex-shrink-0">
    <OptimizerConfigurator session={session} onLaunch={launch} onCancel={cancel} />
  </div>
  <div className="flex-1 overflow-hidden">
    {phase === 'idle'      && <PreFlightVisualizer sweepSummary={sweepSummary} />}
    {phase === 'running'   && <ExecutionDashboard session={session} onCancel={cancel} />}
    {phase === 'complete'  && <QuantMatrix session={session} />}
    {phase === 'cancelled' && <QuantMatrix session={session} isCancelled />}
  </div>
</div>
```

#### 4.2 — `useOptimizer.ts` (Session State Machine)

```typescript
interface UseOptimizerReturn {
  formState: OptimizerFormState;
  updateField: (name: string, patch: Partial<ParameterField>) => void;
  sweepCounts: SweepCountResponse | null;  // live from POST /sweep/count
  phase: SweepPhase;
  session: OptimizerSession | null;
  launch: () => Promise<void>;    // POST /sweep then POST /execute (SSE)
  cancel: () => Promise<void>;    // DELETE /session/:id
  openInSingleRun: (result: BatchRunResult) => void;  // navigates to / with params
}
```

**SSE consumption**:
```typescript
// Inside launch():
const eventSource = new EventSource(`/optimizer/session/${sessionId}/execute`, { method: 'POST' });
// or use fetch with ReadableStream for POST SSE (EventSource is GET-only):
const response = await fetch(`/optimizer/session/${sessionId}/execute`, { method: 'POST' });
const reader = response.body!.getReader();
// pump lines → parse JSON → dispatch to session state
```

**Combinatorial footer debounce**: `POST /sweep/count` is called with 300ms debounce after any form field change to avoid server spam.

#### 4.3 — `OptimizerConfigurator.tsx` + `SweepParameterField.tsx`

Each parameter row:
```tsx
// SweepParameterField.tsx
<div className="flex items-center gap-2">
  <label>{param.label}</label>
  <ToggleGroup value={field.mode} onChange={setMode}>
    <ToggleGroup.Option value="fixed">Fixed</ToggleGroup.Option>
    <ToggleGroup.Option value="sweep">Sweep</ToggleGroup.Option>
  </ToggleGroup>
  {field.mode === 'fixed'
    ? <input value={field.fixedValue} onChange={...} />
    : <>
        <input value={field.listInput} placeholder="1.0, 1.5, 2.0" onChange={...} />
        <RangePopover range={field.range} onChange={setRange} />
      </>
  }
</div>
```

**Range Popover**: uses Headless UI `Popover`. Inputs: Start, End, Step. On confirm: `expandRangeToValues(range)` → join with ", " → fills `listInput`.

**JSON Import/Export**: textarea modal; paste raw JSON → `Object.entries(json)` → fill each matching `ParameterField`. Export: serialize current form state to JSON → copy to clipboard.

**Quick Dates** (YTD / Last 6M / Last 30D):
```typescript
const quickDates = {
  ytd:      { start: `${new Date().getFullYear()}-01-01T00:00:00Z`, end: todayISO },
  last6m:   { start: subMonths(new Date(), 6).toISOString(), end: todayISO },
  last30d:  { start: subDays(new Date(), 30).toISOString(), end: todayISO },
};
```
Uses `date-fns` (already in project dependencies).

#### 4.4 — `CombinatorialFooter.tsx`

```tsx
<div className="sticky bottom-0 border-t bg-surface p-3 flex items-center justify-between">
  <span className="text-sm text-muted">
    Generated: <strong>{counts?.generated ?? 0}</strong>
    {' | '}Pruned: <strong className="text-red-500">{counts?.pruned ?? 0}</strong>
    {' | '}Valid Runs: <strong className="text-green-500">{counts?.valid ?? 0}</strong>
    {counts?.overLimit && <span className="text-red-600 ml-2">⚠ Limit exceeded</span>}
  </span>
  <button
    disabled={!counts?.valid || counts.overLimit}
    onClick={onLaunch}
    className="btn-primary disabled:opacity-40"
  >
    Launch Sweep
  </button>
</div>
```

#### 4.5 — `PreFlightVisualizer.tsx` (Idle State)

Uses the existing `SafetyOrderChart.tsx` as a base. Receives `sweepSummary: { minDrawdown, maxDrawdown, maxCapital }` computed client-side from `POST /sweep` pre-flight results.

Renders:
- A mock/static candlestick chart as background (reuses existing charting component)
- Two overlaid horizontal zones (SVG or CSS): one at `minDrawdown%` below entry, one at `maxDrawdown%` — colored as a gradient band ("Heatmap Zone")
- Text readouts: `"Max Drawdown Covered: {minDrawdown}% to {maxDrawdown}%"` and `"Max Capital Required: ${maxCapital}"`

#### 4.6 — `ExecutionDashboard.tsx` (Running State)

```tsx
<div className="p-6 flex flex-col gap-4">
  <MasterProgressBar completed={session.completedRuns} total={session.totalRuns} />
  <LeaderboardGrid results={session.results} sweptParams={sweptParamNames} sortable />
  <button onClick={onCancel} className="btn-danger self-end">Cancel Sweep</button>
</div>
```

`MasterProgressBar`: standard `<progress>` or Tailwind div with `width: N%` + text `"{completed} / {total} Runs Completed ({pct}%)`.

#### 4.7 — `QuantMatrix.tsx` (Complete State)

Two sub-views controlled by a tab or condition:

**Heatmap tab** (only shown when exactly 2 swept variables):
```tsx
<HeatmapGrid
  xAxis={{ name: 'price_scale', values: xValues }}
  yAxis={{ name: 'take_profit_distance_percent', values: yValues }}
  cells={heatmapCells}  // BatchRunResult[] indexed by (xi, yi)
  metric="roi"
/>
```

For 3+ swept variables: axis selector dropdowns above the grid.

**`HeatmapGrid.tsx`**:
```tsx
// Pure SVG 2D grid
// Color interpolation: roi < 0 → red (hsl(0, 80%, 45%)); roi = max → green (hsl(120, 70%, 40%))
// linear interpolation: hue = 0 + (120 - 0) * (roi - minRoi) / (maxRoi - minRoi)
```

**Leaderboard tab**:
```tsx
<LeaderboardGrid
  results={session.results}
  sweptParams={sweptParamNames}   // these columns get highlighted bg
  rowActions={[openInSingleRun, saveAsPreset, copyConfigJSON]}
  exportCSV
/>
```

#### 4.8 — `LeaderboardGrid.tsx`

Standard sortable table. Sort state: `{ column: string; direction: 'asc' | 'desc' }`. 

Column highlighting: swept parameter columns receive `class="bg-yellow-50 font-medium"` or similar.

Row actions:
- **Open in Single Run**: `navigate('/', { state: { prefillConfig: result.config } })` → existing `ConfigFormView.tsx` reads `location.state` to pre-fill (small modification required to `ConfigFormView.tsx`).
- **Save as Preset**: `POST /presets` with the config (uses existing presets API if it exists; otherwise a `localStorage` fallback).
- **Copy Config JSON**: `navigator.clipboard.writeText(JSON.stringify(result.config, null, 2))`.

**CSV Export** (FR-033):
```typescript
import Papa from 'papaparse';  // already in project
const csv = Papa.unparse(results.map(r => ({ ...r.sweptValues, ...flattenPnl(r.pnlSummary) })));
downloadBlob(csv, 'optimizer-sweep-results.csv', 'text/csv');
```

#### 4.9 — Tests (`__tests__/components/optimizer/`)

Each component has a corresponding Jest/RTL test. Key coverage:
- `SweepParameterField`: toggle switches mode; Range popover fills list input
- `CombinatorialFooter`: disabled when valid=0; enabled when valid>0 and not overLimit
- `HeatmapGrid`: renders N×M cells; correct color assignment for min/max roi
- `LeaderboardGrid`: sorts by column click; row actions call correct handlers
- `useOptimizer`: state transitions idle→running→complete; cancel transitions running→cancelled

**Deliverables**: All 8 new components, `useOptimizer.ts`, `OptimizerPage.tsx`, updated `LeftSidebar.tsx`, `App.tsx`, test files.

**Definition of Done**:
- [ ] `/optimizer` route renders without errors
- [ ] Fixed/Sweep toggle works for all 7 sweepable parameters
- [ ] Footer shows correct counts matching `POST /sweep/count` after debounce
- [ ] Launch → right panel transitions to Execution Dashboard
- [ ] Leaderboard populates live as SSE lines arrive
- [ ] Complete → Quant Matrix renders with Heatmap (2-variable case) and sortable Leaderboard
- [ ] "Open in Single Run" navigates with correct param state
- [ ] "Export CSV" downloads a valid CSV file
- [ ] Cancel terminates sweep and shows partial results
- [ ] All component tests pass

---

## Cross-Phase Integration Test Scenarios

After all 4 phases, run these end-to-end verification scenarios to confirm spec acceptance criteria:

| Scenario | Steps | Expected |
|----------|-------|----------|
| **SC-001** I/O Elimination | 10 configs, same symbol/date | Exactly 1 ClickHouse query (batch_test.go mock counter) |
| **SC-004** Pruning correctness | Sweep with 100 configs, 20 violating constraints | Footer: Valid=80; `pruningResult.pruned=20` |
| **SC-006** Context switching | Click "Open in Single Run" on top Leaderboard row | Single Run page pre-fills with exact parameter values |
| **US1-7** Race-free | `go test -race ./... ` | Zero data race reports |
| **US3-8** Explosion guard | Sweep with 5 params × 7 values = 16,807 | HTTP 400 returned before any allocation |

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| `LoadAll()` materializes >1GB for a multi-year dataset | OOM in batch mode | Document memory estimate (e.g., 500k candles × 6 decimal.Decimal at 16B each ≈ 48MB/group — acceptable). Warn in logs if >100k candles per group. |
| SSE connection dropped mid-sweep | Results lost in frontend | `useOptimizer` maintains results in component state — already received lines are preserved on reconnect (no server-side message buffering needed for MVP). |
| Cartesian expansion to exactly 10,000 entries | Slow preflight if all require Go invocation | Batch Pre-Flight is a single Go process spawn — 10k Pre-Flight calculations in pure math takes <1s in Go. |
| `date-fns` or `decimal.js` not in npm lockfile | Build failure | Check `package.json` before implementation; add to `devDependencies` if absent. |
| "Save as Preset" requires existing presets API | Blocked on other features | Fallback: `localStorage` preset store for MVP. |
