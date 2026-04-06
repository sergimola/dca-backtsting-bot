# Tasks: Engine Stop-Loss Mechanism

**Input**: Design documents from `specs/019-engine-stop-loss/`  
**Branch**: `019-engine-stop-loss`  
**Total tasks**: 42  
**Phases**: Setup (1) → Foundation (5) → US1+US2 (12) → US3 (4) → US4 (6) → US5 (7) → US6 (4) → Polish (3)

---

## Phase 1: Setup

**Purpose**: Verify Green Light Protocol — all existing tests must be green before any changes.

- [X] T001 Run `go test ./...` in `core-engine/` and confirm all tests pass (Green Light Protocol gate — MUST be green before writing any code)

**Checkpoint**: Zero test failures in Go test suite.

---

## Phase 2: Foundation (Blocking Prerequisites)

**Purpose**: Core domain structs, events, and config — everything US1–US6 depends on. Must complete before any user-story work.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Add 4 SL fields to `Config` struct in `core-engine/domain/config/config.go`: `stopLossEnabled bool`, `stopLossPercent decimal.Decimal`, `stopLossBaseline string`, `stopLossTimeoutMinutes int` — with canonical defaults (`false`, `0`, `"average_entries"`, `0`), `With*` functional options, validation in `Validate()` (when enabled: percent > 0 and ≤ 100; baseline in `["first_entry","average_entries"]`; timeout ≥ 0), and `configJSON` struct + `ToJSON()`/`FromJSON()` coverage
- [X] T003 [P] Add 6 SL runtime fields to `Position` struct in `core-engine/domain/position/position.go`: `StopLossEnabled bool`, `StopLossPercent decimal.Decimal`, `StopLossBaseline string`, `StopLossTimeoutMinutes int`, `SlTriggerPrice decimal.Decimal`, `SlBreachTimestamp time.Time` (value type, not pointer — avoids heap escape in the hot candle loop; zero value `time.Time{}` means no active breach; check with `.IsZero()`)
- [X] T004 [P] Add `StopLossExecutedEvent` struct to `core-engine/domain/position/events.go`: fields `RunID`, `TradeID`, `Timestamp`, `TradingPair`, `ExecutionPrice string`, `Size string`, `RealizedLoss string`, `Fee string`; `EventType()` returns `"stop_loss.executed"`; add `"stop_loss"` as a comment on `TradeClosedEvent.Reason`
- [X] T005 Create Drizzle migration `orchestrator/api/drizzle/0005_019_stop_loss_kpis.sql` with `ALTER TABLE "sweep_run_summaries" ADD COLUMN "total_stops_triggered" integer DEFAULT 0 NOT NULL`
- [X] T006 Add `totalStopsTriggered: integer('total_stops_triggered').notNull().default(0)` to `sweepRunSummaries` table in `orchestrator/api/src/db/schema.ts` and run `npm run db:migrate` in `orchestrator/api/` to apply the migration

**Checkpoint**: `go build ./...` in `core-engine/` succeeds. `SELECT total_stops_triggered FROM sweep_run_summaries LIMIT 0` returns no error.

---

## Phase 3: User Story 1 & 2 — Immediate & Timeout Stop-Loss Execution (Priority: P1) 🎯 MVP

**Goal**: Engine evaluates SL trigger on every candle's Low. On breach with timeout=0, closes position immediately at candle.Close. On breach with timeout>0, tracks elapsed time and closes only after sustained breach. Breach resets if price recovers above trigger.

**Story Goal (US1)**: A position with `stop_loss_enabled=true, timeout=0` closes at the breaching candle's Close. Re-entry evaluates on the next candle.  
**Story Goal (US2)**: A position with `timeout>0` only closes after the breach persists for the full timeout duration. Price recovery clears the breach.

**Independent Test (US1)**: Single backtest, one candle with Low ≤ SL trigger, timeout=0. Verify: position closes at that candle's Close; `total_stops_triggered=1`; account balance decreases by loss + taker fee.  
**Independent Test (US2)**: Candle sequence: breach, recovery at T+30 (no stop), breach again at T+45, stop fires at T+105 (60 min from second breach).

### Tests for User Story 1 & 2

- [X] T007 [US1] [US2] Create `core-engine/domain/position/stop_loss_test.go` with the following BDD test functions (all MUST FAIL red before T008–T011):
  - `TestSL_ImmediateExecution_T001`: entry=$100, SL=5%, timeout=0, candle Low=$94.50 → position closes at candle.Close
  - `TestSL_TimeoutExecution_T002`: timeout=60min, 61 candles all below trigger → stop fires on candle 61's Close
  - `TestSL_TimeoutReset_T003`: breach at T+0, Low=$95.50 at T+30 (recovery) → no stop; second breach at T+45 held 60min → stop fires
  - `TestSL_TPWinsDuringSLTimeout_T006`: active breach, TP condition met → TP executes, `SlBreachTimestamp.IsZero() == true`, no stop
  - `TestSL_ExitOnLastOrderOverride_T007`: **[FR-023]** `stop_loss_enabled=true` + `exitOnLastOrder=true` with all SOs filled → position does NOT close on last-order logic; SL governs exit. `stop_loss_enabled=false` + `exitOnLastOrder=true` → original early-exit behavior preserved
  - `TestSL_OpeningCandle_T008`: **[FR-024]** base order fills at candle Open; same candle's Low ≤ SL trigger → SL evaluates (timeout=0: closes immediately; timeout>0: breach timestamp set). Verifies pessimistic order on position-opening candle
  - `TestSL_Disabled_Regression_T009`: `stop_loss_enabled=false` → identical result to pre-feature; no SL evaluation
  - `TestSL_CanonicalTrigger_T010`: entry=$100, SL%=5, baseline=`first_entry` → trigger=`95.00000000`; verify via `decimal.Equal`

### Implementation for User Story 1 & 2

- [X] T008 [US1] [US2] In `core-engine/domain/position/minute_loop.go` — add `exitOnLastOrder` guard: wrap the early-exit block condition with `pos.ExitOnLastOrder && !pos.StopLossEnabled` so that when SL is enabled the early-exit logic is suppressed
- [X] T009 [US1] [US2] In `core-engine/domain/position/minute_loop.go` — add Step 3c.5 between liquidation check and take-profit check:
  - If `pos.StopLossEnabled && pos.SlTriggerPrice.IsPositive()` and `candle.Low.LessThanOrEqual(pos.SlTriggerPrice)`:
    - If `pos.StopLossTimeoutMinutes == 0`: execute stop immediately — emit `StopLossExecutedEvent` + `TradeClosedEvent(reason="stop_loss")`, reset position to idle, RETURN
    - If `pos.StopLossTimeoutMinutes > 0` and `pos.SlBreachTimestamp.IsZero()`: record `candle.Timestamp` in `pos.SlBreachTimestamp`
    - If `pos.StopLossTimeoutMinutes > 0` and `!pos.SlBreachTimestamp.IsZero()` and `candle.Timestamp.Sub(pos.SlBreachTimestamp) >= timeout`: execute stop, emit events, reset to idle, RETURN
  - If SL enabled and `candle.Low.GreaterThan(pos.SlTriggerPrice)` and `!pos.SlBreachTimestamp.IsZero()`: clear `pos.SlBreachTimestamp = time.Time{}` (recovery)
- [X] T010 [US1] [US2] In `core-engine/domain/position/minute_loop.go` — at the start of Step 3d (take-profit check): clear `pos.SlBreachTimestamp = time.Time{}` so an active SL timeout is cancelled when TP executes
- [X] T011 [US1] In `core-engine/application/orchestrator/orchestrator.go` — after `position.NewPosition(...)`, copy 4 SL config fields to pos (`StopLossEnabled`, `StopLossPercent`, `StopLossBaseline`, `StopLossTimeoutMinutes`); for `first_entry` mode, compute `pos.SlTriggerPrice = openPrice.Mul(one.Sub(pct.Div(hundred)))` immediately at position open; for `average_entries` leave `SlTriggerPrice` zero (minute_loop Step 3b sets it after first fill)
- [X] T012 [US1] [US2] In `cmd/engine/main.go` — add 4 SL fields to `EngineRequest` struct (`stop_loss_enabled bool`, `stop_loss_percent string`, `stop_loss_baseline string`, `stop_loss_timeout_minutes int`); map them to `With*` config options when constructing `domainconfig.Config`
- [X] T013 [US1] [US2] In `cmd/engine/aggregator.go` — count `stopLossCount int` and `takeProfitCount int` by checking `TradeClosedEvent.Reason == "stop_loss"` and `== "take_profit"` respectively; compute `winRate decimal.Decimal` using `decimal.NewFromInt(int64(takeProfitCount)).Div(decimal.NewFromInt(int64(takeProfitCount + stopLossCount))).Round(8)` (return `decimal.Zero` when both zero — constitution MUST: quantitative calculations use fixed-point arithmetic); expose counts and `winRate` via `aggregationResult`
- [X] T014 [US1] [US2] In `cmd/engine/main.go` — add `TotalStopsTriggered int \`json:"total_stops_triggered"\`` and `TotalTakeProfits int \`json:"total_take_profits"\`` to `EngineResultPayload` (note: `total_take_profits` is **ephemeral** — NOT persisted to Postgres; it exists in the engine payload only for win rate verification and is not written to `sweep_run_summaries`); add `WinRate float64 \`json:"winRate"\`` to `PnlSummaryOutput` — populated via `aggregationResult.winRate.InexactFloat64()` (decimal-computed in T013, converted to float64 **only** at this JSON serialization boundary); wire all values from `aggregationResult`
- [X] T015 [US1] [US2] Run `go test ./domain/position/... -run TestSL` in `core-engine/` and confirm all 8 stop-loss tests pass (T007 tests now green)
- [X] T016 [US1] [US2] Run `go test ./...` in `core-engine/` and confirm full Go test suite is still green (regression check)
- [X] T017 [US1] [US2] Build the engine binary: `go build -o '../orchestrator/api/core-engine.exe' ./cmd/engine/` from `core-engine/` and verify exit 0
- [X] T018 [US1] Smoke-test the engine manually: pipe `test-sl-immediate.json` (stop_loss_enabled=true, timeout=0, small date range) to `core-engine.exe` and confirm result JSON includes `total_stops_triggered`, `total_take_profits`, `winRate` fields with non-placeholder values

**Checkpoint**: All Go tests green. Engine binary builds. Manual smoke test shows SL fields in result payload.

---

## Phase 4: User Story 3 — SL Trigger Price Modes (Priority: P2)

**Goal**: `first_entry` mode holds trigger fixed from base order price. `average_entries` mode recalculates trigger after each SO fill. Breach resets if recalculated trigger drops below current Low.

**Independent Test**: Two backtests with identical candle data — one per baseline mode. `first_entry` run triggers stop before `average_entries` run when multiple SOs have filled.

### Tests for User Story 3

- [X] T019 [US3] Add to `stop_loss_test.go` in `core-engine/domain/position/`:
  - `TestSL_FirstEntryBaseline_T004`: entry=$100, SL=5%, 2 SOs filled (avg=$96.50), baseline=`first_entry` → trigger stays `95.00000000`
  - `TestSL_AverageEntriesBaseline_T005`: entry=$100, SL=5%, SO1 fills (avg=$97.00), baseline=`average_entries` → trigger updates to `92.15000000`; SO2 fills (avg=$93.00) → trigger updates to `88.35000000`

### Implementation for User Story 3

- [X] T020 [US3] In `core-engine/domain/position/minute_loop.go` — add to Step 3b (after SO fills): if `pos.StopLossBaseline == "average_entries"`, recompute `pos.SlTriggerPrice = pos.AverageEntryPrice.Mul(one.Sub(pos.StopLossPercent.Div(hundred)))`; if `!pos.SlBreachTimestamp.IsZero()` and new trigger is now < candle.Low (recovery due to SO fill), clear `pos.SlBreachTimestamp = time.Time{}`
- [X] T021 [US3] Run `go test ./domain/position/... -run "TestSL_FirstEntry|TestSL_Average"` and confirm T004 + T005 pass
- [X] T022 [US3] Run `go test ./...` in `core-engine/` for full regression check

**Checkpoint**: Both baseline modes compute exact decimal trigger values matching canonical test vectors.

---

## Phase 5: User Story 4 — Win Rate & KPI Reporting (Priority: P2)

**Goal**: Win Rate in Postgres `sweep_run_summaries` accounts for SL losses. Leaderboard displays `total_stops_triggered` as a sortable, filterable column.

**Independent Test**: Complete a backtest producing 8 TPs and 2 SLs; verify win rate = 80% and `total_stops_triggered = 2` in the API response and the Leaderboard row.

### Tests for User Story 4

- [X] T023 [P] [US4] In `core-engine/`, add aggregator unit tests to `cmd/engine/aggregator_test.go` (or create it):
  - 10 TPs + 3 SLs → `winRate = 0.7692...`, `stopLossCount = 3`, `takeProfitCount = 10`
  - 5 TPs + 0 SLs → `winRate = 1.0`
  - 0 TPs + 0 SLs → `winRate = 0.0` (not NaN / not a division by zero panic)

### Implementation for User Story 4

- [X] T024 [US4] In `orchestrator/api/src/types/index.ts` — add `total_stops_triggered: number` and `total_take_profits: number` to `EngineResultLine` (or equivalent engine output type); ensure `StoredPnlSummary.winRate` is typed as `number` (add if missing)
- [X] T025 [US4] In `orchestrator/api/src/services/SweepPersistenceService.ts` — map `engineResult.total_stops_triggered` → `totalStopsTriggered` when inserting or updating `sweepRunSummaries`
- [X] T026 [US4] In `frontend/src/components/LeaderboardGrid.tsx` (or equivalent) — add `total_stops_triggered` column: header "Stops", integer cell renderer, `enableSorting: true`, `enableColumnFilter: true`
- [X] T027 [US4] Update the leaderboard row type in `frontend/src/services/types.ts` (the canonical frontend type file; currently has `winRate: number` around line 129) to include `total_stops_triggered: number`
- [X] T028 [US4] Run aggregator unit tests (`go test ./cmd/engine/...`) and confirm win-rate tests pass; run `npx jest` in `frontend/` and confirm Leaderboard column snapshot/unit tests pass

**Checkpoint**: `total_stops_triggered` persisted in Postgres and visible in Leaderboard as a sortable column.

---

## Phase 6: User Story 5 — Optimizer UI: SL Configuration & Sweepability (Priority: P2)

**Goal**: Configurator form exposes all 4 SL parameters. `stop_loss_percent` and `stop_loss_timeout_minutes` are sweepable (fixed/range/array). `stop_loss_baseline` is a non-sweepable dropdown. When SL is disabled, the 3 child fields are hidden.

**Independent Test**: Toggle `stop_loss_enabled` on → child fields appear. Set `stop_loss_percent` to range [3,5,8,10] and `stop_loss_timeout_minutes` to [0,60,120] → sweep generates 12 permutations; all run without error.

### Tests for User Story 5

- [X] T029 [P] [US5] Add frontend unit tests for the SL section in the Configurator (in `frontend/src/__tests__/` or co-located):
  - Toggle `stop_loss_enabled` off → SL child fields NOT rendered
  - Toggle `stop_loss_enabled` on → SL child fields rendered
  - `stop_loss_baseline` dropdown shows exactly `["first_entry","average_entries"]` and has no sweep mode controls
  - `stop_loss_percent` shows sweep mode controls (fixed/range/array)

### Implementation for User Story 5

- [X] T030 [US5] In `orchestrator/api/src/types/index.ts` — add 4 SL fields to `ApiSweepRunConfig` (or equivalent sweep config type): `stop_loss_enabled?: boolean`, `stop_loss_percent?: string | SweepParam`, `stop_loss_baseline?: "first_entry" | "average_entries"`, `stop_loss_timeout_minutes?: number | SweepParam`
- [X] T031 [US5] In the Optimizer Configurator React component (`frontend/src/components/OptimizerConfigurator.tsx` or equivalent) — add:
  - `stop_loss_enabled` toggle switch (boolean, not sweepable)
  - Conditional section (visible only when enabled):
    - `stop_loss_percent`: numeric field with sweep mode selector (fixed/range/array)
    - `stop_loss_baseline`: dropdown with `["first_entry","average_entries"]`, NO sweep mode selector
    - `stop_loss_timeout_minutes`: numeric field with sweep mode selector (fixed/range/array)
- [X] T032 [US5] In `orchestrator/api/src/services/SweepService.ts` (the `buildCartesianProduct` / `calculateCombinationCount` functions) and `orchestrator/api/src/types/optimizer.ts` (the `FixedParams` interface) — add `stop_loss_percent` and `stop_loss_timeout_minutes` as sweepable `SweepParameter` name values; add `stop_loss_enabled` and `stop_loss_baseline` to `FixedParams` as non-sweepable fixed fields; verify with `SweepService.test.ts` that a sweep with `stop_loss_percent` range [3,5,8] × `stop_loss_timeout_minutes` [0,60] produces 6 permutations
- [X] T033 [US5] In `orchestrator/api/src/services/SweepPersistenceService.ts` — ensure `stop_loss_*` fields from the sweep config are included in `configJson` stored in `sweepRunSummaries` (they should flow automatically if config is stored verbatim, but verify)
- [X] T034 [US5] Run `npx jest` in `frontend/` with `--testPathPatterns="Configurator|StopLoss"` and confirm toggle tests pass; manually verify in dev environment that 12-permutation sweep launches without errors
- [X] T035 [US5] Run `npx jest` in `orchestrator/api/` and confirm no regressions in sweep expansion tests

**Checkpoint**: Configurator shows/hides SL fields correctly. Sweep permutations expand for `stop_loss_percent` and `stop_loss_timeout_minutes`.

---

## Phase 7: User Story 6 — Wide Events: Stop-Loss Events in ClickHouse (Priority: P3)

**Goal**: When a stop-loss executes, the wide-event enricher emits a `position_closed` wide event with `close_reason = "stop_loss"`. This allows Grafana to plot SL events on equity curves.

**Independent Test**: Promote a run with stop-losses to ClickHouse. Query `WHERE event_type = 'position_closed' AND close_reason = 'stop_loss'` — count matches `total_stops_triggered`.

### Tests for User Story 6

- [X] T036 [P] [US6] In `core-engine/application/orchestrator/wide_event_enricher_test.go` (or create) — add test: when enricher processes a `TradeClosedEvent` with `Reason="stop_loss"`, the emitted `WideEvent` has `CloseReason = "stop_loss"` and correct `ActionPrice`, `ActionFee`, `RealizedPnl` fields

### Implementation for User Story 6

- [X] T037 [US6] In `core-engine/application/orchestrator/wide_event_enricher.go` (or `wide_event.go`) — ensure the enricher handles `StopLossExecutedEvent`: extract `ExecutionPrice`, `Size`, `RealizedLoss`, `Fee` and map to `WideEvent.ActionPrice`, `ActionQuantity`, `RealizedPnl`, `ActionFee`; set `CloseReason = "stop_loss"` on the companion `TradeClosedEvent` wide event
- [X] T038 [US6] In `core-engine/application/orchestrator/types.go` — add `EventTypeStopLossExecuted EventType = "stop_loss.executed"` constant for use by the event bus and enricher (value MUST match the `"stop_loss.executed"` string returned by `StopLossExecutedEvent.EventType()` defined in T004; a mismatch would cause the enricher to silently miss all SL events)
- [X] T039 [US6] Run `go test ./application/orchestrator/...` and confirm wide event enricher tests pass; promote a test run to ClickHouse and verify `SELECT count(*) FROM sweep_wide_events WHERE close_reason = 'stop_loss'` matches expected stop count

**Checkpoint**: ClickHouse contains `position_closed` rows with `close_reason = 'stop_loss'` for promoted runs that have SL activity.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Goal**: End-to-end validation, documentation, and clean-up.

- [X] T040 [P] Run `go test ./...` in `core-engine/` — must be 100% green; run `npx jest` in both `orchestrator/api/` and `frontend/` — must be 100% green
- [X] T041 End-to-end smoke test: start the full stack (Go engine + API + frontend), run a sweep with `stop_loss_enabled=true`, `stop_loss_percent` range `[3, 5]`, `stop_loss_timeout_minutes` range `[0, 60]` → verify 4 runs appear in Leaderboard with `total_stops_triggered` populated and `winRate` non-zero
- [X] T042 Verify `stop_loss_enabled=false` backward-compat: run a sweep with SL disabled and compare ROI/maxDrawdown/winRate values against a pre-feature baseline run — must be identical

**Checkpoint**: Full test suite green. End-to-end sweep with SL enabled produces 4 distinct result rows with KPIs. Backward-compat sweep with SL disabled is identical to baseline.

---

## Dependencies

User story completion order (due to code dependencies):

```
Phase 1 (Setup) → Phase 2 (Foundation) → Phase 3 (US1+US2) → Phase 4 (US3) → Phase 5 (US4)
                                       ↘                                     ↗
                                         Phase 6 (US5) requires Phase 2 + Phase 3 + Phase 5
                                       ↘
                                         Phase 7 (US6) can start after Phase 3
```

Parallel opportunities:
- T003 + T004 (position.go + events.go) are independent — parallelizable
- T005 + T006 (migration + schema.ts) are independent — parallelizable within Phase 2
- T023 (aggregator tests) can be written in parallel with T019 (US3 tests)
- T029 (Configurator UI tests) can be written in parallel with T036 (wide event tests)

## Implementation Strategy

**MVP scope** (deliver value immediately): Phases 1–3 only (T001–T018). This gives:
- Working stop-loss in the Go engine (immediate + timeout modes)
- `total_stops_triggered` + `winRate` in engine result payload
- No UI changes yet — operator can test via direct engine JSON

**Full scope**: All 8 phases (T001–T042) to deliver complete user-facing feature with Optimizer UI, ClickHouse wide events, and Leaderboard KPIs.
