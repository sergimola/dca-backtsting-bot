# Research: Pro Optimizer Workspace (017)

**Phase**: 0 — Unknowns resolved, decisions made  
**Feature Branch**: `017-pro-optimizer-workspace`

---

## 1. Go Engine — `enable_wide_events` Placement

### Decision
Add `EnableWideEvents *bool` (pointer-to-bool, optional) to `EngineRequest` in `cmd/engine/main.go` with JSON tag `json:"enable_wide_events,omitempty"`. The field defaults to `false` when absent (pointer is nil, dereference with `false`).

`BatchJobConfig` embeds `EngineRequest` — no separate change needed; the field is inherited automatically.

### Rationale
`EngineRequest` is the canonical JSON schema read from stdin and from batch config files. Adding the optional field here satisfies FR-025 and propagates to `BatchJobConfig` via embedding with zero duplication.

### OR Logic Implementation (FR-026)
In `main()` single-run path:
```go
envWideEvents := os.Getenv("ENABLE_WIDE_EVENTS") == "true"
reqWideEvents := request.EnableWideEvents != nil && *request.EnableWideEvents
emitWide := envWideEvents || reqWideEvents
if emitWide && *wideEventDir == "" {
    // Use a default temp directory when no --wide-event-dir provided but flag is true
    *wideEventDir = filepath.Join(os.TempDir(), "dca-wide-events")
}
orchConfig.WideEventOutputDir = *wideEventDir
```
In `runBatchBacktest` batch path: wide events are not used for sweep runs (FR-008 — summary only). The batch path intentionally omits wide events.

### Alternatives Considered
- Adding a new `WideEventsRequest` struct: rejected — unnecessary indirection for a single boolean.
- Environment variable only: rejected — FR-026 requires config-level override.

---

## 2. Win Rate Tracking in Batch Execution

### Decision
In `batch.go`'s `buildBatchResultPayload()`, add counters:
```go
var tpCloses   int
var totalCloses int
```
In the `EventTypePositionClosed` case, check `tce.Reason == "take_profit"` for TP hit (confirmed from `domain/position/events.go` line 82: `Reason string` with values `"take_profit"`, `"liquidation"`, `"end_of_backtest"`).

Emit in batch result payload:
```json
{ "winRate": 0.67, "totalPositionsClosed": 3 }
```
Where `winRate = tpCloses / totalCloses` (float64; `0.0` when `totalCloses == 0` — no panic).

### Rationale
`TradeClosedEvent.Reason` already distinguishes close types. Adding two counters is O(n) over existing event loop with zero overhead.

### Alternatives Considered
- Computing win rate in Node.js: rejected — requires full event stream which is not available after batch execution (only PnL summary is in scope, not individual events).

---

## 3. Batch Streaming to Stdout (FR-017)

### Problem
Current `batch.go`:`ExecuteBatch()` buffers ALL results into a `[]json.RawMessage` slice and returns them all at once. The caller (`runBatchBacktest`) then writes all lines to stdout at the end. This prevents real-time SSE streaming from the Node.js API to the frontend.

### Decision
Change `runBatchBacktest` in `main.go` to write each result directly to stdout via an `io.Writer` as it streams from the result channel, rather than buffering all results. Two approaches:

**Option A (chosen)**: Add a streaming `ExecuteBatchStream` variant to orchestrator package (or expose a channel directly):
```go
// New streaming function — returns results via channel as workers complete
func ExecuteBatchToWriter(jobs []BatchJob, loaderFunc CandleLoaderFunc, workerCount int, out io.Writer)
```
- Each worker writes directly to `out` via a JSON encoder as it finishes
- Mutex-protected since multiple workers share `out`
- Final `batch_summary` line is written after all workers complete

**Option B**: Refactor `runBatchBacktest` to consume the existing `resultCh` channel directly by exporting it — more invasive.

Option A is chosen: adds a new function without breaking the existing `ExecuteBatch` (used in tests).

### Rationale
The Node.js SSE layer (`optimizer.routes.ts`) already handles line-by-line stdout streaming. Once the Go engine emits each result immediately after worker completion, end-to-end streaming works without frontend changes.

### Current State in Spec 016
Spec 016 already required non-blocking streaming (US8) — this research confirms the existing implementation does NOT satisfy FR-017. This is a required fix in this spec.

---

## 4. `capital_efficiency` Computation

### Decision
Compute in Node.js API layer (not in Go engine). The Pre-Flight map is already computed in `POST /optimizer/sweep` and contains `total_capital_required` per config. Store the `preFlightMap` in the `OptimizerSession` object so it's available during execution and persistence.

```typescript
capital_efficiency = new Decimal(roi).div(new Decimal(total_capital_required)).mul(100).toNumber()
```
Divide-by-zero guard: if `total_capital_required === '0'` or absent, store `null`.

### OptimizerSession Change
```typescript
interface OptimizerSession {
  // ... existing fields ...
  preFlightMap: Map<string, PreFlightSummary>  // NEW: for capital_efficiency lookup
}
```

### Rationale
`capital_efficiency` is a derived KPI that requires both the ROI (from execution) and the pre-flight capital (from pre-flight run). Since both are available in the Node.js API layer, computing it there avoids a second Pre-Flight pass in the Go engine.

---

## 5. Drizzle Schema — New Tables

### Decision
Add two new tables to `schema.ts` and create migration `0003_optimizer_sessions.sql`:

```sql
CREATE TABLE "sweep_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trading_pair" text NOT NULL,
  "start_date" text NOT NULL,
  "end_date" text NOT NULL,
  "total_runs" integer NOT NULL DEFAULT 0,
  "max_roi" numeric(10,4),
  "total_execution_time_ms" bigint,
  "status" text NOT NULL DEFAULT 'running',
  "config_snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sweep_sessions_status_check" 
    CHECK (status IN ('running','completed','cancelled'))
);

CREATE TABLE "sweep_run_summaries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES sweep_sessions(id) ON DELETE CASCADE,
  "run_id" text NOT NULL,
  "config_json" jsonb NOT NULL,
  "roi" numeric(10,4),
  "max_drawdown" numeric(10,4),
  "total_fees" numeric(10,4),
  "win_rate" numeric(6,4),
  "capital_efficiency" numeric(10,4),
  "execution_time_ms" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "idx_sweep_run_summaries_session_id" ON "sweep_run_summaries"("session_id");
```

### Rationale
- `ON DELETE CASCADE` on `sweep_run_summaries.session_id` satisfies FR-004b / FR-013 cascade delete requirement.
- `numeric(10,4)` for financial fields: preserves 4 decimal places, prevents float precision loss in PostgreSQL.
- `config_snapshot` on session is the full sweep definition JSON (for future re-run capability).
- `config_json` on summary is the individual run's parameter config (for leaderboard filtering).

### Alternatives Considered
- JSONB for ROI/drawdown fields: rejected — `numeric` columns allow ORDER BY, WHERE comparisons, and aggregates without casting.
- Using the existing `backtests` table for sweep runs: rejected — FR-008 explicitly prohibits persisting trade events, and the existing table schema includes `trades`/`safety_orders` fields at the schema level.

---

## 6. Advanced Pruning Rules — Implementation Location

### Decision
All three advanced prune rules (`guaranteed_fee_loss`, `exceeds_100_percent_drawdown`, `tick_size_violation`) are evaluated in `SweepService.pruneConfigs()` using the Pre-Flight data already available in `preFlightMap`.

```typescript
// Constants
const GUARANTEED_FEE_LOSS_THRESHOLD = new Decimal('0.2')  // fixed per spec
const MIN_TICK_GAP_PCT = new Decimal('0.1')

// guaranteed_fee_loss: take_profit_distance_percent <= 0.2
if (new Decimal(cfg.take_profit_distance_percent).lte(GUARANTEED_FEE_LOSS_THRESHOLD)) {
  prunedConfigs.push({ run_id: cfg.run_id, reason: 'guaranteed_fee_loss', ... })
  continue
}

// exceeds_100_percent_drawdown: pf.max_drawdown_covered_pct <= -100.0
if (pf && new Decimal(pf.max_drawdown_covered_pct).lte(new Decimal('-100'))) {
  prunedConfigs.push({ run_id: cfg.run_id, reason: 'exceeds_100_percent_drawdown', ... })
  continue
}

// tick_size_violation: any consecutive SO gap < 0.1%
if (pf && pf.ladder) {
  const hasTickViolation = pf.ladder.some((_, i) =>
    i > 0 && computeGapPct(pf.ladder[i-1].price, pf.ladder[i].price).lt(MIN_TICK_GAP_PCT)
  )
  if (hasTickViolation) {
    prunedConfigs.push({ run_id: cfg.run_id, reason: 'tick_size_violation', ... })
    continue
  }
}
```

### Rationale
The Pre-Flight ladder (`pf.ladder`) contains all price levels needed for tick size checks. The Pre-Flight data is already available in `preFlightMap` before pruning. No additional engine invocations needed.

The advanced rules use `decimal.js` for all comparisons — no floating-point arithmetic per constitution mandate.

### Pre-Flight Ladder Schema
From `config.ComputePreFlight()` in `domain/config/preflight.go`, the `PreFlightResult` includes `ladder []LadderEntry` where each entry has `price` (string decimal). This is already accessible via `pf.ladder` in the Node.js `PreFlightSummary` type.

### Alternatives Considered
- Adding a separate engine `--check-tick-size` command: rejected — all data is available in existing Pre-Flight output.

---

## 7. Persistence Error → SSE Event → Warning Banner

### Decision
In `optimizer.routes.ts` execute route, wrap each `sweepRepository.persistRunSummary()` call in a try/catch. On failure:
```typescript
res.write(`data: ${JSON.stringify({ type: 'persistence_error', message: err.message })}\n\n`)
```
In `useOptimizer.ts`:
```typescript
if (event.type === 'persistence_error') {
  setPersistenceError(true)
}
```
Banner renders when `persistenceError === true`:
```tsx
{persistenceError && (
  <div className="...warning banner...">
    Warning: Database connection lost. Results are in-memory and will be lost on refresh.
  </div>
)}
```

### Rationale
SSE is already the transport channel for execution events. Adding a dedicated `persistence_error` event type reuses the established infrastructure. The `useOptimizer` hook already processes SSE events by type.

---

## 8. Sweep History API Design

### Decision
Two new GET endpoints + updated DELETE:

```
GET  /optimizer/sessions?page=1&limit=50    → { sessions: SweepHistoryEntry[], total: number, hasMore: boolean }
GET  /optimizer/sessions/:id/results        → { results: SweepRunSummary[] }
DELETE /optimizer/session/:id               → cascade deletes via DB (not just in-memory)
```

History is server-sorted by `created_at DESC`. Client paginates with "Load More" button via `?page=N`.

### Rationale
Simple offset pagination with a fixed 50-item page size satisfies FR-004 ("default cap at 50 entries with a Load More button"). The GET endpoint returns a projection (`SweepHistoryEntry`) not the full `SweepSession` row, to minimize payload size.

---

## 9. Sidebar Collapsible Architecture

### Decision
The `LeftSidebar` component is redesigned to be globally collapsible and context-aware:
- **Expanded** (~`w-80` = 320px): shows icon + label in nav tabs; shows content list below (backtest runs when on `/`, sweep history when on `/optimizer`)
- **Collapsed** (`w-14` = 56px): shows only icons in nav; hides content list
- Collapse toggle button rendered at bottom of sidebar (or top-right corner)
- Collapsed/expanded state: React `useState` in the component (session-scoped, not persisted to localStorage per spec)

`OptimizerPage` keeps its own 2-pane internal layout. When `LeftSidebar` is on `/optimizer`, its content area shows only the **sweep history list** (not the configurator). The configurator remains in `OptimizerPage`'s left panel. The "Left Pane" described in the spec (history + configurator) is therefore split across the sidebar (history) + OptimizerPage left panel (configurator), which together occupy ~25–30% of horizontal space.

### Rationale
Placing the full configurator form inside the already-complex sidebar would couple sidebar state management with all form logic. Keeping the configurator in `OptimizerPage` preserves separation of concerns and matches the current architecture. The history list is appropriately light-weight for the sidebar.

### Alternatives Considered
- Full left pane in `OptimizerPage` (history + configurator, sidebar only for nav): this would require the sidebar to hide its content area entirely in Optimizer mode, which is cleaner architecturally but means the global sidebar is purely nav in Optimizer mode — inconsistent with spec FR-004 wording "Optimizer left pane".
- Context-switching the sidebar content (history when Optimizer): **chosen approach** — maintains sidebar's role as primary content browser.

---

## 10. Throttled Rendering Architecture

### Decision
In `useOptimizer.ts`, introduce a results buffer:
```typescript
const resultBufferRef = useRef<BatchRunResult[]>([])
const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
```
On SSE result events: push to `resultBufferRef.current` without triggering re-render.  
Every 250ms (interval): flush buffer into `session.results` via a single `setSession()` call.  
Progress bar counter: maintained separately via `useRef` for smooth increments (no throttle).

```typescript
useEffect(() => {
  flushTimerRef.current = setInterval(() => {
    const buffered = resultBufferRef.current.splice(0)
    if (buffered.length > 0) {
      setSession(prev => prev ? { ...prev, results: [...prev.results, ...buffered] } : prev)
    }
  }, 250)
  return () => { if (flushTimerRef.current) clearInterval(flushTimerRef.current) }
}, [])
```

### Rationale
This pattern decouples the OS-level SSE event rate from the React render rate. The `resultBufferRef` is a mutable ref (no re-render on push), so adding 50 items/second adds 0 renders. The 250ms interval produces ~4 renders/second per SC-005.

### Alternatives Considered
- `lodash.throttle` on `setSession`: rejected — throttle still creates new closures per event.
- Using `useDeferredValue` / `useTransition`: viable but adds React 18 dependency semantics; interval approach is simpler and testable.

---

## 11. Import/Export Cross-Module Compatibility

### Decision
The `handleExport` and `handleImport` logic in `OptimizerConfigurator.tsx` already works generically. To port to the Single Run `ConfigFormView`:
- Export: serialize current `BacktestFormState` as JSON to clipboard
- Import: parse JSON, populate `BacktestFormState` fields; sweep-specific fields (arrays, ranges) are reduced to their first value (or fixed value)

### Rationale
The `handleImport` in `OptimizerConfigurator` already handles the case where the value is a list (uses first value). Porting this to `ConfigFormView` requires only copy-pasting the logic with appropriate type mapping.

---

## 12. Year-Based Quick Dates — Implementation

### Decision
```typescript
const generateYearButtons = (): Array<{ label: string; startDate: string; endDate: string }> => {
  const currentYear = new Date().getFullYear()
  const startYear = currentYear - 5  // last 5 years
  const today = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const buttons = []
  for (let y = currentYear - 1; y >= startYear; y--) {
    buttons.push({
      label: `Since ${y}`,
      startDate: `${y}-01-01T00:00:00Z`,
      endDate: today
    })
    buttons.push({
      label: `${y} Only`,
      startDate: `${y}-01-01T00:00:00Z`,
      endDate: `${y}-12-31T23:59:59Z`
    })
  }
  return buttons
}
```
Buttons generated dynamically at render time — no hardcoded year values.

### Rationale
Pure function, no state dependencies. Satisfies SC-007 (automatically correct for any year without code changes). Edge case: "Since [current year]" button sets end = today = Jan 1, which produces a single-day window — acceptable per spec edge cases.

---

## 13. Selective Promotion — Re-run with Details

### Decision
The "Re-run with Details" button in the Leaderboard grabs the row's `config_json` (from `SweepRunSummary`) and navigates to `/` with prefill state:
```typescript
navigate('/', { state: { 
  prefillConfig: { ...config, enable_wide_events: true } 
}})
```
The `App.tsx` already handles `prefillConfig` state via `navigate('/', { state: { prefillConfig } })` in `OptimizerPage` (existing `handleOpenInSingleRun`). This pattern is already established.

The single-run path (POST `/backtests`) needs to forward `enable_wide_events: true` to the Go engine CLI via the `--wide-event-dir` flag (OR: the request JSON field per FR-025/FR-026).

### Rationale
The promotion workflow reuses existing single-run infrastructure. The only change is ensuring `enable_wide_events: true` is properly honored in the Go engine's single-run mode (FR-023 + FR-026 OR logic).

---

## Resolved Unknowns Summary

| Unknown | Resolution |
|---------|-----------|
| `enable_wide_events` Go struct placement | `EngineRequest` field (pointer-to-bool, optional) |
| OR logic implementation point | `main()` in `cmd/engine/main.go` single-run dispatch |
| Win rate source of truth | `TradeClosedEvent.Reason == "take_profit"` (confirmed in `events.go:82`) |
| Batch streaming current state | NOT streaming (buffers all results). Needs fix via `ExecuteBatchToWriter` |
| `capital_efficiency` compute location | Node.js API layer, using pre-flight `total_capital_required` |
| Pre-flight ladder availability | Available in `PreFlightSummary.ladder` (from Go `domain/config/preflight.go`) |
| DB cascade delete mechanism | Drizzle `REFERENCES sweep_sessions(id) ON DELETE CASCADE` |
| Sidebar architecture | Redesigned to be collapsible global nav; history list in sidebar for Optimizer mode; configurator stays in `OptimizerPage` left panel |
| Throttled rendering approach | `setInterval(250ms)` + mutable `resultBufferRef` |
| Quick dates | Dynamically generated at render time from `new Date().getFullYear()` |
