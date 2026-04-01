# Tasks: Optimizer Workspace (Parameter Sweep & High-Concurrency Execution)

**Input**: Design documents from `/specs/016-optimizer-workspace/`
**Prerequisites**: plan.md ✅ · spec.md ✅ · research.md ✅ · data-model.md ✅ · contracts/ ✅ · quickstart.md ✅

**Total Tasks**: 42 across 11 phases
**User Story Coverage**: US1 (5 tasks) · US2 (4 tasks) · US3 (5 tasks) · US4 (6 tasks) · US5 (2 tasks) · US6 (4 tasks) · US7 (2 tasks) · US8 (3 tasks) · Polish (6 tasks + 2 verification)
**Parallel Opportunities**: T003/T004 · T005/T006 · T010 (relative to US1 wrap-up) · T014/T015 · T019/T020/T021/T022 · T025/T026 · T027/T028 · T031/T032/T033/T034

**MVP Scope**: Phase 3 (US1) alone delivers end-to-end batch execution with shared-memory caching — the most value-generating backend capability. Add Phase 4 (US2) to unlock pruning and the rest of the pipeline.

---

## Phase 1: Setup

**Purpose**: Verify the Green Light Protocol and confirm any missing frontend dependencies before writing new code.

- [ ] T001 Verify Green Light Protocol: run `go test ./...` in `core-engine/` and `npx jest` in `orchestrator/api/` — both MUST pass before any work begins
- [ ] T002 [P] Confirm `decimal.js` and `papaparse` are present in `frontend/package.json`; add if missing (`npm install decimal.js papaparse --save`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared type contracts that MUST exist before any user story implementation — consumed by both Go and TypeScript layers.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 [core-engine] Create `core-engine/cmd/engine/preflight_types.go` with Go structs: `BatchJobConfig` (run_id + all EngineRequest fields), `BatchResultPayload` (run_id, type enum "result"/"error", pnl_summary, trade_events). **Note**: `PreFlightLadderEntry` and `PreFlightResult` are defined in `domain/config/preflight.go` (T011) to keep domain types in the domain layer and avoid circular imports.
- [ ] T004 [P] [orchestrator] Create `orchestrator/api/src/types/optimizer.ts` with TypeScript interfaces: `SweepParameter`, `SweepRange`, `SweepDefinition`, `FixedParams`, `GeneratedConfig`, `PruneReason` enum, `PrunedConfig`, `PruningResult`, `SweepCountResponse`, `PreFlightSummary`, `OptimizerSession` (with engineProcess ref), `BatchRunResult`, `SweepPhase` union type

**Checkpoint**: Shared type contracts exist — both Go structs and TypeScript interfaces defined before implementation begins.

---

## Phase 3: User Story 1 — Batch Execution with Shared-Memory Candle Caching (Priority: P1) 🎯 MVP

**Goal**: Go engine accepts `--batch-config <path>`, groups configs by `(symbol, start_date, end_date)`, queries ClickHouse exactly once per group, caches `[]Candle` in RAM (shared read-only), executes runs concurrently via `runtime.NumCPU()` worker pool with fully isolated `Orchestrator`+`PositionStateMachine` per worker, and streams tagged results to stdout.

**Independent Test**: `./core-engine.exe --batch-config batch.json` (10 configs, same symbol/date) → 10 result lines + 1 `batch_summary` line; mock ClickHouse query counter = 1; `go test -race ./application/orchestrator/... -run TestBatch` = zero races.

- [ ] T005 [P] [US1] [core-engine] Export `Candle` struct (Timestamp, Open, High, Low, Close, Volume as `decimal.Decimal`) and add `LoadAll() ([]Candle, error)` method to `core-engine/application/orchestrator/clickhouse_loader.go` — materializes full candle slice for a configured symbol/date range
- [ ] T006 [P] [US1] [core-engine] Create `core-engine/application/orchestrator/batch_test.go` with mock-based TDD tests: (a) grouping: 5 configs with 2 distinct symbol/date groups → exactly 2 `LoadAll()` invocations; (b) concurrent execution: 10 configs → all 10 results arrive, no goroutine leaks; (c) cross-contamination: 2 configs with different `safety_order_size` → each result reflects only its own config; (d) error isolation: 1 invalid config → error result emitted, remaining 9 complete; (e) duplicate configs: 2 identical configs → both produce separate result lines with distinct `run_id` values
- [ ] T007 [US1] [core-engine] Create `core-engine/application/orchestrator/batch.go` with `groupKey` struct, `candleCache` map type, `BatchJob` struct, `runBatchBacktest(filePath, logLevel, wideEventDir string) error` (reads JSON file → groups → LoadAll per group → `runtime.NumCPU()` worker pool → single result-writer goroutine serializing stdout), and `runSingleBatchRun(job BatchJob) BatchResultPayload` (fresh `Orchestrator`+`PositionStateMachine` per call; candles passed as read-only slice header copy)
- [ ] T008 [US1] [core-engine] Add `--batch-config` flag and dispatch in `core-engine/cmd/engine/main.go`: parse flag before existing stdin-decode path; route to `runBatchBacktest` when `*batchConfig != ""`; emit final `{"type":"batch_summary","total_runs":N,"successful":N,"failed":N}` JSON line on completion
- [ ] T009 [US1] [core-engine] Verify: `go test -race ./application/orchestrator/... -run TestBatch` passes with zero data races; grouping test confirms mock query counter = 1 for same-symbol batch

**Checkpoint**: At this point US1 is fully functional — `--batch-config` binary works end-to-end, race-free, with shared-memory caching verified by tests.

---

## Phase 4: User Story 2 — Pre-Flight Math for Capital & Drawdown Estimation (Priority: P2)

**Goal**: Go engine accepts `--preflight` (single config via stdin) and `--batch-preflight <path>` (array of configs from file), returns DCA ladder calculations using existing `ComputePriceSequence`/`ComputeAmountSequence` with a normalized $100 entry — no ClickHouse I/O, deterministic, all `decimal.Decimal`.

**Independent Test**: `echo '<config_json>' | ./core-engine.exe --preflight` → JSON with `max_drawdown_covered_pct=-7.12500000`, `total_capital_required=1500.00000000` for canonical test vector; `go test ./domain/config/... -run TestPreFlight` → all 7 canonical vectors pass.

- [ ] T010 [P] [US2] [core-engine] Create `core-engine/domain/config/preflight_test.go` with 7 binding canonical test vectors from spec §Canonical Test Data: SO1 `trigger_price_pct=-1.50000000`, SO2 `=-3.75000000`, SO3 `=-7.12500000`, `total_capital_required=1500.00000000`, `max_drawdown_covered_pct=-7.12500000` (for N=3 config); `total_capital_required=100.00000000`, `max_drawdown_covered_pct=0.00000000` (for N=0); determinism test (two identical calls → byte-equal output)
- [ ] T011 [US2] [core-engine] Create `core-engine/domain/config/preflight.go` implementing `ComputePreFlight(cfg *Config) (*PreFlightResult, error)`: normalized entry `decimal.NewFromInt(100)`, call `cfg.ComputePriceSequence(entry)` and `cfg.ComputeAmountSequence(cfg.AmountPerTrade())`, build `[]PreFlightLadderEntry` with `triggerPricePct = (P_i - P_0) / P_0 * 100` (accumulated, ROUND_HALF_UP 8dp), set `MaxDrawdownCoveredPct` to deepest rung (or zero if N=0), set `TotalCapitalRequired` from cumulative cost
- [ ] T012 [US2] [core-engine] Add `--preflight` (bool, reads stdin JSON → calls `ComputePreFlight` → writes single JSON to stdout → exits) and `--batch-preflight <path>` (reads JSON array from file → calls `ComputePreFlight` per config → writes JSON array to stdout → exits) flag dispatch in `core-engine/cmd/engine/main.go` switch statement (before `default: runSingleBacktest()`)
- [ ] T013 [US2] [core-engine] Verify: `go test ./domain/config/... -run TestPreFlight` passes all 7 canonical vectors; `--preflight` mode does not open a ClickHouse connection (test with a mock/no ClickHouse env); `--batch-preflight` processes a 5-element input array and returns matching 5-element result array

**Checkpoint**: At this point US2 is fully functional — both Pre-Flight modes work, all canonical math verified, no I/O performed.

---

## Phase 5: User Story 3 — Cartesian Product Generation & Smart Pruning (Priority: P3)

**Goal**: Node.js API expands sweep definitions into Cartesian products (with O(k) size guard), invokes Go `--batch-preflight` once for all configs, prunes invalid configs, returns valid run set with pruning summary.

**Independent Test**: `POST /optimizer/sweep/count` with 3×2 params → `{count: 6}`; `POST /optimizer/sweep` with 100 configs where 20 violate constraints → `{generated:100, pruned:20, valid:80}` with valid config list; 15,000-combination request → 400 rejection.

- [ ] T014 [P] [US3] [orchestrator] Create `orchestrator/api/src/services/SweepService.test.ts` with unit tests (no binary required): `calculateCombinationCount` (3×2=6; 10,001 → throws `SweepLimitExceededError`; single fixed param = 1); `expandRangeToValues` (1.0→2.0 step 0.5 → [1.0,1.5,2.0]; float-safe; start=end=1.0 → [1.0]); `buildCartesianProduct` (3×2 → 6 distinct `GeneratedConfig` objects with unique `run_id` values); `pruneConfigs` (15 capital-exceed + 5 below-minimum → pruned=20, valid=80, correct `PruneReason` on each)
- [ ] T015 [P] [US3] [orchestrator] Create `orchestrator/api/src/services/OptimizerSessionStore.ts`: `Map<string, OptimizerSession>` with `create`, `get`, `update` (partial patch), `delete` methods; `engineProcess?: ChildProcess` stored on session for cancellation; no DB calls
- [ ] T016 [US3] [orchestrator] Create `orchestrator/api/src/services/SweepService.ts` implementing: `calculateCombinationCount` (multiply swept parameter value-list lengths; return count; throw `SweepLimitExceededError` with count if > 10,000); `expandRangeToValues` using `decimal.js` `Decimal` for step arithmetic (avoids floating-point drift); `buildCartesianProduct` using iterative `reduce`+`flatMap` (no recursion/stack risk); `invokeBatchPreFlight` (write temp JSON file → spawn `core-engine --batch-preflight <path>` → parse stdout JSON array → return `Map<runId, PreFlightSummary>`); `pruneConfigs` checking `base_order >= 10` and `total_capital_required <= accountBalance`
- [ ] T017 [US3] [orchestrator] Create `orchestrator/api/src/routes/optimizer.routes.ts` with Express Router: `POST /sweep/count` (parse params → `calculateCombinationCount` → return `{count}` or 400 if over limit); `POST /sweep` (count check → Cartesian expand → `invokeBatchPreFlight` → prune → create session in store → return `SweepResponse` with sessionId, pruning summary, validConfigs); mount router at `/optimizer` in `src/app.ts`
- [ ] T018 [US3] [orchestrator] Create `orchestrator/api/src/services/OptimizerService.integration.test.ts`: integration test for `invokeBatchPreFlight` with 3 known configs → verify returned `max_drawdown_covered_pct` matches canonical values; mark test as `skippable` when compiled binary is absent (check env var `BINARY_PATH`)

**Checkpoint**: At this point US3 is fully functional — combinatorial count, Cartesian expansion, Go batch-preflight bridge, and pruning all verified without frontend.

---

## Phase 6: User Story 4 — Execution Dashboard with Live Progress & Leaderboard (Priority: P4)

**Goal**: Node.js SSE endpoint streams batch results; Cancel endpoint terminates Go process; frontend `ExecutionDashboard` shows Master Progress Bar and live Leaderboard updating in real time.

**Independent Test**: Mock Go engine stdout stream with 10 tagged result lines → progress bar shows 10/10 → Leaderboard has 10 rows sorted by Net PnL; cancel mid-stream → SSE closes, partial results preserved in Leaderboard.

- [ ] T019 [P] [US4] [orchestrator] Add `POST /optimizer/session/:sessionId/execute` endpoint to `orchestrator/api/src/routes/optimizer.routes.ts`: set `Content-Type: text/event-stream` headers; retrieve validConfigs from store; write batch-config temp file; spawn `core-engine --batch-config <path>`; pipe readline output as `data: <json>\n\n` SSE events; on process close emit `data: {"type":"complete"}\n\n` and call `res.end()`; store `engineProcess` ref on session
- [ ] T020 [P] [US4] [orchestrator] Add `DELETE /optimizer/session/:sessionId` endpoint to `orchestrator/api/src/routes/optimizer.routes.ts`: retrieve session from store; call `session.engineProcess.kill('SIGTERM')`; update session phase to `cancelled`; return 200 with `{status: "cancelled"}`; return 404 if session not found
- [ ] T021 [P] [US4] [orchestrator] Update `orchestrator/api/src/services/OptimizerSessionStore.ts` to store completed `BatchRunResult[]` array on session (accumulated by execute endpoint); expose `addResult(sessionId, result)` method for streaming accumulation
- [ ] T022 [P] [US4] [frontend] Create `frontend/src/components/optimizer/LeaderboardGrid.tsx`: sortable table (sort state: column + direction); swept parameter columns visually highlighted (`bg-yellow-50 font-medium`); row actions: "Open in Single Run" (`navigate('/', { state: { prefillConfig: result.config } })`), "Save as Preset" (persist to `localStorage` under a user-defined name), "Copy Config JSON" (`navigator.clipboard.writeText`); "Export CSV" using `papaparse.unparse` → download blob (FR-033)
- [ ] T023 [US4] [frontend] Create `frontend/src/hooks/useOptimizer.ts` with: `formState: OptimizerFormState`, `phase: SweepPhase` state machine, `session: OptimizerSession | null`, `launch()` (POST /sweep → POST /execute via `fetch` ReadableStream pump → parse NDJSON lines → dispatch to `results` state), `cancel()` (DELETE /session/:id → set phase `cancelled`), `openInSingleRun(result)` (navigate with prefillConfig)
- [ ] T024 [US4] [frontend] Create `frontend/src/components/optimizer/ExecutionDashboard.tsx`: Master Progress Bar div (`width: ${(completed/total)*100}%`) with text label `"{completed} / {total} Runs Completed ({pct}%)"`, embed `<LeaderboardGrid results={session.results} />` (live, auto-appends rows), "Cancel Sweep" button calling `onCancel`; show "Cancelled ({completed}/{total})" banner when `isCancelled`

**Checkpoint**: At this point US4 is fully functional — launch a sweep, watch results stream in, cancel stops the Go process, partial results are preserved.

---

## Phase 7: User Story 5 — Pre-Flight Visualizer (Idle State) (Priority: P5)

**Goal**: Right panel in idle state shows a stylized candlestick chart overlaid with an SVG heatmap zone spanning the sweep's drawdown range, and text readouts for drawdown coverage and capital required.

**Independent Test**: Provide mock pre-flight summary (`{minDrawdown:-8, maxDrawdown:-25, maxCapital:15432.50}`) → Visualizer renders heatmap zone from -8% to -25% below entry line; text shows "Max Drawdown Covered: -8% to -25%" and "Max Capital Required: $15,432.50".

- [ ] T025 [P] [US5] [frontend] Create `frontend/src/components/optimizer/PreFlightVisualizer.tsx`: render existing `SafetyOrderChart` (or equivalent) as background; overlay SVG rect spanning `minDrawdown%` to `maxDrawdown%` below a reference entry line (gradient fill: rgba(255,165,0,0.15) to rgba(255,0,0,0.25)); text readout block: "Max Drawdown Covered: {minDrawdown}% to {maxDrawdown}%" and "Max Capital Required: ${maxCapital.toLocaleString()}"; show placeholder skeleton state when `sweepSummary` is null
- [ ] T026 [US5] [frontend] Extend `frontend/src/hooks/useOptimizer.ts` with `sweepSummary: {minDrawdown: number, maxDrawdown: number, maxCapital: string} | null` derived from the Pre-Flight results returned by `POST /sweep` response; recalculate when form state changes and `/sweep` response arrives

**Checkpoint**: At this point US5 is functional — the idle right panel shows meaningful risk data from the sweep's Pre-Flight analysis.

---

## Phase 8: User Story 6 — Optimizer Configurator (Left Panel) (Priority: P6)

**Goal**: Left panel parameter form with Fixed/Sweep toggles, comma-separated or Range-popover value entry for numeric params, JSON Import/Export, Quick Date buttons, and a sticky CombinatorialFooter with live counts.

**Independent Test**: Toggle `price_scale` to Sweep, enter "1.0, 1.5, 2.0" → footer shows Generated count ×3; Range popover for `volume_scale` (Start=1.0, End=3.0, Step=0.5) → field auto-fills "1.0, 1.5, 2.0, 2.5, 3.0"; Click YTD → `start_date` = Jan 1 current year; Import JSON → all fields populated; Valid Runs=0 → Launch button disabled.

- [ ] T027 [P] [US6] [frontend] Create `frontend/src/components/optimizer/SweepParameterField.tsx`: Fixed/Sweep toggle (Headless UI `Switch` or equivalent); Fixed mode: plain `<input type="number">`; Sweep mode: text `<input>` for comma-separated values + Headless UI `Popover` (RangePopover) with Start/End/Step number inputs; on RangePopover "Apply" call `expandRangeToValues` client-side (use same step logic via `decimal.js`) and join result as comma-separated string into the text input
- [ ] T028 [P] [US6] [frontend] Create `frontend/src/components/optimizer/CombinatorialFooter.tsx`: sticky `position: sticky; bottom: 0` footer with Generated/Pruned/Valid counts sourced from `sweepCounts` prop; over-limit warning badge when `sweepCounts.overLimit === true`; "Launch Sweep" button disabled when `!sweepCounts?.valid || sweepCounts.overLimit`; loading spinner while debounce fetch is in-flight
- [ ] T029 [US6] [frontend] Create `frontend/src/components/optimizer/OptimizerConfigurator.tsx`: renders one `SweepParameterField` per sweepable numeric param (`price_entry`, `price_scale`, `amount_scale`, `amount_per_trade`, `number_of_orders`, `take_profit_distance_percent`, `multiplier` — 7 params); Account Balance number input field (used by pruning, FR-035); fixed fields for symbol, timeframe, start_date, end_date; Quick Date buttons (YTD/Last 6M/Last 30D) using `date-fns` `subMonths`/`subDays`; "Import JSON" modal with `<textarea>` → `Object.entries` parse → fill matching `ParameterField` values; "Export JSON" button → `navigator.clipboard.writeText(JSON.stringify(formState))`; mounts `<CombinatorialFooter>` at bottom
- [ ] T030 [US6] [frontend] Extend `frontend/src/hooks/useOptimizer.ts` with: `formState: OptimizerFormState` (one `ParameterField` per param with `mode`, `fixedValue`, `listInput`, `range`); `updateField(name, patch)` dispatcher; 300ms debounced call to `POST /optimizer/sweep/count` after any field change → updates `sweepCounts` state; debounce cancellation on unmount

**Checkpoint**: At this point US6 is functional — the full Configurator left panel works with live combinatorial feedback, and the Launch Sweep button is correctly guarded.

---

## Phase 9: User Story 7 — Quant Matrix (Complete State) (Priority: P7)

**Goal**: Complete right panel shows a 2D Heatmap grid for 2-variable sweeps (red-to-green gradient per Net PnL) and a Leaderboard Data Grid with all results; axis selector dropdown for 3+ variables.

**Independent Test**: Provide 25 completed results from a 5×5 price_scale × take_profit sweep → HeatmapGrid renders 5×5 = 25 cells with min-roi cell in red and max-roi cell in green; click column header → rows re-sort; click "Open in Single Run" → `navigate` called with correct prefillConfig.

- [ ] T031 [P] [US7] [frontend] Create `frontend/src/components/optimizer/HeatmapGrid.tsx`: pure SVG grid; cell count = xValues.length × yValues.length; color per cell: linear hsl interpolation `hue = 0 + 120 * (roi - minRoi) / (maxRoi - minRoi)` (0=red, 120=green); SVG `<rect>` per cell with `fill="hsl({hue},75%,42%)"`; `<title>` element on each rect for native browser tooltip showing param values + Net PnL + ROI + Capital Efficiency; axis selector `<select>` dropdowns shown when swept variable count ≥ 3 (re-render grid when selection changes)
- [ ] T032 [US7] [frontend] Create `frontend/src/components/optimizer/QuantMatrix.tsx`: renders `<HeatmapGrid>` only when exactly 2 swept variables are present (or user has selected 2 from dropdowns for 3+ var sweeps); always renders `<LeaderboardGrid results={session.results} sweptParams={sweptParamNames} rowActions={[openInSingleRun, saveAsPreset, copyConfigJSON]} exportCSV />`; shows "Cancelled ({completed}/{total} runs)" banner when `isCancelled`; "New Sweep" button resets `useOptimizer` phase to `idle`

**Checkpoint**: At this point US7 is functional — completed sweeps display the full Quant Matrix with Heatmap and sortable Leaderboard.

---

## Phase 10: User Story 8 — Optimizer Navigation & Layout (Priority: P8)

**Goal**: New sidebar nav item; `/optimizer` route; 25%/75% split-panel layout wiring all right-panel state components to `useOptimizer` phase.

**Independent Test**: Navigate to `/optimizer` → split layout renders; left panel shows `OptimizerConfigurator`; right panel shows `PreFlightVisualizer` (idle phase); trigger phase transitions → correct component renders in right panel.

- [ ] T033 [P] [US8] [frontend] Create `frontend/src/pages/OptimizerPage.tsx`: instantiate `useOptimizer()` hook; render `<div className="flex h-screen">` with left div `w-1/4 min-w-[300px] border-r flex flex-col flex-shrink-0` containing `<OptimizerConfigurator>` and right div `flex-1 overflow-hidden` containing: `{phase === 'idle' && <PreFlightVisualizer sweepSummary={sweepSummary} />}`, `{phase === 'running' && <ExecutionDashboard session={session} onCancel={cancel} />}`, `{(phase === 'complete' || phase === 'cancelled') && <QuantMatrix session={session} isCancelled={phase === 'cancelled'} onNewSweep={resetPhase} />}`
- [ ] T034 [P] [US8] [frontend] Add `/optimizer` route in `frontend/src/App.tsx`: `<Route path="/optimizer" element={<OptimizerPage />} />` alongside existing routes
- [ ] T035 [US8] [frontend] Add "Optimizer" navigation item to `frontend/src/components/LeftSidebar.tsx`: link to `/optimizer`; use a distinct icon (e.g., grid/sliders icon); positioned below "Single Run" entry; active state highlight matches existing nav item pattern

**Checkpoint**: At this point US8 is complete — the Optimizer Workspace is accessible from the sidebar and the entire UI is wired end-to-end.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Edge cases, defensive guards, and context-switching integration from spec §Edge Cases and §Cross-Cutting FRs.

- [ ] T036 [P] [frontend] Implement "Open in Single Run" parameter pre-fill: modify `frontend/src/pages/SingleRunPage.tsx` (or equivalent existing single-run page file) to read `location.state?.prefillConfig` on mount and populate form fields accordingly — completes FR-031 / SC-006 / US7 scenario 4
- [ ] T037 [P] [orchestrator] Add concurrent sweep guard in `orchestrator/api/src/routes/optimizer.routes.ts` `POST /sweep` handler: if any session in `OptimizerSessionStore` currently has phase `running`, reject with HTTP 409 `{"error": "A sweep is already running. Cancel it before launching a new one."}` (spec Edge Case: Concurrent sweep launches)
- [ ] T038 [P] [frontend] Add browser-navigation warning in `frontend/src/hooks/useOptimizer.ts`: attach `window.addEventListener('beforeunload', handler)` when `phase === 'running'` or (`phase === 'complete'` and results not exported); remove listener on cleanup — implements spec Edge Case: Browser refresh during sweep
- [ ] T039 [core-engine] Add Edge Case handling in `core-engine/application/orchestrator/batch.go`: empty batch array (`[]`) → log warning "Empty batch: no configs to execute" and exit cleanly with `batch_summary` of zeros (spec Edge Case: Empty batch file); single-config batch → executes identically to non-batch single-run, outputs one result line (spec Edge Case: Single-config batch)
- [ ] T041 [orchestrator] Add engine-crash resilience in `POST /session/:sessionId/execute` SSE handler: if the Go child process exits with a non-zero code or is killed unexpectedly, emit a final SSE event `{"type":"error","message":"Engine process terminated unexpectedly (exit code N)"}`, preserve all results received before the crash, update session phase to `partial`, and close the SSE connection (spec Edge Case: Engine crash mid-batch)
- [ ] T042 [core-engine] Add performance benchmark test in `core-engine/application/orchestrator/batch_benchmark_test.go`: `BenchmarkBatchExecution` runs 100 configs for a 6-month 1-minute dataset, asserts throughput ≥100 runs/minute on 8-core hardware (SC-007); mark as `testing.Short()` skip for CI
- [ ] T040 Run full verification suite: `go test -race ./...` in `core-engine/` (zero races) + `npx jest --testPathPattern=optimizer` in `orchestrator/api/` + `npx jest --testPathPattern=optimizer` in `frontend/` — all must pass before merge

---

## Dependency Graph (User Story Completion Order)

```
US2 (Pre-Flight Math) ──────────────────── required by ──────► US3 (Cartesian + Pruning)
US1 (Batch Execution) ──────────────────── required by ──────► US4 (Execution Dashboard)
US3 (Cartesian + Pruning) ──────────────── required by ──────► US4, US5, US6
US4 (Execution Dashboard) ──────────────── required by ──────► US7 (Quant Matrix)
US2 + US3 (Pre-Flight data available) ──── required by ──────► US5 (Pre-Flight Visualizer)
US3 (live counts from /sweep/count) ─────── required by ──────► US6 (Configurator footer)
US7 (Quant Matrix complete) ────────────── required by ──────► T036 (Open in Single Run)
US8 (Nav + Layout) ────── can scaffold any time ──────────────► wraps all UI stories
```

**Key insight**: US1 and US2 are both independent of each other (different files, different CLI flags) and can be developed in parallel by two engineers. US3 is the bridge — it requires US2's binary to invoke `--batch-preflight`.

## Parallel Execution Examples

### Sprint 1 (Two Engineers in Parallel)

| Engineer A | Engineer B |
|------------|------------|
| T003 (preflight_types.go) | T004 (optimizer.ts) |
| T005 (LoadAll export) + T006 (batch_test.go) | T010 (preflight_test.go) |
| T007 (batch.go) + T008 (main.go --batch-config) | T011 (preflight.go) + T012 (main.go --preflight flags) |
| T009 (verify race-free) | T013 (verify canonical vectors) |

### Sprint 2 (After Sprint 1 — Go binary fully functional)

| Engineer A | Engineer B |
|------------|------------|
| T014 (SweepService.test.ts) + T015 (SessionStore) | T033/T034/T035 (US8 layout scaffolding) |
| T016 (SweepService.ts) + T017 (routes count+sweep) | T027/T028 (SweepParameterField + Footer) |
| T018 (integration test) | T029 (OptimizerConfigurator) + T030 (useOptimizer form state) |

### Sprint 3 (After Sprint 2 — API + Configurator functional)

| Engineer A | Engineer B |
|------------|------------|
| T019/T020/T021 (SSE execute + cancel endpoints) | T022 (LeaderboardGrid) |
| T023/T024 (useOptimizer SSE + ExecutionDashboard) | T025/T026 (PreFlightVisualizer) |
| T031/T032 (HeatmapGrid + QuantMatrix) | T036/T037/T038/T039 (Polish) |
| T040 (Full verification) | — |

## Implementation Strategy

**MVP (Sprint 1 only)**: Completing Phases 3 and 4 (US1 + US2) delivers full Go batch execution with shared-memory caching and Pre-Flight math — the entire backend foundation. This can be verified without any frontend or Node.js changes, using raw CLI invocations and `go test`.

**Integration Point (Sprint 2)**: After Node.js Sprint 2, the API is fully functional (`POST /sweep/count`, `POST /sweep`) and can be tested via curl or Postman before a single React component is written.

**Full Feature (Sprint 3)**: The frontend wraps all of the above. Every right-panel state (Visualizer, Dashboard, Matrix) can be tested in isolation using mocked `useOptimizer` return values before full integration.
