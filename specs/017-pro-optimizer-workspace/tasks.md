# Tasks: Pro Optimizer Workspace (017)

**Input**: Design documents from `/specs/017-pro-optimizer-workspace/`
**Branch**: `017-pro-optimizer-workspace`
**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/optimizer-api.md ✅ | quickstart.md ✅

**Green Light Protocol**: All existing `go test ./...` (core-engine) and `npx jest` (orchestrator/api) must stay green at every commit. New tests must pass before merging any phase.

**Domain Boundary**: Tasks marked `[core-engine]` are pure domain/math — zero HTTP/UI deps. Tasks marked `[orchestrator]` are API/UI adapter layer only.

---

## Phase 1: Setup

**Purpose**: Confirm the development environment is clean and all baseline tests are green before any feature work begins.

- [x] T001 Verify green baseline — run `go test ./...` in `core-engine/` and confirm 0 failures
- [x] T002 [P] Verify green baseline — run `npx jest` in `orchestrator/api/` and confirm 0 failures
- [x] T003 [P] Verify green baseline — run `npm run test` in `frontend/` and confirm 0 failures

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database migration, Go streaming plumbing, and type extensions that every user story depends on. No user story work can begin until this phase is complete.

**⚠️ CRITICAL**: Tasks T004–T013 must all be complete before Phase 3+.

- [x] T004 [orchestrator] Add `sweepSessions` Drizzle table to `orchestrator/api/src/db/schema.ts` (columns per data-model.md: id UUID PK, trading_pair, start_date, end_date, total_runs, max_roi numeric(10,4), total_execution_time_ms bigint, status with CHECK, config_snapshot jsonb, created_at)
- [x] T005 [P] [orchestrator] Add `sweepRunSummaries` Drizzle table to `orchestrator/api/src/db/schema.ts` (columns: id UUID PK, session_id FK→sweep_sessions ON DELETE CASCADE, run_id text, config_json jsonb, roi/max_drawdown/total_fees numeric(10,4), win_rate numeric(6,4), capital_efficiency numeric(10,4), execution_time_ms bigint, created_at; index on session_id)
- [x] T006 [orchestrator] Run `npx drizzle-kit generate` in `orchestrator/api/` to produce `drizzle/0003_optimizer_sessions.sql`; verify generated SQL matches data-model.md schema including `ON DELETE CASCADE`
- [x] T007 [orchestrator] Run `npx drizzle-kit migrate` against local PostgreSQL and confirm both tables exist with `\dt` verification per quickstart.md step 1
- [x] T008 [orchestrator] Extend `PruneReason` type in `orchestrator/api/src/types/optimizer.ts` with three new values: `'guaranteed_fee_loss'`, `'exceeds_100_percent_drawdown'`, `'tick_size_violation'`
- [x] T009 [P] [orchestrator] Add `PruneBreakdown` interface to `orchestrator/api/src/types/optimizer.ts` (5 keys, all required number)
- [x] T010 [P] [orchestrator] Add `pruneReasons: PruneBreakdown` field to `PruningResult` interface in `orchestrator/api/src/types/optimizer.ts`
- [x] T011 [orchestrator] Add `preFlightMap: Map<string, PreFlightSummary>` field to `OptimizerSession` interface in `orchestrator/api/src/types/optimizer.ts`
- [x] T012 [orchestrator] Add `SweepHistoryEntry` interface to `orchestrator/api/src/types/optimizer.ts` (id, tradingPair, startDate, endDate, totalRuns, maxRoi nullable, status, createdAt)
- [x] T013 [core-engine] Add `EnableWideEvents *bool \`json:"enable_wide_events,omitempty"\`` field to `EngineRequest` struct in `core-engine/cmd/engine/main.go` after `ExitOnLastOrder`; add `WinRate *float64 \`json:"winRate,omitempty"\`` and `TotalPositionsClosed int \`json:"totalPositionsClosed,omitempty"\`` fields to `BatchResultPayload` in `core-engine/cmd/engine/preflight_types.go`

**Checkpoint**: DB tables exist, TypeScript types extended, Go structs updated — user story work can begin.

---

## Phase 3: US8 — Non-Blocking Streaming (Priority: P8)

**Goal**: Go engine emits each batch result to stdout immediately upon worker completion, enabling real-time SSE streaming to the frontend.

**Independent Test**: Run a 10-run batch, capture stdout, verify first NDJSON result line appears within 1 second of engine start (well before all 10 runs complete). Total output must equal 10 result lines + 1 `batch_summary` line.

**TDD Order (constitution)**: Write T016 (failing streaming test) first, then implement T014–T015 to turn it green. Red-Green-Refactor per constitution.

- [ ] T014 [core-engine] [US8] Add `ExecuteBatchToWriter(jobs []BatchJob, loaderFunc CandleLoaderFunc, workerCount int, out io.Writer)` function to `core-engine/application/orchestrator/batch.go`: same worker pool as `ExecuteBatch` but uses a `sync.Mutex`-protected `json.Encoder` to write each result directly to `out` as workers complete; writes `batch_summary` last after all workers finish
- [ ] T015 [core-engine] [US8] Update `runBatchBacktest` in `core-engine/cmd/engine/main.go` to call `orchestrator.ExecuteBatchToWriter(jobs, loaderFunc, 0, os.Stdout)` instead of the current `ExecuteBatch()` + write loop
- [ ] T016 [core-engine] [US8] Add streaming unit test to `core-engine/application/orchestrator/batch_test.go`: mock 5-job batch via pipe, assert first result line written before `batch_summary` (verifying non-buffered streaming); assert total line count = 5 results + 1 summary

**Checkpoint**: Run `go test ./...` — all green. US8 independently verifiable.

---

## Phase 4: US9/Foundation — enable_wide_events OR Logic (Priority: P9 — unblocks US9)

**Goal**: Go engine respects `enable_wide_events` payload field; `EmitWideEvents = envVar OR configFlag` regardless of environment defaults.

**Independent Test**: Run engine with three payloads matching the canonical OR truth table in spec; assert stdout wide-event file path present/absent correctly. Run `main_test.go` OR-logic unit tests.

**TDD Order (constitution)**: Write T018 (failing OR-logic unit tests) first, then implement T017 to turn them green. Red-Green-Refactor per constitution.

- [ ] T017 [core-engine] [US9] Add OR logic to `main()` single-run dispatch in `core-engine/cmd/engine/main.go` (after flag parse, before `buildConfigFromRequest`): `envWideEvents := os.Getenv("ENABLE_WIDE_EVENTS") == "true"`, `reqWideEvents := request.EnableWideEvents != nil && *request.EnableWideEvents`, if `envWideEvents || reqWideEvents` and `*wideEventDir == ""` then set `*wideEventDir = filepath.Join(os.TempDir(), "dca-wide-events", request.IdempotencyKey)`
- [ ] T018 [core-engine] [US9] Add OR-logic unit tests to `core-engine/cmd/engine/main_test.go` covering the 3 canonical truth-table rows from spec: (env=false, config=true → true), (env=true, config=false → true), (env=false, config absent → false); add absent-field JSON unmarshal test (EnableWideEvents is nil → defaults false)

**Checkpoint**: `go test ./...` green. FR-025 + FR-026 complete.

---

## Phase 5: US3 — Summary-Only DB Persistence (Priority: P3)

**Goal**: Every completed sweep persists one `SweepSession` + N `SweepRunSummary` records. No tradeEvents or safetyOrderUsage stored. Cascade delete enforced. persistence_error SSE event on DB failure.

**Independent Test**: Launch a 10-run sweep, query DB — exactly 1 session + 10 summaries, zero trade-level data. Delete session — all summaries gone. On simulated DB failure — `persistence_error` SSE event fires; results remain in-memory.

- [ ] T019 [core-engine] [US3] Add win rate tracking to `buildBatchResultPayload()` in `core-engine/application/orchestrator/batch.go`: add `tpCloses int` and `totalCloses int` counters; in `EventTypePositionClosed` case increment `totalCloses` and if `tce.Reason == "take_profit"` increment `tpCloses`; compute `winRate *float64` (`nil` when `totalCloses == 0`, else use `shopspring/decimal` to avoid FP arithmetic: `wr := decimal.New(int64(tpCloses), 0).Div(decimal.New(int64(totalCloses), 0)); f := wr.InexactFloat64(); winRate = &f` — FP is permitted only at the JSON serialization boundary per constitution); add both fields to the returned anonymous struct matching `BatchResultPayload`
- [ ] T020 [core-engine] [US3] Add win rate unit tests to `core-engine/application/orchestrator/batch_test.go`: (3 TP + 1 liquidation → 0.75), (0 closes → nil, no panic), (5/5 TP → 1.0)
- [ ] T021 [orchestrator] [US3] Create `orchestrator/api/src/services/SweepPersistenceService.ts`: implement `createSession(sessionId, definition, tradingPair, startDate, endDate)` → INSERT sweep_sessions with `status: 'running'`
- [ ] T022 [P] [orchestrator] [US3] Implement `persistRunSummary(sessionId, runResult, configJson, preFlightCapital)` in `SweepPersistenceService.ts`: INSERT sweep_run_summaries; compute `capitalEfficiency` using `decimal.js` (`new Decimal(roi).div(new Decimal(preFlightCapital)).mul(100)`); set `winRate = null` when `runResult.totalPositionsClosed === 0`; all financial fields stored as numbers rounded to 4dp
- [ ] T023 [P] [orchestrator] [US3] Implement `finalizeSession(sessionId, status, maxRoi, totalRuns, totalExecTimeMs)` in `SweepPersistenceService.ts`: UPDATE sweep_sessions SET status, total_runs, max_roi, total_execution_time_ms WHERE id
- [ ] T024 [P] [orchestrator] [US3] Implement `getSessions(page, limit)` in `SweepPersistenceService.ts`: SELECT sweep_sessions ORDER BY created_at DESC with LIMIT/OFFSET; return `{sessions, total, page, hasMore}`
- [ ] T025 [P] [orchestrator] [US3] Implement `getRunSummaries(sessionId)` in `SweepPersistenceService.ts`: SELECT sweep_run_summaries WHERE session_id = ?; return array
- [ ] T026 [P] [orchestrator] [US3] Implement `deleteSession(sessionId)` in `SweepPersistenceService.ts`: DELETE FROM sweep_sessions WHERE id = ? (cascade handles child deletion)
- [ ] T027 [orchestrator] [US3] Inject `SweepPersistenceService` as 3rd parameter to `createOptimizerRouter` in `orchestrator/api/src/routes/optimizer.routes.ts`; instantiate it in `orchestrator/api/src/app.ts` and pass to router
- [ ] T028 [orchestrator] [US3] Update execute route (`POST /session/:sessionId/execute`) in `optimizer.routes.ts`: (a) store `preFlightMap` in session during `POST /sweep` route, (b) call `sweepPersistence.createSession()` before spawning engine, (c) replace `backtestJobRepository.createCompletedFromResult()` with `sweepPersistence.persistRunSummary()` per result, wrapped in try/catch: on failure emit `data: {"type":"persistence_error","message":...}\n\n` SSE event without rethrowing, (d) initialize `const execStartTime = Date.now()` immediately after `createSession()` returns — before spawning the engine process — so it is always defined regardless of whether results arrive before cancellation, (e) on `child.on('close')` call `sweepPersistence.finalizeSession(sessionId, 'completed', maxRoi, completedCount, Date.now() - execStartTime)`
- [ ] T029 [orchestrator] [US3] Update `res.on('close')` cancel handler in execute route: declare `let sessionCancelled = false` in the execute route closure (shared reference reachable by T062 DELETE handler via session store or module-level map); in this handler, only if `!sessionCancelled` — set `sessionCancelled = true`, call `sweepPersistence.finalizeSession(sessionId, 'cancelled', partialMaxRoi, completedCount, Date.now() - execStartTime)` before killing engine, and emit `data: {"type":"cancelled","completed":N,"total":M}\n\n` (guard prevents double `cancelled` event when both paths fire simultaneously)
- [ ] T030 [orchestrator] [US3] Add integration tests in `orchestrator/api/tests/sweep-persistence.test.ts`: (a) 10-run sweep → 1 session row + 10 summary rows in DB; also assert `summaryRow` does NOT have `tradeEvents` or `safetyOrderUsage` properties (FR-008 negative constraint), (b) DELETE session cascades to zero summaries, (c) `SweepRunSummary.run_id` = engine `run_id` = config `idempotency_key`, (d) `win_rate = null` for run with `totalPositionsClosed: 0`, (e) DB storage for 500-run sweep < 200KB (aligns with SC-004)

**Checkpoint**: `npx jest` green. `go test ./...` green. US3 independently verifiable per quickstart.md step 5.

---

## Phase 6: US6 — Pruning Transparency (Priority: P6)

**Goal**: `POST /optimizer/sweep` response includes per-reason `pruneReasons` breakdown. UI footer shows "Generated: X | Pruned: Y | Valid: Z" with hoverable tooltip listing all 5 prune categories.

**Independent Test**: Configure a sweep with TP ≤ 0.2% (some configs), capital excess (others), and a min-order violation (others). Verify footer counts and tooltip breakdown match exactly. Verify all 5 keys present even when 0-count.

- [ ] T031 [orchestrator] [US6] Update `pruneConfigs()` in `orchestrator/api/src/services/SweepService.ts`: (a) initialize `pruneReasons` counter object `{capital_exceeds_balance:0, base_order_below_minimum:0, guaranteed_fee_loss:0, exceeds_100_percent_drawdown:0, tick_size_violation:0}`, (b) add `guaranteed_fee_loss` check first (before capital): `new Decimal(cfg.take_profit_distance_percent).lte(new Decimal('0.2'))`, (c) add `exceeds_100_percent_drawdown` check after capital: `pf && new Decimal(pf.max_drawdown_covered_pct).lte(new Decimal('-100'))`, (d) add `tick_size_violation` check: iterate `pf.ladder` consecutive pairs, compute gap `prev.minus(curr).div(prev).mul(100)`, prune if any gap `lt(new Decimal('0.1'))`, (e) increment `pruneReasons[reason]` on each prune, (f) return `pruneReasons` in `PruningResult`
- [ ] T032 [orchestrator] [US6] Update `POST /sweep` route in `optimizer.routes.ts` to include `pruneReasons` from `pruningResult` in the response body
- [ ] T033 [orchestrator] [US6] Add pruning unit tests to `orchestrator/api/tests/sweep-service.test.ts`: (a) `guaranteed_fee_loss` prune when TP = 0.15%, (b) `exceeds_100_percent_drawdown` prune when `max_drawdown_covered_pct = -105`, (c) `tick_size_violation` prune when ladder gap at level 8 < 0.1%, (d) all 5 keys present with value 0 when no violations, (e) sum of `pruneReasons` values equals total `pruned` count (FR-009 invariant)
- [ ] T034 [orchestrator] [US6] Add `pruneReasons?: PruneBreakdown` to `SweepCounts` (or new state field) in `frontend/src/hooks/useOptimizer.ts`; parse from `POST /sweep` response and store in state
- [ ] T035 [P] [orchestrator] [US6] Update `CombinatorialFooter` component in `frontend/src/components/optimizer/CombinatorialFooter.tsx`: add `pruneReasons?: PruneBreakdown` prop; render hoverable tooltip on "Pruned: Y" showing all 5 categories with counts (e.g., "↳ 30 exceeded Account Balance", "↳ 0 guaranteed fee loss")

**Checkpoint**: `npx jest` green. US6 verifiable per quickstart.md step 6.

---

## Phase 7: US1 — Global Navigation & Collapsible Sidebar (Priority: P1)

**Goal**: Global sidebar with collapsible behavior; Backtests and Optimizer nav tabs; context-aware content (sweep history in Optimizer mode, backtest runs in Backtests mode).

**Independent Test**: Render app, click collapse toggle → sidebar `w-14`; click expand → `w-80`. Switch tabs, verify 2-pane Optimizer layout.

- [ ] T036 [orchestrator] [US1] Redesign `frontend/src/components/LeftSidebar.tsx`: add `isCollapsed` state (`useState(false)`); add props `sweepHistory?: SweepHistoryEntry[]`, `onSelectSweep?: (id: string) => void`, `onLoadMoreSweeps?: () => void`, `hasMoreSweeps?: boolean`
- [ ] T037 [orchestrator] [US1] Add collapsed render mode to `LeftSidebar.tsx`: when `isCollapsed === true`, render `<aside className="w-14 ...">` with only nav icons (no text labels, no content list); add `transition-[width] duration-300` for smooth animation
- [ ] T038 [P] [orchestrator] [US1] Add collapse toggle button to `LeftSidebar.tsx`: render `ChevronLeft` / `ChevronRight` icon button at bottom of sidebar (or top-right header edge); toggles `isCollapsed`
- [ ] T039 [orchestrator] [US1] Add context-aware content to `LeftSidebar.tsx`: when `isOptimizer === true` and `isCollapsed === false`, render `SweepHistoryList` (T040) instead of backtest `RunCard` list
- [ ] T040 [P] [orchestrator] [US1] Create `frontend/src/components/optimizer/SweepHistoryList.tsx`: renders list of `SweepHistoryEntry[]`; each entry shows date, trading pair, total runs, max ROI (or `N/A`), status badge (`(cancelled)` in amber for cancelled entries); empty state "No sweeps yet. Configure and launch your first sweep."; "Load More" button when `hasMore = true`; prop: `onDelete` shows delete icon per row
- [ ] T041 [orchestrator] [US1] Write unit tests `frontend/src/__tests__/LeftSidebar.test.tsx` covering US1 AC1–AC6: (a) defaults expanded, (b) click collapse → `w-14`, (c) click expand → `w-80`, (d) Optimizer nav switch, (e) 2-pane layout renders in Optimizer mode, (f) sweep history list shown in Optimizer mode when expanded

**Checkpoint**: `npm run test` green. US1 independently verifiable.

---

## Phase 8: US2 — Sweep History Landing (Priority: P2)

**Goal**: Optimizer page loads and displays previously completed sweeps. Clicking a past sweep loads its Quant Matrix. New completed sweeps appear at top without refresh.

**Independent Test**: Seed 3 sweep sessions in DB, load Optimizer page, verify 3 entries with correct KPIs. Click one → right pane Quant Matrix renders. US2 AC1–AC5.

- [ ] T042 [orchestrator] [US2] Add `GET /optimizer/sessions` route to `optimizer.routes.ts`: delegate to `sweepPersistence.getSessions(page, 50)`; return `{sessions: SweepHistoryEntry[], total, page, hasMore}`
- [ ] T043 [P] [orchestrator] [US2] Add `GET /optimizer/sessions/:id/results` route to `optimizer.routes.ts`: delegate to `sweepPersistence.getRunSummaries(req.params.id)`; return `{results: SweepRunSummary[], count}`
- [ ] T044 [orchestrator] [US2] Add sweep history state to `frontend/src/hooks/useOptimizer.ts`: `sweepHistory`, `historyPage`, `hasMoreHistory` state fields; `loadHistory()` function (`GET /optimizer/sessions?page=N`); call `loadHistory()` on hook mount (`useEffect([], [])`); append new sweep to history after `phase === 'complete'`
- [ ] T045 [P] [orchestrator] [US2] Add `selectHistorySweep(id)` to `useOptimizer.ts`: `GET /optimizer/sessions/:id/results` → set `enrichedResults` from returned summaries; transition `phase` to `'complete'` to render Quant Matrix
- [ ] T046 [orchestrator] [US2] Wire `sweepHistory`, `onSelectSweep`, `onLoadMoreSweeps`, `hasMoreSweeps` from `useOptimizer` through `OptimizerPage.tsx` → `App.tsx` → `LeftSidebar` props
- [ ] T047 [orchestrator] [US2] Add API integration tests in `orchestrator/api/tests/optimizer-api.test.ts`: (a) `GET /sessions` returns sessions sorted by `created_at DESC`, (b) pagination `hasMore: true` when total > 50, (c) `GET /sessions/:id/results` returns correct summaries, (d) `GET /sessions/:id/results` returns 404 for unknown id, (e) `DELETE /sessions/:id` → HTTP 204 and confirmed cascade (zero summaries remain), (f) `DELETE /sessions/nonexistent` → HTTP 404
- [ ] T048 [orchestrator] [US2] Add `SweepHistoryList.test.tsx` unit tests covering US2 AC1–AC5: (a) 5 entries render with correct KPIs, (b) BTC/USDC + 120 runs + 14.3% ROI display, (c) click entry calls `onSelect`, (d) empty state message, (e) new sweep appears at top after completion

**Checkpoint**: `npx jest` green. `npm run test` green. US2 independently verifiable per quickstart.md step 5 (refresh check).

---

## Phase 9: US4 — Year-Based Quick Dates (Priority: P4)

**Goal**: Configurator dynamically generates "Since [Year]" and "[Year] Only" buttons for the last 5 years. Buttons are correct for any current year without code changes.

**Independent Test**: Render Configurator, verify year buttons generated from `new Date().getFullYear() - 5` to present. Click each and assert exact ISO date strings.

- [ ] T049 [orchestrator] [US4] Add `generateYearButtons()` function to `frontend/src/components/optimizer/OptimizerConfigurator.tsx`: computes `currentYear = new Date().getFullYear()`; generates buttons for years `currentYear-5` through `currentYear-1`; "Since [Y]" → `startDate = ${Y}-01-01T00:00:00Z`, `endDate = today`; "[Y] Only" → `startDate = ${Y}-01-01T00:00:00Z`, `endDate = ${Y}-12-31T23:59:59Z`; buttons rendered as a scrollable row below existing YTD/6M/30D buttons
- [ ] T050 [orchestrator] [US4] Add unit tests to `frontend/src/__tests__/OptimizerConfigurator.test.tsx`: (a) mock year as 2026 → verify "Since 2021" through "Since 2025" render, (b) click "Since 2023" → `startDate = "2023-01-01T00:00:00Z"` and `endDate = today`, (c) click "2024 Only" → `startDate = "2024-01-01T00:00:00Z"` and `endDate = "2024-12-31T23:59:59Z"`, (d) "YTD" still works correctly, (e) mock year 2027 → buttons include 2022–2026 automatically

**Checkpoint**: `npm run test` green. US4 independently verifiable per quickstart.md step 7.

---

## Phase 10: US5 — Global Import/Export Config (Priority: P5)

**Goal**: "Import Config" and "Export Config" available in the Single Run (Backtests) view, compatible with configs exported from the Optimizer.

**Independent Test**: Export from Optimizer → import into Single Run view → all shared fields populated. Export from Single Run → import into Optimizer → fields matched. US5 AC1–AC4.

- [x] T051 [orchestrator] [US5] Add "Import Config" and "Export Config" buttons to `frontend/src/components/ConfigFormView.tsx` toolbar (match Optimizer button style: `text-[10px] px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-400`)
- [x] T052 [orchestrator] [US5] Implement Export in `ConfigFormView.tsx`: serialize current `BacktestFormState` fields to JSON → `navigator.clipboard.writeText(JSON.stringify(data, null, 2))`
- [x] T053 [P] [orchestrator] [US5] Implement Import in `ConfigFormView.tsx`: textarea modal (same pattern as Optimizer); parse JSON; populate `BacktestFormState` fields; for sweep fields with arrays/ranges use first value (single-run is always fixed); for `enable_wide_events` field — populate if present
- [x] T054 [orchestrator] [US5] Add unit tests to `frontend/src/__tests__/ConfigFormView.test.tsx`: (a) "Import Config" and "Export Config" buttons render, (b) Export copies correct JSON to clipboard, (c) Import from valid JSON populates all fields, (d) Import of Optimizer config with array value uses first element

**Checkpoint**: `npm run test` green. US5 independently verifiable per quickstart.md step 10.

---

## Phase 11: US7 — Throttled Real-Time Rendering (Priority: P7)

**Goal**: Frontend buffers SSE result events and flushes to React state every 250ms. Progress bar increments independently per result. DOM never freezes during high-speed streaming.

**Independent Test**: Simulate 200 result events within 1 second; spy on `setSession`; assert ≤ 8 calls (one per 250ms interval); assert `session.results.length === 200` after all intervals.

- [x] T055 [orchestrator] [US7] Add result buffer to `frontend/src/hooks/useOptimizer.ts`: `resultBufferRef = useRef<BatchRunResult[]>([])` and `flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)`; replace direct `setSession` in SSE handler's `result` case with `resultBufferRef.current.push(event)`
- [x] T056 [orchestrator] [US7] Add 250ms flush interval to `useOptimizer.ts`: `useEffect` starts interval when `phase === 'running'`, clears on phase change; interval handler: `const buffered = resultBufferRef.current.splice(0)`; if `buffered.length > 0` → `setSession(prev => prev ? {...prev, results: [...prev.results, ...buffered]} : prev)`
- [x] T057 [P] [orchestrator] [US7] Add independent progress counter: `completedCountRef = useRef(0)` incremented per result (replaces direct session length check for progress bar percentage in `ExecutionDashboard`)
- [x] T058 [orchestrator] [US7] Add Jest throttle test to `frontend/src/__tests__/useOptimizer.test.ts`: mock `EventSource`/`ReadableStream` emitting 200 result events in <1s; spy on `setSession`; assert spy call count ≤ 8; advance fake timers by 2000ms; assert `session.results.length === 200`; also assert `completedCountRef.current === 200` after all events fire (verifies each result independently increments the ref without batching)

**Checkpoint**: `npm run test` green. US7 independently verifiable.

---

## Phase 12: US3 Continuation — Persistence Error Banner (Priority: P3)

**Purpose**: Complete US3 with the frontend warning banner for DB failure.

- [x] T059 [orchestrator] [US3] Add `persistenceError` flag to `useOptimizer.ts` state (`useState(false)`); in SSE event handler, set `setPersistenceError(true)` when `event.type === 'persistence_error'`; expose in hook return
- [x] T060 [orchestrator] [US3] Render amber warning banner in `frontend/src/pages/OptimizerPage.tsx` when `persistenceError === true`: `Warning: Database connection lost. Results are in-memory and will be lost on refresh. Export your results to CSV immediately.`
- [x] T061 [orchestrator] [US3] Add test to `frontend/src/__tests__/useOptimizer.test.ts`: simulate `persistence_error` SSE event → `persistenceError` flag = true; verify banner renders in `OptimizerPage`

---

## Phase 13: US10 — Sweep Cancellation & Partial Persistence (Priority: P10)

**Goal**: "Cancel Sweep" button terminates the engine; partial summaries are persisted; SweepSession status = `cancelled`; Quant Matrix shows partial results with "Cancelled (N/Total)" indicator; history entry shows `(cancelled)` badge.

**Independent Test**: Launch 50-run sweep, cancel at ~20 results, verify: engine exits, exactly 20 summaries in DB, session `status = 'cancelled'`, Quant Matrix shows 20 partial results + "Cancelled (20/50)" indicator.

- [x] T062 [orchestrator] [US10] Update `DELETE /optimizer/session/:id` route in `optimizer.routes.ts`: (a) send SIGTERM to running engine process (access via `activeProcesses` map or session-stored `child` reference), (b) check `sessionCancelled` guard (per T029 — shared via session store or module-level map): only if `!sessionCancelled` set `sessionCancelled = true` and emit `data: {"type":"cancelled","completed":N,"total":M}\n\n` on the SSE stream, preventing double `cancelled` events when both the `res.on('close')` and DELETE paths fire simultaneously, (c) call `sweepPersistence.finalizeSession(sessionId, 'cancelled', partialMaxRoi, completedCount, elapsedMs)`, (d) remove from in-memory store
- [x] T063 [orchestrator] [US10] Store active child process reference in session or module-level map so `DELETE` route can send SIGTERM
- [x] T064 [orchestrator] [US10] Verify "Cancel Sweep" button in `frontend/src/components/optimizer/ExecutionDashboard.tsx` is visible and enabled when `phase === 'running'`; ensure `onCancel` prop is wired to `cancel()` from `useOptimizer`
- [x] T065 [P] [orchestrator] [US10] Add "Cancelled (N/Total)" indicator to `frontend/src/components/optimizer/QuantMatrix.tsx`: when `phase === 'cancelled'`, render amber banner `Cancelled ({results.length} / {session?.totalRuns ?? '?'} runs)` above the results grid
- [x] T066 [orchestrator] [US10] Add cancellation integration test to `orchestrator/api/tests/optimizer-api.test.ts`: (a) cancel before first result → SweepSession persisted with `status='cancelled'`, `total_runs=0`, zero summaries, (b) cancel after N results → exactly N summaries, status `'cancelled'`, (c) cancel during persist write → in-progress write completes (no race condition)

**Checkpoint**: `npx jest` green. `npm run test` green. US10 verifiable per quickstart.md step 8.

---

## Phase 14: US9 — Selective Promotion (Priority: P9)

**Goal**: Every Leaderboard row has a "Re-run with Details" button that opens the Single Run view with `enable_wide_events: true` pre-filled. Promoted run persists full tradeEvents.

**Independent Test**: Complete a sweep, click "Re-run with Details" on top row — new tab at `/` with all params pre-filled and `enable_wide_events: true`. Submit run — `backtests` table contains full `trades` JSONB. US9 AC1–AC5.

- [x] T067 [orchestrator] [US9] Add "Re-run with Details" `<button>` to each row in the Leaderboard grid within `frontend/src/components/optimizer/QuantMatrix.tsx`; button calls `onOpenInSingleRun(result)` with `result.config` merged with `{enable_wide_events: true}`
- [x] T068 [orchestrator] [US9] Update `handleOpenInSingleRun` in `frontend/src/pages/OptimizerPage.tsx`: `navigate('/', { state: { prefillConfig: { ...result.config, enable_wide_events: true } } })`
- [x] T069 [orchestrator] [US9] Verify `frontend/src/components/ConfigFormView.tsx` reads `location.state?.prefillConfig` and populates `enable_wide_events` field into the form state; if not implemented, add the pre-fill reading logic now
- [x] T070 [orchestrator] [US9] Verify the `POST /backtests` handler in `orchestrator/api/src/routes/` (backtest routes) forwards `enable_wide_events` from `ApiBacktestRequest` to the Go engine stdin JSON; if absent, add `enable_wide_events: req.body.enable_wide_events ?? false` to the engine input construction
- [x] T071 [orchestrator] [US9] Add unit tests to `frontend/src/__tests__/QuantMatrix.test.tsx`: (a) every leaderboard row has exactly one "Re-run with Details" button, (b) click calls `onOpenInSingleRun` with `enable_wide_events: true`, (c) completed leaderboard with 5 rows → 5 action buttons; add sub-case for T070 route integration: after invoking the promoted backtest, assert the `backtests` DB row has a non-null `tradeEvents` column (FR-024 full-persist assertion)

**Checkpoint**: `npm run test` green. `npx jest` green. US9 verifiable per quickstart.md step 9.

---

## Phase 15: Polish & Cross-Cutting

**Purpose**: Layout wiring, App.tsx propagation, final integration verification.

- [x] T072 [orchestrator] Wire `sweepHistory`, `onSelectSweep`, `onLoadMoreSweeps`, `hasMoreSweeps` from `App.tsx` → `LeftSidebar` props; source data from `useOptimizer` hook (or lift history state to App level if hook is route-scoped)
- [x] T073 [P] [orchestrator] Verify `App.tsx` `<main>` flex layout expands correctly when `LeftSidebar` collapses — `LeftSidebar` uses fixed width classes (`w-14`/`w-80`), `<main>` uses `flex-1`; no explicit width calculation needed
- [x] T074 [P] [orchestrator] Delete cancelled SweepSession from history: wire `onDelete` prop in `SweepHistoryList` to `DELETE /optimizer/session/:id`; remove from `sweepHistory` state on success (optimistic) or on confirmed response
- [x] T075 [core-engine] Rebuild Go engine binary after all `core-engine` changes: `go build -o bin/engine ./cmd/engine` (Win: `go build -o bin/engine.exe ./cmd/engine`); run full `go test ./...` — 0 failures
- [x] T076 [orchestrator] Run full `npx jest` in `orchestrator/api/` — 0 failures  
- [x] T077 [P] [orchestrator] Run full `npm run test` in `frontend/` — 0 failures
- [ ] T078 [orchestrator] End-to-end smoke test per quickstart.md: (a) sidebar collapse/expand, (b) 3-run sweep executes + persists + appears in history, (c) "Since 2024" quick-date sets correct ISO dates, (d) cancel mid-sweep + verify partial DB state, (e) "Re-run with Details" opens new tab with correct params
- [x] T079 [orchestrator] [infra] Add non-blocking OpenTelemetry spans to `orchestrator/api/src/services/SweepPersistenceService.ts`: instrument `createSession`, `persistRunSummary`, and `finalizeSession` with OTel spans using the project's existing OTel setup; also add spans to the `GET /optimizer/sessions` and `GET /optimizer/sessions/:id/results` route handlers; confirm all exporters remain asynchronous (non-blocking, per constitution observability MUST)

---

## Dependencies

```
T001–T003 (baseline green)
  └─ T004–T013 (Phase 2 foundation)
       ├─ T014–T016 (US8 streaming) ─── independent of other stories
       ├─ T017–T018 (US9 engine) ─────── independent of other stories
       ├─ T019–T030 (US3 persistence) ── waits on T013 (BatchResultPayload fields)
       │    └─ T059–T061 (US3 banner)
       ├─ T031–T035 (US6 pruning) ────── independent of persistence
       ├─ T036–T041 (US1 sidebar) ────── independent of API
       │    └─ T042–T048 (US2 history) ─ waits on T021–T026 (persistence service)
       ├─ T049–T050 (US4 quick dates) ── independent, frontend-only
       ├─ T051–T054 (US5 import/export) ─ independent, frontend-only
       ├─ T055–T058 (US7 throttle) ────── independent, frontend-only
       ├─ T062–T066 (US10 cancel) ─────── waits on T028–T029 (execute route)
       └─ T067–T071 (US9 promotion) ───── waits on T017–T018 (engine OR logic)
            └─ T072–T079 (polish)
```

## Parallel Execution Opportunities

**Parallel group A** (can start immediately after T001–T013):
- Go engine stream: T014, T017, T019 (batch.go changes — different functions)
- Frontend structure: T036, T040, T049, T051, T055 (all different files)
- API types: T031 (SweepService), T021–T026 (SweepPersistenceService)

**Parallel group B** (after group A):
- T042, T043 (new GET routes — different methods, same file)
- T044, T045 (useOptimizer history additions — same file, sequential)
- T059, T064, T065 (US3 banner, US10 cancel button, cancelled indicator — different components)

## Implementation Strategy

**MVP scope (suggested)**: Phase 1–6 (T001–T035) = baseline verification + DB foundation + streaming fix + pruning transparency. This delivers the most analytically impactful changes without requiring the full sidebar redesign.

**Full delivery**: All phases T001–T079 in order. Estimated ~86 focused tasks across 4 layers.
