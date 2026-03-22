# Tasks: Restoring Monthly Capital Injection (DCA Savings)

**Feature**: `012-monthly-capital-injection`  
**Branch**: `012-monthly-capital-injection`  
**Input**: `specs/012-monthly-capital-injection/plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/api-monthly-addition.md`, `quickstart.md`

**Green Light Protocol**: All existing tests must remain green after each phase. New tests in Phase 4 replace (invert) T088–T091 — they must be updated before running `go test ./domain/position/...`.

**Domain Boundary**:
- `[orchestrator]` — TypeScript code in `orchestrator/api/` and `frontend/`
- `[core-engine]` — Go code in `core-engine/`

**Pre-condition (already complete — zero work needed)**:
- `core-engine/cmd/engine/main.go` — `EngineRequest.MonthlyAddition` field exists ✅
- `core-engine/cmd/engine/main.go` → `buildConfigFromRequest` — parses and wires `monthly_addition` ✅
- `core-engine/domain/config/config.go` — `WithMonthlyAddition()`, `MonthlyAddition()`, `DefaultMonthlyAddition` ✅
- `core-engine/domain/position/events.go` — `MonthlyAdditionEvent` struct fully defined ✅

---

## Phase 1: API & Validation (TypeScript)

**Goal**: Extend the TypeScript API layer to accept, validate, and forward `monthly_addition` as an optional non-negative decimal string, defaulting to `"0"` when absent.

**User Story**: US4 (P4) — API Validates and Passes `monthly_addition` Through the Full Stack

**Independent Test**: `npm test -- --testPathPattern=configuration` passes; sending `"-50"` returns `400`; omitting the field defaults to `"0"` in the validated output.

- [X] T001 [P] [orchestrator] [US4] Add `monthly_addition?: string` to `ApiBacktestRequest` interface in `orchestrator/api/src/types/index.ts` (after the `account_balance` field)
- [X] T002 [P] [orchestrator] [US4] Add `monthly_addition?: string` to local `ApiBacktestRequest` interface in `orchestrator/api/src/types/configuration.ts` (after the `account_balance` field)
- [X] T003 [orchestrator] [US4] Add validation block for `monthly_addition` in `validateBacktestRequest` in `orchestrator/api/src/types/configuration.ts`: optional, must be a non-negative decimal string via `validateDecimal`, default to `'0'` when absent
- [X] T004 [orchestrator] [US4] Add `monthly_addition: validatedMonthlyAddition` to the return object of `validateBacktestRequest` in `orchestrator/api/src/types/configuration.ts`

**Checkpoint**: `npm test -- --testPathPattern=configuration` passes; `go build ./...` unaffected.

---

## Phase 2: Frontend UI (React)

**Goal**: Add a "Monthly Addition (USDT)" form field to the backtest configuration form, wire it through the form state, API payload, and the config summary panel.

**User Story**: US3 (P3) — UI Form Accepts and Sends Monthly Addition Parameter

**Independent Test**: Render `<ConfigurationForm>` with `monthlyAddition="250"`, submit, verify `onSubmit` receives `{ monthlyAddition: "250" }`. Verify blank field coerces to `"0"` in the API payload. Verify `"-100"` shows validation error.

- [X] T005 [P] [orchestrator] [US3] Add `monthlyAddition: string` to `BacktestFormState` interface in `frontend/src/services/types.ts` (after the `accountBalance` field)
- [X] T006 [orchestrator] [US3] Add `monthlyAddition: ''` to the `EMPTY_FORM` constant in `frontend/src/components/ConfigurationForm.tsx` (after the `accountBalance` entry)
- [X] T007 [orchestrator] [US3] Add `'monthlyAddition'` case to `validateField` in `frontend/src/components/ConfigurationForm.tsx`: field is optional (empty string is valid); when non-empty, value must parse as a number `>= 0`; error message: `"Monthly addition must be >= 0"`
- [X] T008 [orchestrator] [US3] Add `<FormInput>` JSX element for Monthly Addition after the Account Balance field in `frontend/src/components/ConfigurationForm.tsx`: `label="Monthly Addition (USDT)"`, `name="monthlyAddition"`, `type="number"`, `min="0"`, `step="0.01"`, `placeholder="0"`
- [X] T009 [orchestrator] [US3] Add `monthly_addition` to `apiPayload` in `frontend/src/services/backtest-api.ts`: coerce blank/whitespace-only value to `"0"` — `config.monthlyAddition && config.monthlyAddition.trim() !== '' ? config.monthlyAddition : '0'`
- [X] T010 [orchestrator] [US3] Add `monthlyAddition: c.monthly_addition ?? ''` to `mapConfigToFormState` in `frontend/src/services/backtest-api.ts`
- [X] T011 [P] [orchestrator] [US3] Add `monthlyAddition: 'Monthly Addition'` to the `LABELS` object in `frontend/src/components/ConfigSummaryPanel.tsx`

**Checkpoint**: `npm test` passes; the Monthly Addition field appears in the rendered form and in the config summary panel.

---

## Phase 3: Orchestrator State Elevation (Go)

**Goal**: Replace the calendar-based, between-trades-only monthly trigger in the Orchestrator with a global 43,200-candle counter on the struct. Carry realized profit forward into `runningBalance` across trade boundaries.

**User Stories**: US1 (P1) — Simulate 3 Years of DCA Savings; US2 (P2) — Running Balance Carries Realized Profit Forward

**Independent Test**: Unit test in `core-engine/application/orchestrator/`: feed 43,200 synthetic candles with no open position, verify one `MonthlyAdditionEvent` emitted with correct `PreviousBalance` and `AdditionNumber`; close a position with `Profit="120.50"`, verify `runningBalance` increases by exactly `120.50`; open next position, verify `AccountBalance == runningBalance`.

- [X] T012 [core-engine] [US1] Add `globalCandleCount int64` and `runningBalance decimal.Decimal` fields to the `Orchestrator` struct in `core-engine/application/orchestrator/orchestrator.go`
- [X] T013 [core-engine] [US1] Replace local `lastMonth int` and local `runningBalance decimal.Decimal` variable declarations at the top of `RunBacktest` with struct field initializations: `orch.globalCandleCount = 0` and `orch.runningBalance = domainConfig.AccountBalance()` in `core-engine/application/orchestrator/orchestrator.go`
- [X] T014 [core-engine] [US1] At the top of the per-candle loop body (before the `position == nil` guard) in `RunBacktest`, add: increment `orch.globalCandleCount`; when `orch.globalCandleCount % 43200 == 0` and `!monthlyAddition.IsZero()`, add to `orch.runningBalance`, and if a position is currently open also call the position's injection method and emit a `MonthlyAdditionEvent` with populated `PreviousBalance` and `AdditionNumber` fields — in `core-engine/application/orchestrator/orchestrator.go`
- [X] T015 [core-engine] [US2] Remove the `if !runningBalance.IsZero() { ... } else { config.AccountBalance() }` conditional and replace with unconditional `orch.runningBalance` when calling `NewPosition` in `core-engine/application/orchestrator/orchestrator.go`
- [X] T016 [core-engine] [US2] In the `OnPositionClosed` callback (or wherever `TradeClosedEvent` is handled), parse `tce.Profit` using `decimal.NewFromString` and add it to `orch.runningBalance`; log a warning on parse failure; remove the entire old calendar-month block (`if lastMonth != currentMonth && position == nil { ... }`) from `core-engine/application/orchestrator/orchestrator.go`

**Checkpoint**: `go build ./...` succeeds; `go test ./application/orchestrator/...` passes.

---

## Phase 4: PSM Cleanup & Test Updates (Go)

**Goal**: Remove the now-redundant 43,200-candle monthly trigger from the Position State Machine. Update the PSM tests that previously asserted the PSM emits `MonthlyAdditionEvent` — they must now assert the opposite (no emission, balance unchanged).

**User Story**: US5 — PSM No Longer Owns Monthly Addition Logic

**Independent Test**: After the removal, `go test ./domain/position/... -run TestMonthlyAddition` must pass (assertions inverted). T088–T091 must assert `MonthlyAdditionEvent` is NOT in the event list after 43,200 candles through the PSM.

- [X] T017 [core-engine] Remove the entire `if pos.CandleCount > 0 && pos.CandleCount%43200 == 0 && !pos.MonthlyAddition.IsZero()` block (~15 lines) from `ProcessCandle` in `core-engine/domain/position/minute_loop.go`
- [X] T018 [core-engine] Confirm `pos.CandleCount++` is retained immediately after the removed block in `core-engine/domain/position/minute_loop.go` (this line must NOT be deleted)
- [X] T019 [P] [core-engine] Update T088–T091 in `core-engine/domain/position/monthly_addition_test.go`: change assertions from "PSM emits `MonthlyAdditionEvent`" to "PSM does NOT emit `MonthlyAdditionEvent`" and "pos.AccountBalance is unchanged at the 43,200-candle boundary"
- [X] T020 [P] [core-engine] Update `TestCanonical_Scenario7_MonthlyAddition` in `core-engine/domain/position/canonical_integration_test.go`: reflect that monthly injection is now Orchestrator-driven, not PSM-driven (PSM scenario no longer fires the event internally)

**Checkpoint**: `go test ./domain/position/...` passes with all tests green.

---

## Phase 5: Go Engine Aggregator Fix

**Goal**: Fix `aggregateBacktestEvents` to accumulate capital injections from `monthly.addition` events and use the corrected denominator in the ROI formula. Fix `buildTradeEvents` to emit `DEPOSIT` trade event rows for `monthly.addition` events so the ledger is complete.

**User Story**: US6 (P1) — Aggregator ROI Correction & DEPOSIT Passthrough

**Spec refs**: FR-019, FR-020, FR-021, SC-007, SC-008

**Independent Test**: `go test ./cmd/engine/...` passes with a new `TestAggregateBacktestEvents_MonthlyAddition` test: inject a stream of 1 `PositionClosed` (profit=250) and 3 `monthly.addition` (500 each) events against accountBalance=1000; assert `roi ≈ 10.00` (250÷2500×100) and that `buildTradeEvents` output contains exactly 3 `DEPOSIT` rows with `eventType="DEPOSIT"` and `balance=500`.

- [X] T023 [core-engine] [US6] In `aggregateBacktestEvents` in `core-engine/cmd/engine/aggregator.go`: declare `var totalAdditions decimal.Decimal` before the event loop; add a `case orchestrator.EventType("monthly.addition"):` branch; type-assert `ev.Data` to `*position.MonthlyAdditionEvent`; accumulate `decStr(mae.AdditionAmount)` into `totalAdditions`; log a `slog.Warn` and skip on type-assert failure
- [X] T024 [core-engine] [US6] In `aggregateBacktestEvents` in `core-engine/cmd/engine/aggregator.go`: update the ROI guard from `if accountBalance.IsPositive()` to `if accountBalance.Add(totalAdditions).IsPositive()`; update the ROI divisor from `accountBalance` to `accountBalance.Add(totalAdditions)` in `core-engine/cmd/engine/aggregator.go`
- [X] T025 [P] [core-engine] [US6] In `buildTradeEvents` in `core-engine/cmd/engine/aggregator.go`: add a `case orchestrator.EventType("monthly.addition"):` branch; type-assert to `*position.MonthlyAdditionEvent`; append a `TradeEventOutput` with `EventType: "DEPOSIT"`, `Balance: decStr(mae.AdditionAmount).InexactFloat64()`, `Price: 0`, `Quantity: 0`, `Fee: 0`, `Timestamp: formatUTCTimestamp(ev.Timestamp)`, `RawTimestamp: ev.Timestamp.UTC().Format(time.RFC3339)`, `TradeID: "deposit"`; skip on type-assert failure with `slog.Warn`

**Checkpoint**: `go build ./...` succeeds; `go test ./cmd/engine/...` passes with new DEPOSIT/ROI assertions.

---

## Phase 6: Frontend DEPOSIT Rendering & Equity Correction

**Goal**: Handle `DEPOSIT` event rows in the React trade ledger (both the cache-path loop in `backtest-api.ts` and the table renderer `TradeEventsTable.tsx`). Update `accountEquity` in `useResultsMetrics.ts` to add `totalAdditions` to the formula.

**User Story**: US7 (P3) — UI Trade Table DEPOSIT Row Rendering & True Account Equity Display

**Spec refs**: FR-021, FR-022, FR-023

**Independent Test**: `npm test` passes; a `tradeEvents` array containing a `DEPOSIT` row renders without crash; `accountEquity` for a 3-addition run equals `initialBalance + 1500 + netProfit`.

- [X] T026 [orchestrator] [US7] In the cache-path event loop in `frontend/src/services/backtest-api.ts` (`getResults`): before the `FILL_EVENT_TYPES` guard, add `if (e.type === 'monthly.addition') { ... }` — construct a trade event with `eventType: 'DEPOSIT'`, `balance: parseFloat((e.data ?? {}).addition_amount ?? '0')`, `price: 0`, `quantity: 0`, `fee: 0`, `trade_id: 'deposit'`, `timestamp/rawTimestamp` from `e.timestamp`; push to `tradeEvents`; then `continue` to skip the rest of the loop iteration
- [X] T027 [P] [orchestrator] [US7] In `frontend/src/components/TradeEventsTable.tsx`: in the table row renderer, add a branch for `event.eventType === 'DEPOSIT'` — display `formatCurrency(event.balance)` in the Balance column (or the equivalent balance cell), render `—` (em-dash `\u2014`) in the Price and Quantity cells; ensure no `price`/`quantity` arithmetic runs for DEPOSIT rows (to avoid NaN or division-by-zero)
- [X] T028 [orchestrator] [US7] In `frontend/src/hooks/useResultsMetrics.ts`: compute `const totalAdditions = results.tradeEvents.filter(e => e.eventType === 'DEPOSIT').reduce((sum, e) => sum + e.balance, 0)`; update `accountEquity` from `accountBalance + netProfit` to `accountBalance + totalAdditions + netProfit`

**Checkpoint**: `npm test` passes; DEPOSIT rows appear in the trade table; Account Equity KPI shows the corrected value.

---

## Phase 7: Full Integration Smoke Test

**Goal**: Verify the entire stack end-to-end: UI → API → Go engine → events → response. Includes verification of DEPOSIT ledger rows and corrected Account Equity display.

**Spec refs**: SC-001, SC-002, SC-003, SC-007, SC-008

**Independent Test**: See `quickstart.md` Step 5 for the exact `curl` command. A 91-day backtest with `monthly_addition="500"` must return ≥ 3 `DEPOSIT` entries in `tradeEvents` and the `roi` field must reflect the corrected denominator (≤ the uncorrected value). Account Equity in the UI must equal `initial_balance + total_additions + net_profit`.

- [ ] T029 Run the smoke-test `curl` command from `quickstart.md` Step 5 against a locally running stack (`docker-compose up`) and verify: (a) the response `tradeEvents` contains ≥ 3 rows with `eventType="DEPOSIT"` and `balance=500`; (b) `pnlSummary.roi` equals `realizedPnl / (accountBalance + totalInjected) × 100` within floating-point tolerance
- [ ] T030 Verify the React UI: (a) the trade table displays DEPOSIT rows with em-dash Price and Quantity and a formatted balance; (b) the Account Equity KPI shows `initial_balance + total_injected + net_profit`; (c) the config summary panel displays "Monthly Addition: 500" (manual browser check)

---

## Phase 8: TypeScript ResultAggregator ROI Correction (US6 — TypeScript layer)

**Goal**: The TypeScript `ResultAggregator.aggregateGoEvents` method accumulates `monthly.addition` events into `totalAdditions`, corrects the ROI denominator to `accountBalance + totalAdditions`, and returns `total_additions` in the `PnlSummary` output. This fixes the authoritative `roi_percent` value stored in the database for historical records.

**User Story**: US6 (P1) — Aggregator Computes Correct ROI

**Spec refs**: FR-019, FR-020, SC-007

**Independent Test**: `cd orchestrator/api && npx jest ResultAggregator` — canonical assertion: 3 injections of `"500"` + `realizedPnl = "250"` + `accountBalance = "1000"` → `roi_percent = "10.00000000"`, `total_additions = "1500.00000000"`.

- [X] T031 [P] [orchestrator] [US6] Add `total_additions?: string` as an optional field to the `PnlSummary` interface in `orchestrator/api/src/types/index.ts` (after `safety_order_usage_counts`); optional preserves backward compatibility with historical stored records that lack the field
- [X] T032 [P] [orchestrator] [US6] Write 4 new test cases in `orchestrator/api/src/services/ResultAggregator.test.ts`: (1) canonical roi=10.00 proof — 3 `monthly.addition` events of `"500"` each + `PositionClosed` profit `"250"` + `accountBalance = "1000"` → `roi_percent = "10.00"`, `total_additions = "1500.00000000"`; (2) baseline zero additions — no `monthly.addition` events → `roi_percent` unchanged, `total_additions = "0.00000000"`; (3) unparseable `addition_amount = "abc"` — does not throw, `total_additions = "0.00000000"`; (4) 2 additions in mixed event stream — denominator = `accountBalance + 2 × additionAmount`
- [X] T033 [P] [orchestrator] [US6] Implement the following in `orchestrator/api/src/services/ResultAggregator.ts` inside `aggregateGoEvents`: (a) declare `let totalAdditions = new Decimal(0)` after existing accumulators; (b) add `else if (type === 'monthly.addition')` branch that calls `totalAdditions = totalAdditions.plus(new Decimal(d.addition_amount ?? '0'))` wrapped in try/catch with `console.warn` on error; (c) replace `const roiPercent = accBalance.isZero() ? ...` with `const roiDenominator = accBalance.plus(totalAdditions); const roiPercent = roiDenominator.isZero() ? new Decimal(0) : totalPnl.dividedBy(roiDenominator).times(100)`; (d) add `total_additions: PrecisionFormatter.formatPrice(totalAdditions)` to the return object

**Checkpoint**: `npx jest ResultAggregator` passes with all 4 new test cases green. `npx jest` (full suite) must remain green.

---

## Phase 9: TradingTimeline Component (US8 — P2)

**Goal**: A new `TradingTimeline` React component renders capital injection events and completed trades as a vertical chronological timeline. Capital injections appear as cards on the left; trade summaries appear as expandable cards on the right. Running equity is computed across all events using `decimal.js`. The component is wired into the results view alongside existing components (additive, not replacing).

**User Story**: US8 (P2) — Backtest Results Timeline Visualizes Capital Injections as First-Class Events

**Spec refs**: FR-024 through FR-031, SC-009 through SC-012

**Independent Test**: `cd frontend && npx jest TradingTimeline` — 6 scenarios covering card count, canonical equity trail (1000 → 1045.50 → 1295.50 → 1283.25), expand/collapse, zero-injection regression.

- [X] T034 [P] [orchestrator] [US8] Create `frontend/src/__tests__/TradingTimeline.test.tsx` with a `mockTimeline()` fixture (initialBalance=1000, DEPOSIT event $1000 Jan 1, trade #1 netProfit=+45.50 closed Jan 6, DEPOSIT event $250 Feb 1, trade #2 netProfit=-12.25 closed Feb 14) and the following 6 test cases: (1) renders exactly 2 capital injection cards and 2 trade cards in chronological order; (2) equity trail values equal 1000.00 / 1045.50 / 1295.50 / 1283.25 respectively; (3) expanding trade #2 card renders a table with columns TIME, ACTION, PRICE, QUANTITY, COST/PNL, FEE DEDUCTED and the correct row count; (4) clicking an expanded card collapses it back; (5) with zero DEPOSIT events only trade cards render and no injection card elements exist in the DOM; (6) equity trail without injections equals `initialBalance + cumulative netProfit` per trade
- [X] T035 [P] [orchestrator] [US8] Create `frontend/src/components/TradingTimeline.tsx`: define `InjectionItem` and `TradeItem` internal union types; implement `useMemo` pipeline that (a) extracts `InjectionItem[]` from `tradeEvents.filter(e => e.eventType === 'DEPOSIT')`, (b) builds `TradeItem[]` from `tradeGroups` with `status === 'CLOSED'` (derive `openTimestamp` from earliest ENTRY event, `closeTimestamp` from EXIT, `fillCount` from ENTRY + SAFETY_ORDER count), (c) sorts all items by `rawTimestamp` ascending, (d) walks the sorted list with `decimal.js` computing `runningEquity` per item (injection: `equity.plus(amount)`; trade: `equity.plus(netProfit)`); implement `CapitalInjectionCard` sub-component (left column: "CAPITAL INJECTION" header, formatted timestamp, `+$X,XXX.XX` in `text-emerald-400`, `Equity: $X,XXX.XX`); implement `TradeSummaryCard` sub-component with expand/collapse local state (collapsed: `#N` dark badge, "Trade" label, duration badge, `fillCount/maxOrders` fill ratio badge, `$capitalDeployed` badge, P&L in green/red, date range, equity; expanded: adds `TradeOrdersDetail` inline); implement `TradeOrdersDetail` dark table sub-component (`bg-[#0d1117]`) with columns TIME | ACTION | PRICE | QUANTITY | COST/PNL | FEE DEDUCTED (ACTION badges: ENTRY=dark, SAFETY ORDER=amber, EXIT=slate); center-line layout with `border-l-2 border-slate-700` and differentiated dots (`bg-emerald-400` for injections, `bg-slate-500` for trades)
- [X] T036 [orchestrator] [US8] Wire `TradingTimeline` into the results section of `frontend/src/components/DashboardView.tsx` below the KpiGrid: `<TradingTimeline tradeEvents={results.tradeEvents} tradeGroups={metrics.tradeGroups} initialBalance={parseFloat(config.accountBalance) || 0} />` — additive alongside existing `TradeAccordion` and `TradeEventsTable` (do not remove those)

**Checkpoint**: `npx jest TradingTimeline` passes with all 6 test cases green. Timeline renders in the browser for a completed backtest with `monthly_addition > 0`. `npx jest` (full suite) must remain green.

---

## Phase 10: Green Light Final Verification

**Purpose**: Run the complete test suite across all three project layers after all phases are merged. Required by the Green Light Protocol before the branch is considered complete.

- [X] T037 [P] Run `cd orchestrator/api && npx jest --coverage` and confirm all tests pass including T032's US6 cases
- [X] T038 [P] Run `cd frontend && npx jest --coverage` and confirm all tests pass including T034's US8 cases
- [X] T039 [P] Run `cd core-engine && go test ./...` and confirm no regressions — no changes were made to Go code in Phases 8–9 so this is a regression smoke-check only

---

## Dependencies

```
Phase 1 (T001–T004) ──► Phase 2 (T005–T011)  [TypeScript → React consumes shared types]
Phase 1 (T001–T004) ──► Phase 3 (T012–T016)  [API types validated before Go engine changes]
Phase 3 (T012–T016) ──► Phase 4 (T017–T020)  [Orchestrator owns the trigger before PSM is cleaned]
Phase 4 (T017–T020) ──► Phase 5 (T023–T025)  [Go aggregator fix requires Orchestrator to emit the events]
Phase 5 (T023–T025) ──► Phase 6 (T026–T028)  [Frontend handles DEPOSIT rows produced by the Go aggregator]
Phase 2 (T005–T011) ──► Phase 6 (T026–T028)  [backtest-api.ts already wired before cache-path DEPOSIT handling]
Phase 6 (T026–T028) ──► Phase 7 (T029–T030)  [All layers complete before integration test]
Phase 7 (T029–T030) ──► Phase 8 (T031–T033)  [Integration smoke test passes before TS aggregator fix]
T031             ──────► T033               [PnlSummary type must exist before ResultAggregator implementation]
T031             ──────► T035               [TradingTimeline.tsx imports PnlSummary total_additions field]
Phase 8 (T031–T033) ──► Phase 9 (T034–T036) [US6 TS types in place before US8 component reads them]
T035             ──────► T036               [Component must exist before DashboardView imports it]
Phase 9 (T034–T036) ──► Phase 10 (T037–T039) [All implementation complete before final Green Light run]
```

**Phases 8 and 9 are independent of each other** (different files, different modules) — after T031 is done, T032, T033, T034, and T035 can all proceed in parallel. T036 waits only for T035. T033 waits only for T031 (not T032, though TDD convention prefers writing tests first).

---

## Parallel Execution Examples

### For a solo developer (recommended sequence)
```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → T031 → T032 ‖ T033 → T034 ‖ T035 → T036 → Phase 10
```

### For a two-developer team
```
Developer A: Phase 1 → Phase 2 → Phase 6 (T026–T028) → Phase 7 → T031 → T032 ‖ T034
                                                                          → T033         → T036 → Phase 10
Developer B:           Phase 3 → Phase 4 → Phase 5 (T023–T025) → Phase 6 → Phase 7                → T035 → T036
(merge after Phase 1; both work from Phase 2 and Phase 3 simultaneously; Phase 6 waits for both)
```

### Within-phase parallelism
- **Phase 1**: T001 and T002 are independent (different files) — can be done simultaneously
- **Phase 4**: T019 and T020 are independent (different test files) — can be done simultaneously
- **Phase 5**: T025 (`buildTradeEvents` DEPOSIT) is independent of T023–T024 — can be done simultaneously
- **Phase 6**: T027 (`TradeEventsTable` DEPOSIT render) is independent of T026 and T028 — can be done simultaneously
- **Phase 8**: T032 and T033 are independent (different files) — can be done simultaneously after T031
- **Phase 9**: T034 and T035 are independent (different files) — can be done simultaneously
- **Phase 10**: T037, T038, T039 are independent (different directories) — can be run simultaneously

---

## Implementation Strategy

**MVP Scope (Phase 3 + Phase 4 alone)**: A developer with direct API access can validate the core DCA logic by issuing a raw `POST /backtests` request with `monthly_addition` set. Phase 3 + Phase 4 deliver US1 and US2. Phase 5 delivers US6 (correct ROI and DEPOSIT ledger). Phase 6 delivers US7 (UI rendering). Phase 1 delivers US4. Phase 2 delivers US3. Phase 8 delivers the TypeScript ResultAggregator ROI correction (the authoritative stored value). Phase 9 delivers the TradingTimeline UI. All 10 phases together deliver the complete feature.

**Recommended MVP**: Complete Phase 1 + Phase 3 + Phase 4 + Phase 5 first (US1, US2, US4, US6 Go side). This delivers the two highest-priority user stories, the API pass-through, and the Go-level ROI fix. Add Phase 2 + Phase 6 for the full UI experience. Add Phase 8 + Phase 9 for the TypeScript ROI persistence fix and the timeline visualization.

---

## Task Count Summary

| Phase | Tasks | User Story | Domain |
|---|---|---|---|
| Phase 1: API & Validation | T001–T004 (4 tasks) | US4 (P4) | [orchestrator] TypeScript |
| Phase 2: Frontend UI | T005–T011 (7 tasks) | US3 (P3) | [orchestrator] React |
| Phase 3: Orchestrator State | T012–T016 (5 tasks) | US1 (P1), US2 (P2) | [core-engine] Go |
| Phase 4: PSM Cleanup | T017–T020 (4 tasks) | US5 | [core-engine] Go |
| Phase 5: Go Aggregator Fix | T023–T025 (3 tasks) | US6 (P1) — Go layer | [core-engine] Go |
| Phase 6: Frontend Rendering | T026–T028 (3 tasks) | US7 (P3) | [orchestrator] React |
| Phase 7: Integration Smoke | T029–T030 (2 tasks) | SC-001–SC-003, SC-007–SC-008 | All layers |
| Phase 8: TS Aggregator ROI | T031–T033 (3 tasks) | US6 (P1) — TypeScript layer | [orchestrator] TypeScript |
| Phase 9: TradingTimeline | T034–T036 (3 tasks) | US8 (P2) | [orchestrator] React |
| Phase 10: Green Light | T037–T039 (3 tasks) | Full suite | All layers |
| **Total** | **37 tasks** | | |

**Parallel opportunities**: 10 (T001‖T002, T019‖T020, T023‖T024‖T025, T027, Phase 2‖Phase 3, Phase 2‖Phase 5, T032‖T033, T034‖T035, T032‖T034, T037‖T038‖T039)
