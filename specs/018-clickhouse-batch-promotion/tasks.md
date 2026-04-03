# Tasks: ClickHouse Batch Promotion & Time-in-Market KPIs

**Input**: Design documents from `specs/018-clickhouse-batch-promotion/`
**Branch**: `018-clickhouse-batch-promotion`
**Total tasks**: 46
**Phases**: Setup (1) → Foundation (3) → US1 (8) → US2 (6) → US3 (7) → US4 (8) → US5+US7 (2) → US6 (3) → US3-cont (4) → Polish (4)

---

## Phase 1: Setup

**Purpose**: ClickHouse DDL table creation — prerequisite for all data-pipeline work.

- [x] T001 Create `sweep_wide_events` ClickHouse table by running DDL from `specs/018-clickhouse-batch-promotion/data-model.md` against local ClickHouse instance

**Checkpoint**: `SELECT 1 FROM sweep_wide_events LIMIT 0` returns no error.

---

## Phase 2: Foundation (Blocking Prerequisites)

**Purpose**: Postgres schema changes that all user stories depend on. Must complete before US1–US7.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 Add `longestTradeDurationMs bigint NOT NULL DEFAULT 0`, `maxSafetyOrdersUsed integer NOT NULL DEFAULT 0`, `promotedAt timestamptz NULL` columns to the `sweepRunSummaries` Drizzle table definition in `orchestrator/api/src/db/schema.ts`
- [x] T003 Create Drizzle migration `orchestrator/api/drizzle/XXXX_018_time_in_market_kpis.sql` with the three `ALTER TABLE` column additions and `CREATE INDEX idx_sweep_run_summaries_session_promoted ON sweep_run_summaries (session_id, promoted_at)`
- [x] T004 Run `npx drizzle-kit migrate` to apply migration, verify columns exist in Postgres

**Checkpoint**: `SELECT longest_trade_duration_ms, max_safety_orders_used, promoted_at FROM sweep_run_summaries LIMIT 0` returns no error.

---

## Phase 3: User Story 1 — Time-in-Market KPI Computation (Priority: P1) 🎯 MVP

**Goal**: Go engine computes `longest_trade_duration_ms` and `max_safety_orders_used` per run; fields persisted to Postgres `sweep_run_summaries`.

**Independent Test**: Run a single backtest with known trade durations and safety-order depths; assert engine JSON result contains exact expected values; assert Postgres row has matching integers.

### Tests for User Story 1

- [x] T005 [P] [core-engine] [US1] Create `core-engine/domain/position/tracker_test.go` with 6 table-driven test cases (three-position max duration, safety order depth max, open-at-end edge case, zero safety orders, no positions, single normal close) — these tests MUST FAIL before implementation

### Implementation for User Story 1

- [x] T006 [core-engine] [US1] Create `core-engine/domain/position/tracker.go` implementing `KpiTracker` struct with `OnPositionClose(openedAtMs, closedAtMs int64, safetyOrdersFilled int)` and `OnBacktestEnd(openedAtMs, lastCandleMs int64, safetyOrdersFilled int)` methods (zero-value struct = correct initial state)
- [x] T007 [core-engine] [US1] Add `LongestTradeDurationMs int64 \`json:"longest_trade_duration_ms"\`` and `MaxSafetyOrdersUsed int \`json:"max_safety_orders_used"\`` fields to `BatchRunResultOutput` struct in `core-engine/cmd/engine/main.go`
- [x] T008 [core-engine] [US1] Wire `KpiTracker` into the batch run loop in `core-engine/cmd/engine/main.go`: instantiate per run, call `OnPositionClose` on each position close event, call `OnBacktestEnd` for any open position at candle loop end, emit final values in `BatchRunResultOutput`
- [x] T009 [orchestrator] [US1] Extend `persistRunSummary()` in `orchestrator/api/src/services/SweepPersistence.ts` to write `longestTradeDurationMs` and `maxSafetyOrdersUsed` from the engine result (set `promotedAt` to `null` for normal sweeps). **Note**: T031 (Phase 6) extends this same function — design with a `fromPromotion?: boolean` flag or a separate `persistPromotedRunSummary()` wrapper to avoid a retrofit conflict when T031 is implemented.
- [x] T010 [orchestrator] [US1] Extend `GET /optimizer/session/:sessionId/summaries` response in `orchestrator/api/src/routes/optimizer.routes.ts` to include `longest_trade_duration_ms`, `max_safety_orders_used`, and `promoted_at` per summary row
- [x] T011 [core-engine] [US1] Run `go test ./domain/position/...` in `core-engine/` and confirm all 6 tracker tests pass
- [x] T012 [orchestrator] [US1] Run `npx jest` in `orchestrator/api/` and confirm existing test suite still green after schema + persistence changes

**Checkpoint**: `go test ./...` green. A single engine run returns `longest_trade_duration_ms` and `max_safety_orders_used` in the JSON result and both are persisted in Postgres.

---

## Phase 4: User Story 2 — Leaderboard Time-in-Market Columns & Filtering (Priority: P2)

**Goal**: Leaderboard displays "Longest Trade" (human-readable) and "Max SOs Used" columns, both sortable and filterable.

**Independent Test**: Load a completed sweep with known Time-in-Market values; verify both columns render with correct formatting; confirm sort and filter operations produce correct row ordering and subset.

### Tests for User Story 2

- [x] T013 [P] [orchestrator] [US2] Add frontend unit test in `frontend/src/__tests__/formatters.test.ts` for `msDuration()`: 180,000,000ms → "2d 2h 0m"; 3,600,000ms → "1h 0m"; 59,000ms → "0m"; 0ms → "0m"

### Implementation for User Story 2

- [x] T014 [P] [orchestrator] [US2] Create (or extend) `frontend/src/components/formatters.ts` with `msDuration(ms: number): string` formatter (days/hours/mins breakdown, filter falsy parts except final "0m")
- [x] T015 [orchestrator] [US2] Add `longest_trade_duration_ms` column definition to TanStack Table in `frontend/src/components/LeaderboardGrid.tsx`: header "Longest Trade", cell renders `msDuration(value)`, `enableSorting: true`, `enableColumnFilter: true`
- [x] T016 [orchestrator] [US2] Add `max_safety_orders_used` column definition to `frontend/src/components/LeaderboardGrid.tsx`: header "Max SOs Used", cell renders integer, `enableSorting: true`, `enableColumnFilter: true`
- [x] T017 [orchestrator] [US2] Update `SweepRunSummary` TypeScript interface (in `frontend/src/services/optimizerService.ts` or shared types file) to include `longest_trade_duration_ms: number`, `max_safety_orders_used: number`, `promoted_at: string | null`
- [x] T018 [orchestrator] [US2] Run `npx jest` in `frontend/` and confirm formatter tests pass; verify columns render correctly in dev environment

**Checkpoint**: Both columns visible in Leaderboard, sortable by header click, filterable; `msDuration` formatter tested and passing.

---

## Phase 5: User Story 3 — Multi-Row Selection & Batch Promote Action (Priority: P3)

**Goal**: Leaderboard gains checkbox selection; bulk action toolbar with "Batch Promote to ClickHouse" button appears when rows are selected; button POSTs selected `run_id`s to the API.

**Independent Test**: Render a completed Leaderboard with 100 rows; select 5 rows via checkboxes; verify toolbar appears with count; verify POST fires with exactly those 5 `run_id`s.

### Tests for User Story 3

- [x] T046 [P] [orchestrator] [US3] Create `frontend/src/__tests__/LeaderboardGrid.selection.test.tsx` with 4 component tests: (1) selecting 3 rows sets selection count to 3 and toolbar shows "3 selected"; (2) "Batch Promote to ClickHouse" button is disabled when no rows selected, enabled when ≥1 selected; (3) header "select all" checkbox selects all currently visible (filtered) rows; (4) `clearSelection()` resets count to 0 and hides toolbar — these tests MUST FAIL before T019/T020/T022 are implemented

### Implementation for User Story 3

- [x] T019 [P] [orchestrator] [US3] Add `selectedRunIds: Set<string>`, `toggleRunSelection(runId)`, `selectAll()`, `clearSelection()` state to `frontend/src/hooks/useOptimizer.ts`
- [x] T020 [orchestrator] [US3] Add checkbox column (position 0) to `frontend/src/components/LeaderboardGrid.tsx`: header checkbox selects/deselects all visible rows, row checkbox toggles individual row via `toggleRunSelection`
- [x] T021 [orchestrator] [US3] Add `promoted_at` column (badge cell) to `frontend/src/components/LeaderboardGrid.tsx`: renders "↑ CH" badge if `promoted_at` is non-null, blank otherwise; persists from API data across page reloads
- [x] T022 [orchestrator] [US3] Add bulk action toolbar to `frontend/src/components/LeaderboardGrid.tsx` (or its parent page): visible when `selectedRunIds.size > 0`, displays "N selected" count, "Batch Promote to ClickHouse" button enabled; hidden or button disabled when selection is empty
- [x] T023 [orchestrator] [US3] Add `postPromote(sessionId: string, runIds: string[]): EventSource` to `frontend/src/services/optimizerService.ts` that POSTs `{ run_ids }` to `POST /optimizer/session/:sessionId/promote` and returns SSE stream
- [x] T024 [orchestrator] [US3] Wire "Batch Promote to ClickHouse" button in the toolbar to call `startPromotion(sessionId, [...selectedRunIds])` in `useOptimizer.ts`; clear selection on promotion start. **⚠️ Depends on T039 (Phase 9)** — `startPromotion()` is defined there. Implement T039's hook additions before this task to avoid TypeScript compile errors.

**Checkpoint**: All 4 T046 selection tests pass; selecting rows shows toolbar; clicking button fires POST to API; selection state persists independently of sort/filter state.

---

## Phase 6: User Story 4 — Mini-Sweep Engine Execution with ClickHouse Insertion (Priority: P4)

**Goal**: API receives `run_ids`, retrieves configs from Postgres server-side, spawns Go engine mini-sweep with `wide_events_to_stdout: true`, streams wide events to ClickHouse, streams SSE progress to caller.

**Independent Test**: POST to promote API with 3 `run_id`s; assert engine runs 3 backtests with wide events enabled; query ClickHouse → `sweep_wide_events` contains rows for all 3 `run_id`s under correct `session_id` partition.

### Tests for User Story 4

- [x] T025 [P] [orchestrator] [US4] Create `orchestrator/api/src/__tests__/clickhouse-wide-event-writer.test.ts` with 4 Jest tests: (1) push 999 rows → no flush; push 1 more → auto-flush; (2) push 1,500 → exactly 1 batch of 1,000 flushed, 500 remain; (3) `bulkDeleteBeforeInsert(['id-1','id-2','id-3'])` → `chClient.command` called exactly ONCE (never per-run loop); (4) flush-on-exit: 350 buffered → `flush()` → `chClient.insert` called with 350 rows
- [x] T026 [P] [orchestrator] [US4] Create `orchestrator/api/src/__tests__/promote.route.test.ts` with 4 Jest tests: (1) POST /promote while `activePromotions.has(sessionId)` → 409; (2) POST /promote with 201 run_ids → 400; (3) POST /promote with 5 valid run_ids → SSE stream emits `promotion_progress` then `promotion_complete`; (4) POST /promote where 1 of 3 engine runs errors → `promotion_error` SSE emitted for that run, remaining 2 runs complete, stream does NOT close early (covers FR-024 non-blocking error handling)

### Implementation for User Story 4

- [x] T027 [core-engine] [US4] Add `WideEventsToStdout *bool \`json:"wide_events_to_stdout,omitempty"\`` field to `EngineRequest` struct in `core-engine/cmd/engine/main.go`
- [x] T028 [core-engine] [US4] Implement stdout wide-event streaming mode in `core-engine/cmd/engine/main.go`: when `WideEventsToStdout == true`, emit each wide event as `{"type":"wide_event","run_id":"<uuid>",...WideEvent fields}\n` to `os.Stdout`; skip `.jsonl` temp file for this mode; continue emitting `{"type":"run_result",...}` line per run as before
- [x] T029 [orchestrator] [US4] Create `orchestrator/api/src/services/ClickHouseWideEventWriter.ts` implementing `push(row)` (auto-flush at 1,000), `flush()` (flush remaining buffer), `bulkDeleteBeforeInsert(sessionId, runIds)` (single `IN(...)` mutation, noop if empty), private `insertBatch(rows)` using existing `chClient`
- [x] T030 [orchestrator] [US4] Implement `POST /optimizer/session/:sessionId/promote` route in `orchestrator/api/src/routes/optimizer.routes.ts` following the 14-step B-4 protocol: validate session/run_ids/cap/concurrency → SSE headers → bulk pre-delete → server-side config retrieval → spawn engine with `wide_events_to_stdout:true` → stdout line parsing → flush-on-exit → `promotion_complete` SSE → activePromotions map management
- [x] T031 [orchestrator] [US4] Extend `persistRunSummary()` in `orchestrator/api/src/services/SweepPersistence.ts` to set `promotedAt = new Date()` when called from the promotion workflow (pass a `fromPromotion: boolean` flag or separate method)
- [x] T032 [orchestrator] [US4] Run `npx jest` in `orchestrator/api/` confirming all 7 new tests (T025 + T026) pass

**Checkpoint**: POST /promote with 3 valid `run_id`s → SSE streams progress → ClickHouse `sweep_wide_events` count > 0 for those `run_id`s → Postgres `promoted_at` non-null for those rows.

---

## Phase 7: User Story 5 — Duplicate Guard & User Story 7 — Dual-Database Cleanup (Priority: P5 / P7)

**Goal (US5)**: Re-promoting already-promoted runs deletes their existing ClickHouse rows first via single `IN(...)` bulk mutation before re-inserting. **Goal (US7)**: Deleting a session cascades to drop the ClickHouse partition.

**Independent Test (US5)**: Promote 3 runs; re-promote same 3 runs; query ClickHouse count before and after — count stays the same (no duplicates). **Independent Test (US7)**: Promote a run for session X; delete session X; query ClickHouse `WHERE session_id='X'` → 0 rows.

### Implementation for User Story 5 & 7

- [x] T033 [orchestrator] [US5] Verify `bulkDeleteBeforeInsert()` in `ClickHouseWideEventWriter.ts` (implemented in T029) is called from the promotion route (T030) before engine spawn when any `run_id` in the batch has non-null `promoted_at` in Postgres — no additional implementation needed if T029/T030 wired correctly; add targeted smoke test confirming single mutation call via `chClient.command` call count assertion
- [x] T034 [orchestrator] [US7] Extend `DELETE /optimizer/session/:sessionId` handler in `orchestrator/api/src/routes/optimizer.routes.ts` to execute `ALTER TABLE sweep_wide_events DROP PARTITION '<session_id>'` against ClickHouse after the Postgres cascade delete; ClickHouse errors are caught, logged as warning, and do NOT block or reject the response. **Guard**: check `activePromotions.has(sessionId)` before proceeding — if a promotion is active for this session, cancel it (SIGTERM) or return 409 to prevent orphaned ClickHouse data from a half-completed promotion.

**Checkpoint (US5)**: Re-promotion produces identical ClickHouse row count (no duplication). **Checkpoint (US7)**: Session deletion leaves zero ClickHouse rows for that `session_id`.

---

## Phase 8: User Story 6 — Grafana Dynamic Dropdowns (Priority: P6)

**Goal**: New Grafana dashboard `04-sweep-promoted-comparison.json` with chained `session`/`run_config` template variables and 4 panels (equity curve, drawdown timeline, event distribution, safety order depth heatmap).

**Independent Test**: Open Grafana; session dropdown populates from ClickHouse; selecting a session populates run_config dropdown; selecting a run_config renders data in all 4 panels.

### Implementation for User Story 6

- [x] T035 [P] [orchestrator] [US6] Create `grafana/dashboards/04-sweep-promoted-comparison.json` with two template variables: `session` (query `SELECT DISTINCT session_id FROM sweep_wide_events ORDER BY session_id`) and `run_config` (query `SELECT DISTINCT run_id FROM sweep_wide_events WHERE session_id = '${session}' ORDER BY run_id`), both using ClickHouse datasource
- [x] T036 [orchestrator] [US6] Add 4 panels to `grafana/dashboards/04-sweep-promoted-comparison.json`: (1) Equity Curve time series — `running_account_balance` over `timestamp` WHERE `session_id='${session}' AND run_id IN (${run_config})`; (2) Drawdown Timeline — `current_drawdown_pct` over `timestamp`; (3) Event Distribution bar chart — `count(*) GROUP BY event_type, run_id`; (4) Safety Order Depth heatmap — `filled_orders_count` distribution per `run_id`
- [x] T037 [orchestrator] [US6] Provision new dashboard by rebuilding Grafana container: `docker-compose up -d --build grafana`; verify dashboard loads and template variable dropdowns function with a seeded promoted run

**Checkpoint**: Grafana `04-sweep-promoted-comparison` dashboard visible; both dropdowns populate; all 4 panels render data when a session and run_config are selected.

---

## Phase 9: Batch Promotion UI — Progress & Cancellation (Priority: P3 continuation)

**Goal**: `BatchPromotionPanel` component shows SSE progress, cancel button, promoted badges, and error accumulation.

**Independent Test**: Trigger a promotion; verify panel appears with progress bar; click Cancel; verify `promotion_cancelled` event received and panel dismisses; verify partial promoted rows retain badges.

### Implementation

- [x] T038 [orchestrator] [US3] Create `frontend/src/components/BatchPromotionPanel.tsx`: progress bar driven by `promotion_progress` SSE events ("Promoting N/M configs..."), "Cancel Promotion" button calling `cancelPromotion(sessionId)`, dismiss on `promotion_complete` / `promotion_cancelled`, collapsible error list for `promotion_error` events
- [x] T039 [orchestrator] [US3] Add `promotionStatus: BatchPromotionStatus | null`, `startPromotion(sessionId, runIds)` (opens SSE, drives status), `cancelPromotion(sessionId)` (calls `DELETE /optimizer/session/:id/promote`) to `frontend/src/hooks/useOptimizer.ts`
- [x] T040 [orchestrator] [US3] Implement `DELETE /optimizer/session/:sessionId/promote` route in `orchestrator/api/src/routes/optimizer.routes.ts`: send SIGTERM to active promotion child in `activePromotions` map; emit `promotion_cancelled` SSE event; remove from map
- [x] T041 [orchestrator] [US3] After `promotion_complete` SSE received in `useOptimizer.ts`, re-fetch summaries from `GET /optimizer/session/:sessionId/summaries` to update `promoted_at` badges across all Leaderboard rows

**Checkpoint**: Promotion panel renders progress; cancel mid-promotion works; badges update after completion and persist on page reload.

---

## Phase 10: Polish & Validation

- [x] T042 [P] Run `go test ./...` in `core-engine/` — confirm all tests green including T005/T006/T011
- [x] T043 [P] Run `npx jest` in `orchestrator/api/` — confirm all tests green including T025/T026/T032
- [x] T044 [P] Run quickstart.md end-to-end smoke test: DDL → migration → single promotion → ClickHouse count verification → session delete → partition drop verification
- [x] T045 Run full Playwright MCP E2E suites (Suites 1–5 from plan.md Phase E-3): full workflow, duplicate guard, session deletion dual-DB, Grafana dropdowns, cancellation — each with direct DB verification

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** (Setup): No dependencies — create ClickHouse table first
- **Phase 2** (Foundation): Depends on Phase 1 — adds Postgres columns; **BLOCKS** Phases 3–9
- **Phase 3** (US1 — KPI computation): Depends on Phase 2 — **MVP deliverable**
- **Phase 4** (US2 — Leaderboard columns): Depends on Phase 3 (needs `longest_trade_duration_ms` / `max_safety_orders_used` in API response)
- **Phase 5** (US3 — Selection & action): Depends on Phase 2 only — can run parallel to Phase 4
- **Phase 6** (US4 — Mini-sweep + ClickHouse): Depends on Phase 3 (KPI persistence) and Phase 5 (promotion button)
- **Phase 7** (US5+US7 — Duplicate guard + deletion): Depends on Phase 6 (promotion route must exist)
- **Phase 8** (US6 — Grafana): Depends on Phase 6 (data must exist in ClickHouse) — can run parallel to Phase 7
- **Phase 9** (Promotion Panel + Cancel): Depends on Phase 6 (SSE stream must exist) and Phase 5 (state hooks)
- **Phase 10** (Polish): Depends on all phases complete

### Parallel Opportunities Per Phase

**Phase 2**: T002 (schema) → then T003 (migration) → then T004 (run migration) — sequential within phase  
**Phase 3**: T005 (write test) can run in parallel with T006 (implementation skeleton)  
**Phase 4**: T013 (formatter test) + T014 (formatter impl) in parallel  
**Phase 5**: T046 (test) + T019 (hook state) in parallel; T020 (checkbox column) can start alongside T019  
**Phase 6**: T025 (writer test) + T026 (route test) in parallel; T027 (Go field) + T029 (TS writer) in parallel  
**Phase 8**: T035 (dashboard JSON + variables) in parallel with Phase 7  
**Phase 10**: T042 + T043 + T044 in parallel

### User Story Independence

- **US1 (P1)**: Fully standalone — Go engine + Postgres persistence only. No ClickHouse dependency.
- **US2 (P2)**: Depends on US1 API fields being in summaries response. Frontend-only change otherwise independent.
- **US3 (P3)**: Selection state independent of US1/US2. Promote button needs US4 API to actually work.
- **US4 (P4)**: Needs US1 KPI wiring complete (Phase 3). The main data-pipeline story.
- **US5 (P5)**: Duplicate guard is internal to the US4 promotion route — it's a correctness guarantee, not a separate feature. T033 is a verification task only.
- **US6 (P6)**: Fully independent once ClickHouse has data. Grafana JSON is static config.
- **US7 (P7)**: Session deletion extension is independent — single method addition to existing DELETE handler.

### MVP Scope

**Minimum viable delivery = Phases 1–3** (T001–T012):
- ClickHouse table created
- Postgres columns migrated
- Go engine emits KPIs
- KPIs persisted and returned in summaries API

Everything else builds on top of this foundation.
