# Implementation Plan: Pro Optimizer Workspace

**Branch**: `017-pro-optimizer-workspace` | **Date**: 2026-04-01 | **Spec**: [specs/017-pro-optimizer-workspace/spec.md](spec.md)
**Input**: Feature specification from `/specs/017-pro-optimizer-workspace/spec.md`

## Summary

Elevate the existing Optimizer Workspace into a production-ready quantitative dashboard. The primary technical work spans four layers: (1) **Go engine** — add `enable_wide_events` payload field with OR logic, win rate tracking in batch mode, and true NDJSON streaming to stdout; (2) **Node.js API** — new database persistence layer for `sweep_sessions`/`sweep_run_summaries` tables, three advanced pruning rules, pruning breakdown response, and sweep history endpoints; (3) **React frontend** — collapsible global sidebar, sweep history list, throttled result rendering (250ms flush interval), year-based quick dates, pruning transparency tooltip, cancellation button, and selective promotion ("Re-run with Details"); (4) **Database** — one new migration adding both optimizer tables with cascade delete.

## Technical Context

**Language/Version**: Go 1.22 (core-engine) + TypeScript 5.x/Node.js 22 (orchestrator/api) + TypeScript 5.x/React 18 (frontend)  
**Primary Dependencies**: `shopspring/decimal` (Go), `decimal.js` (Node.js), `drizzle-orm` + `pg` (API), React Router v6, Tailwind CSS  
**Storage**: PostgreSQL via Drizzle ORM — two new tables: `sweep_sessions`, `sweep_run_summaries`  
**Testing**: `go test ./...` (Go), `npx jest` (API), `npm run test` (frontend — vitest + React Testing Library)  
**Target Platform**: Linux server (Docker Compose) + local dev Windows  
**Project Type**: web-service + CLI binary extension  
**Performance Goals**: React Leaderboard ≤4 updates/sec during 50+ results/sec; <200KB DB storage per 500-run sweep; sidebar collapse <300ms  
**Constraints**: Fixed-point arithmetic mandatory (all monetary math); win rate divide-by-zero → null; no live trading; one sweep at a time  
**Scale/Scope**: Up to 10,000 configs per sweep; up to 1,000 persisted summaries per session (Quant Matrix loads in <3s per SC-010)

---

## Constitution Check

*GATE: Must pass before implementation begins. Re-checked post-design.*

| Gate | Status | Evidence |
|------|--------|----------|
| **No Live Trading** | ✅ PASS | Purely analytical — history, persistence, UI. No broker calls. |
| **Green Light Protocol** | ✅ PASS (pre-condition) | Confirmed `go test ./...` and `npx jest` green on unmodified branch before work starts. |
| **Fixed-Point Arithmetic** | ✅ PASS | Go win rate: integer counters (no FP arithmetic). Node.js pruning: `decimal.js` for all threshold comparisons. `capital_efficiency`: `decimal.js`. DB: `numeric(10,4)` columns. |
| **BDD Acceptance Criteria** | ✅ PASS | 10 user stories with Given/When/Then in spec. 74 new test cases across 3 test suites. |
| **Clean Architecture** | ✅ PASS | Go changes: `cmd/engine/` + `application/orchestrator/` only — zero HTTP/UI deps. API changes: adapter layer only. |
| **Single-Position Invariant** | ✅ PASS | Feature does not touch PSM or execution loop. |
| **Gap-Down Rule** | ✅ PASS | Feature does not touch candle processing. |

**Complexity Tracking**: No violations. No extra projects. No Repository pattern (direct Drizzle ORM service is sufficient for one-table operations).

---

## Project Structure

### Documentation (this feature)

```text
specs/017-pro-optimizer-workspace/
├── plan.md              ← This file
├── research.md          ← Phase 0 output (DONE)
├── data-model.md        ← Phase 1 output (DONE)
├── quickstart.md        ← Phase 1 output (DONE)
├── contracts/
│   └── optimizer-api.md ← Phase 1 output (DONE)
└── tasks.md             ← Phase 2 output (/speckit.tasks — NOT created by /speckit.plan)
```

### Source Code (Polyglot Architecture)

**Feature Placement Contract**: Every change MUST belong to either `core-engine/` (mathematical + domain) or `orchestrator/` (API + UI). Core-engine code has zero HTTP/UI/API dependencies.

```text
core-engine/                         # Go — domain + batch execution
  cmd/engine/
    main.go                          # EXTEND: EnableWideEvents in EngineRequest; OR logic
    preflight_types.go               # EXTEND: WinRate + TotalPositionsClosed in BatchResultPayload
  application/orchestrator/
    batch.go                         # EXTEND: win rate tracking; ExecuteBatchToWriter streaming

orchestrator/api/                    # TypeScript — REST API + persistence
  src/
    db/schema.ts                     # ADD: sweepSessions + sweepRunSummaries tables
  drizzle/
    0003_optimizer_sessions.sql      # NEW: migration for optimizer tables
  src/types/optimizer.ts             # EXTEND: PruneReason, PruningResult, OptimizerSession, SweepHistoryEntry
  src/services/
    SweepService.ts                  # EXTEND: 3 advanced prune rules + pruneReasons response
    SweepPersistenceService.ts       # NEW: DB operations (sessions + summaries)
  src/routes/optimizer.routes.ts     # EXTEND: DB persistence in execute; add GET /sessions routes; update DELETE

frontend/src/                        # React — UI
  components/
    LeftSidebar.tsx                  # REDESIGN: collapsible + sweep history in Optimizer mode
    optimizer/
      SweepHistoryList.tsx           # NEW: history list component
      OptimizerConfigurator.tsx      # EXTEND: year-based quick dates
      ExecutionDashboard.tsx         # VERIFY: Cancel button visible when running
      QuantMatrix.tsx                # EXTEND: Cancelled indicator + Re-run with Details button
      CombinatorialFooter.tsx        # EXTEND: pruneReasons tooltip
    ConfigFormView.tsx               # EXTEND: Import/Export buttons
  hooks/
    useOptimizer.ts                  # EXTEND: throttle, persistenceError, sweepHistory loading
  pages/
    OptimizerPage.tsx                # EXTEND: history section in left panel
  App.tsx                            # EXTEND: pass sweepHistory props to LeftSidebar
```

---

## Phase 0: Research (COMPLETE)

See [research.md](research.md) for full findings. Key resolved unknowns:

| Unknown | Resolution |
|---------|-----------|
| `enable_wide_events` placement | `EngineRequest` pointer-to-bool; OR logic in `main()` |
| Win rate source | `TradeClosedEvent.Reason == "take_profit"` (`events.go:82`) |
| Batch streaming gap | Currently buffers all — needs `ExecuteBatchToWriter` fix |
| `capital_efficiency` location | Node.js API layer, `preFlightMap` stored in session |
| Sidebar architecture | Collapsible global nav; sweep history in sidebar Optimizer mode |
| Throttled rendering | `setInterval(250ms)` + `resultBufferRef` (no re-render on push) |
| Pre-flight ladder availability | `PreFlightSummary.ladder` array already accessible |

---

## Phase 1: Design (COMPLETE)

- [data-model.md](data-model.md) — DB entities, TypeScript interfaces, Go struct extensions
- [contracts/optimizer-api.md](contracts/optimizer-api.md) — new endpoints + modified SSE events
- [quickstart.md](quickstart.md) — step-by-step verification guide

---

## Phase 2: Implementation Plan

Ordered by user story priority. Independent streams can be worked in parallel.

---

### Stream 1: Go Engine (US7, US8, US9) — `core-engine/`

**Independent of API/frontend. Can start immediately.**

#### G1: `enable_wide_events` Field + OR Logic (FR-025, FR-026)

**File**: `core-engine/cmd/engine/main.go`

1. Add `EnableWideEvents *bool \`json:"enable_wide_events,omitempty"\`` to `EngineRequest` after `ExitOnLastOrder`.
2. In `main()` single-run dispatch, add OR logic before `buildConfigFromRequest`:
   ```go
   envWideEvents := os.Getenv("ENABLE_WIDE_EVENTS") == "true"
   reqWideEvents := request.EnableWideEvents != nil && *request.EnableWideEvents
   if envWideEvents || reqWideEvents {
     if *wideEventDir == "" {
       *wideEventDir = filepath.Join(os.TempDir(), "dca-wide-events", request.IdempotencyKey)
     }
   }
   ```
3. **Tests** (`cmd/engine/main_test.go`): 3-row OR truth table from spec canonical table; absent field → false.

#### G2: Win Rate Tracking in Batch (FR-010)

**File**: `core-engine/application/orchestrator/batch.go`

4. Add `tpCloses int` and `totalCloses int` counters in `buildBatchResultPayload()` event loop.
5. In `EventTypePositionClosed` case: `totalCloses++`; if `tce.Reason == "take_profit"` → `tpCloses++`.
6. Compute `winRate *float64`: `nil` when `totalCloses == 0`; else `float64(tpCloses)/float64(totalCloses)`.
7. Add `WinRate *float64` and `TotalPositionsClosed int` fields to return struct.
8. Update `BatchResultPayload` in `preflight_types.go` with same fields.
9. **Tests** (`batch_test.go`): 3 TP + 1 liquidation = 0.75; 0 closes = nil; 5/5 TP = 1.0.

#### G3: Non-Blocking Stdout Streaming (FR-017)

**File**: `core-engine/application/orchestrator/batch.go` + `core-engine/cmd/engine/main.go`

10. Add `ExecuteBatchToWriter(jobs, loaderFunc, workerCount, out io.Writer)`: worker pool identical to `ExecuteBatch`, but each finished result is immediately `json.Encoder.Encode()`d to `out` under a mutex. `batch_summary` written last.
11. Update `runBatchBacktest` in `main.go`: replace `ExecuteBatch()` call + write loop with `ExecuteBatchToWriter(jobs, loaderFunc, 0, os.Stdout)`.
12. **Tests** (`batch_test.go`): verify first result line written before all results complete (use pipe buffer detection).

---

### Stream 2: API Layer (US3, US6, US10) — `orchestrator/api/`

**Can start in parallel with Stream 1. Persistence tasks wait on G2 field from Stream 1.**

#### A1: DB Schema + Migration (FR-008–FR-013)

**Files**: `src/db/schema.ts`, `drizzle/0003_optimizer_sessions.sql`

13. Add `sweepSessions` table to `schema.ts` (see data-model.md for full column list).
14. Add `sweepRunSummaries` table with `REFERENCES sweep_sessions(id) ON DELETE CASCADE`.
15. Run `npx drizzle-kit generate` → verify generated SQL matches data-model.md.

#### A2: SweepPersistenceService (FR-009–FR-013)

**File**: `src/services/SweepPersistenceService.ts` (NEW)

16. Implement `createSession(sessionId, definition, tradingPair, startDate, endDate)` → INSERT sweep_sessions with status `'running'`.
17. Implement `persistRunSummary(sessionId, runResult, configJson, preFlightCapital)` → INSERT sweep_run_summaries; compute `capitalEfficiency` via `decimal.js`; `winRate = null` when `totalPositionsClosed === 0`.
18. Implement `finalizeSession(sessionId, status, maxRoi, totalRuns, totalExecTimeMs)` → UPDATE sweep_sessions.
19. Implement `getSessions(page, limit)` → paginated SELECT `ORDER BY created_at DESC`.
20. Implement `getRunSummaries(sessionId)` → SELECT WHERE session_id.
21. Implement `deleteSession(sessionId)` → DELETE (cascade handles children).
22. **Tests** (`tests/sweep-persistence.test.ts`): 10-run sweep → 1 session + 10 summaries; cascade delete; run_id mapping; `win_rate = null` for 0-close run.

#### A3: Advanced Pruning Rules (FR-015, FR-016)

**File**: `src/services/SweepService.ts`, `src/types/optimizer.ts`

23. Extend `PruneReason` type with 3 new values: `'guaranteed_fee_loss'`, `'exceeds_100_percent_drawdown'`, `'tick_size_violation'`.
24. Add `PruneBreakdown` interface and `pruneReasons: PruneBreakdown` to `PruningResult`.
25. Update `pruneConfigs()`:
    - Initialize `pruneReasons` with all 5 keys = 0.
    - Add `guaranteed_fee_loss` check first (before capital check): `new Decimal(cfg.take_profit_distance_percent).lte('0.2')`.
    - Add `exceeds_100_percent_drawdown` check (after capital): `new Decimal(pf.max_drawdown_covered_pct).lte('-100')`.
    - Add `tick_size_violation` check (after drawdown): iterate `pf.ladder` consecutive pairs; compute gap% via `decimal.js`; flag if any gap `< 0.1%`.
    - Increment `pruneReasons[reason]` on each prune.
26. Return `pruneReasons` in `PruningResult`.
27. **Tests** (`tests/sweep-service.test.ts`): each of 3 new rules; all 5 keys present even with 0-count; sum of keys equals total `pruned`.

#### A4: Route Updates (FR-009, FR-012b, FR-013, FR-020c/d)

**File**: `src/routes/optimizer.routes.ts`

28. Inject `SweepPersistenceService` as 3rd parameter to `createOptimizerRouter`.
29. Store `preFlightMap` in `OptimizerSession` (extend `session` object in `POST /sweep` route).
30. Update `POST /sweep` response: include `pruneReasons` from `pruningResult`.
31. Update execute route:
    - **Before spawn**: call `sweepPersistence.createSession(...)`.
    - **Per result**: replace `backtestJobRepository.createCompletedFromResult()` with `sweepPersistence.persistRunSummary()`. Wrap in try/catch; on failure → emit `{"type":"persistence_error","message":...}` SSE event (do NOT rethrow).
    - **Track wall-clock**: record `execStartTime` on first result; compute `totalExecTimeMs = Date.now() - execStartTime` in `child.on('close')`.
    - **On `close` (complete)**: call `sweepPersistence.finalizeSession(sessionId, 'completed', maxRoi, completedCount, totalExecTimeMs)`.
    - **On `res.on('close')` (cancel)**: call `sweepPersistence.finalizeSession(sessionId, 'cancelled', partialMaxRoi, completedCount, elapsedMs)`.
32. Add `GET /sessions` route (paginated, delegates to `sweepPersistence.getSessions`).
33. Add `GET /sessions/:id/results` route (delegates to `sweepPersistence.getRunSummaries`).
34. Update `DELETE /session/:id`: emit `{"type":"cancelled","completed":N,"total":M}` SSE event; call `sweepPersistence.finalizeSession(sessionId, 'cancelled', ...)` before killing engine.
35. Update `app.ts` to instantiate and inject `SweepPersistenceService`.
36. **Tests** (`tests/optimizer-api.test.ts`): GET /sessions pagination; GET /sessions/:id/results; DELETE cascade.

---

### Stream 3: Frontend (US1–US10) — `frontend/src/`

**Independent of Streams 1 & 2 for UI structure. Persistence features need mock API.**

#### F1: Global Sidebar Redesign (US1 — P1)

**File**: `frontend/src/components/LeftSidebar.tsx`

37. Add `isCollapsed` state (`useState(false)`).
38. Add props: `sweepHistory`, `onSelectSweep`, `onLoadMoreSweeps`, `hasMoreSweeps`.
39. Render collapsed mode (`w-14`): show only nav icons, no labels, no content list.
40. Render expanded mode (`w-80`): existing header + nav tabs + context list.
41. Context list: if `isOptimizer` → render `SweepHistoryList`; else → render backtest `RunCard` list.
42. Add collapse toggle button (e.g., `ChevronLeft`/`ChevronRight` icon at bottom or top-right).
43. Add CSS transition on `<aside>` width: `transition-[width] duration-300`.
44. **Tests** (`__tests__/LeftSidebar.test.tsx`): US1 AC1–AC6 scenarios.

#### F2: SweepHistoryList Component (US2 — P2)

**File**: `frontend/src/components/optimizer/SweepHistoryList.tsx` (NEW)

45. Render each `SweepHistoryItem`: date, trading pair, total runs, max ROI, status badge.
46. `maxRoi = null` → display `N/A`.
47. `status = 'cancelled'` → render muted-orange `(cancelled)` badge.
48. Empty state: "No sweeps yet. Configure and launch your first sweep."
49. "Load More" button when `hasMore = true`.
50. **Tests** (`__tests__/SweepHistoryList.test.tsx`): US2 AC1–AC5 BDD scenarios.

#### F3: History Data Fetching (US2 — P2)

**File**: `frontend/src/hooks/useOptimizer.ts`

51. Add `sweepHistory`, `historyPage`, `hasMoreHistory` state.
52. Add `loadHistory()`: `GET /optimizer/sessions?page=N&limit=50` → append or replace list.
53. Call `loadHistory()` on mount and after sweep completes.
54. Add `selectHistorySweep(id)`: `GET /optimizer/sessions/:id/results` → populate `enrichedResults` from DB summaries.

#### F4: Year-Based Quick Dates (US4 — P4)

**File**: `frontend/src/components/optimizer/OptimizerConfigurator.tsx`

55. Add `generateYearButtons()` function: last 5 years, dynamic from `new Date().getFullYear()`. Returns `[{label, startDate, endDate}]` array.
56. Render year buttons below existing quick-date row.
57. **Tests**: "Since 2023" → correct ISO dates; "2024 Only" → correct ISO dates; year 2027 → 2022–2026 buttons.

#### F5: Import/Export in Single Run (US5 — P5)

**File**: `frontend/src/components/ConfigFormView.tsx`

58. Add "Import Config" and "Export Config" buttons matching Optimizer style.
59. Export: serialise `BacktestFormState` → `navigator.clipboard.writeText(JSON.stringify(data, null, 2))`.
60. Import: textarea modal → parse JSON → populate `BacktestFormState` (sweep arrays → first value).
61. **Tests**: export copies correct JSON; import populates fields; cross-module compat.

#### F6: Pruning Transparency (US6 — P6)

**File**: `frontend/src/components/optimizer/CombinatorialFooter.tsx`

62. Add `pruneReasons?: PruneBreakdown` prop.
63. Render breakdown tooltip on "Pruned: Y" hover: list each non-zero reason with label and count.
64. Ensure all 5 keys shown (0-count keys show "0").
65. Wire `pruneReasons` from `POST /sweep` response through `useOptimizer` → `sweepcounts` or new state field.
66. **Tests**: tooltip shows correct counts; 0-count reasons displayed as "0".

#### F7: Throttled Rendering (US7 — P7)

**File**: `frontend/src/hooks/useOptimizer.ts`

67. Add `resultBufferRef = useRef<BatchRunResult[]>([])` and `flushTimerRef`.
68. In SSE event handler (`type === 'result'`): push to `resultBufferRef.current` only (no state update).
69. 250ms interval flush: batch-update `session.results` with buffered items when buffer non-empty.
70. Progress counter: separate `completedCountRef.current++` per result (used for progress bar, not throttled).
71. **Jest test** (`__tests__/useOptimizer.test.ts`): 200 events in 1s → `setSession` called ≤ 8 times; `session.results.length === 200` after flush.

#### F8: Persistence Error Banner (US3 — P3)

**File**: `frontend/src/hooks/useOptimizer.ts` + `frontend/src/pages/OptimizerPage.tsx`

72. Add `persistenceError` flag to `useOptimizer`; set `true` on `type === 'persistence_error'` SSE event.
73. Render amber warning banner in `OptimizerPage` when `persistenceError === true`.
74. **Test**: `persistenceError` flag = true after event; banner in DOM.

#### F9: Cancellation UI (US10 — P10)

**File**: `frontend/src/components/optimizer/ExecutionDashboard.tsx`, `frontend/src/components/optimizer/QuantMatrix.tsx`, `frontend/src/components/optimizer/SweepHistoryList.tsx`

75. Verify "Cancel Sweep" button visible+enabled when `phase === 'running'` (existing `onCancel` prop wired correctly).
76. Add "Cancelled (N/Total)" indicator in `QuantMatrix` when `phase === 'cancelled'`.
77. `SweepHistoryList` already handled in F2 task (cancelled badge, `N/A` maxRoi).

#### F10: Selective Promotion (US9 — P9)

**File**: `frontend/src/components/optimizer/QuantMatrix.tsx`

78. Add "Re-run with Details" action button to each Leaderboard row.
79. Button calls `onOpenInSingleRun(result)`.
80. Verify `handleOpenInSingleRun` in `OptimizerPage.tsx` passes `enable_wide_events: true`:
    ```typescript
    navigate('/', { state: { prefillConfig: { ...result.config, enable_wide_events: true } } })
    ```
81. Verify `ConfigFormView` reads `location.state.prefillConfig` and populates `enable_wide_events`.
82. Verify `POST /backtests` API forwards `enable_wide_events` to engine stdin JSON.
83. **Tests** (`__tests__/QuantMatrix.test.tsx`): every row has one button; click → `onOpenInSingleRun` called with `enable_wide_events: true`.

#### F11: Layout Wiring (US1, US2)

**Files**: `frontend/src/App.tsx`, `frontend/src/pages/OptimizerPage.tsx`

84. Pass `sweepHistory`, `onSelectSweep`, `onLoadMoreSweeps`, `hasMoreSweeps` as props to `LeftSidebar` from `App.tsx`.
85. Wire those to `useOptimizer` hook state (or lift state to `App.tsx`).
86. `App.tsx` `<main>` flex layout handles width automatically via `LeftSidebar`'s CSS `w-14`/`w-80` transition.

---

## Test Coverage Requirements

Per the Green Light Protocol, all tests must be green before merge.

| Test File | Tests | Covers |
|-----------|-------|--------|
| `core-engine/cmd/engine/main_test.go` | OR truth table (3 rows); absent field → false | FR-025, FR-026 |
| `core-engine/application/orchestrator/batch_test.go` | win rate: 0.75, nil, 1.0 scenarios | FR-010 |
| `core-engine/application/orchestrator/batch_test.go` | first result before all complete | FR-017 |
| `orchestrator/api/tests/sweep-persistence.test.ts` | 10-run persist; cascade delete; run_id mapping | FR-009–FR-013 |
| `orchestrator/api/tests/sweep-service.test.ts` | 3 advanced rules; all-5-keys always present | FR-015, FR-016 |
| `orchestrator/api/tests/optimizer-api.test.ts` | GET /sessions; GET results; DELETE cascade | FR-013 |
| `frontend/__tests__/LeftSidebar.test.tsx` | collapse/expand; sweepHistory in Optimizer mode | US1 AC1–AC6 |
| `frontend/__tests__/SweepHistoryList.test.tsx` | KPI display; empty state; cancelled badge | US2 AC1–AC5 |
| `frontend/__tests__/useOptimizer.test.ts` | throttle ≤8 re-renders / 200 events in 1s | US7 AC1 |
| `frontend/__tests__/useOptimizer.test.ts` | persistenceError flag on SSE event | US3 FR-012b |
| `frontend/__tests__/OptimizerConfigurator.test.tsx` | year buttons; correct ISO dates | US4 AC1–AC5 |
| `frontend/__tests__/QuantMatrix.test.tsx` | Re-run button per row; enable_wide_events:true | US9 AC1–AC5 |

---

## Constitution Check (Post-Design)

| Gate | Status | Evidence |
|------|--------|----------|
| Green Light Protocol | ✅ PASS | 12 new test files / augmented; all must pass before merge |
| Fixed-Point Arithmetic | ✅ PASS | Win rate: integer counters. Pruning: `decimal.js`. `capital_efficiency`: `decimal.js`. DB: `numeric(10,4)`. |
| BDD Acceptance Criteria | ✅ PASS | All 10 user stories traced to specific test tasks above |
| No Live Trading | ✅ PASS | Analytics + persistence + UI. No broker. |
| Clean Architecture | ✅ PASS | Go: domain-only. API: adapter-only. Frontend: UI-only. |
