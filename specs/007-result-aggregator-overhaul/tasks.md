# Tasks: Result Aggregator Overhaul

**Input**: Design documents from `/specs/007-result-aggregator-overhaul/`  
**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/ ✅ | quickstart.md ✅

**Domain**: All tasks in `orchestrator/api/` or `frontend/` — Go `core-engine/` is untouched.  
**Green Light Protocol**: Run full test suite before starting. All tests must be green before any task begins.

---

## Phase 1: Setup

**Purpose**: Verify green baseline before any changes.

- [x] T001 Confirm full test suite is green in `orchestrator/api/` (`npm test`) and `frontend/` (`npm test`) before any changes

---

## Phase 2: Foundational — Fix ResultAggregator SO0 Bug

**Purpose**: Foundational server-side fix that corrects persisted `pnl_summary.safety_order_usage_counts`. Must complete before US3 (chart) work, since US3 reads from the corrected count map.

**⚠️ BLOCKING**: US3 chart fix depends on this phase being complete.

### Tests (write first, confirm failure)

- [x] T002 [orchestrator] Add failing unit test `aggregateGoEvents — PositionOpened must NOT increment safetyOrderUsageCounts` in `orchestrator/api/src/services/ResultAggregator.test.ts`
- [x] T003 [orchestrator] Add failing unit test `aggregateGoEvents — BuyOrderExecuted order_number 2 maps to level 1 with no level-0 key` in `orchestrator/api/src/services/ResultAggregator.test.ts`
- [x] T004 [orchestrator] Add failing unit test `aggregateGoEvents — totalFills counts only BuyOrderExecuted not PositionOpened` in `orchestrator/api/src/services/ResultAggregator.test.ts`

### Implementation

- [x] T005 [orchestrator] Remove `totalFills++` and `safetyOrderUsageCounts[0] = ...` from the `PositionOpened` handler in `orchestrator/api/src/services/ResultAggregator.ts` `aggregateGoEvents()` method
- [x] T006 [orchestrator] Confirm tests T002–T004 now pass: `npm test -- --testPathPattern="ResultAggregator"` in `orchestrator/api/`

**Checkpoint**: `pnl_summary.safety_order_usage_counts` no longer contains key `"0"`. Total fills count excludes entry orders.

---

## Phase 3: User Story 1 — Reliable Trade Numbering (Priority: P1) 🎯 MVP

**Goal**: Replace Go engine `trade_id` grouping with an incremental `tradeCounter` so each DCA cycle gets a sequential label: Trade #1, Trade #2, etc.

**Independent Test**: Run a backtest with 3+ trades; accordion must show Trade #1, Trade #2, Trade #3 in order. Relaunching a second backtest resets to Trade #1.

### Tests (write first, confirm failure)

- [x] T007 [orchestrator] [US1] Add failing unit test `getResults — assigns sequential trade_id "1","2","3" ignoring engine trade_id` in `frontend/src/__tests__/services/backtest-api.test.ts`
- [x] T008 [orchestrator] [US1] Add failing unit test `getResults — tradeCounter resets to 1 per getResults() call` in `frontend/src/__tests__/services/backtest-api.test.ts`

### Implementation

- [x] T009 [orchestrator] [US1] Replace the `.filter().map()` chain in `getResults()` in `frontend/src/services/backtest-api.ts` with an imperative `for` loop that:
  - Declares `let tradeCounter = 0` before the loop
  - Increments `tradeCounter` on each `PositionOpened` event
  - Assigns `trade_id: String(tradeCounter)` to every emitted `TradeEvent` in the current trade group
  - Skips `price.changed` and `LiquidationPriceUpdated` events (existing behaviour preserved)
- [x] T010 [orchestrator] [US1] Confirm tests T007–T008 pass: `npm test -- --testPathPattern="backtest-api"` in `frontend/`

**Checkpoint**: Accordion renders Trade #1, Trade #2, … in strict order. Engine UUID is invisible to the user.

---

## Phase 4: User Story 2 — Gross vs. Net Profit Breakdown Per Trade (Priority: P1)

**Goal**: Each accordion header displays `Trade #X | Gross: ±$X.XX | Fees: -$Y.YY | Net: ±$Z.ZZ`; Net is green when positive, red when negative; open trades show dashes.

**Independent Test**: Inspect a single closed trade accordion; verify Gross = Net + Fees using the canonical test data from spec.md.

### Tests (write first, confirm failure)

- [x] T011 [orchestrator] [US2] Add failing unit test `getResults — EXIT event.fee equals SellOrderExecuted.fee (not 0)` in `frontend/src/__tests__/services/backtest-api.test.ts`
- [x] T012 [orchestrator] [US2] Add failing unit test verifying gross profit formula: `Gross = netProfit + tradeTotalFees` for Net=`2.50`, entryFee=`0.30`, soFee=`0.25`, exitFee=`0.20` → Gross=`3.25` in `orchestrator/api/src/services/ResultAggregator.test.ts` or a new `frontend/src/__tests__/components/TradeAccordion.test.tsx`
- [x] T013 [orchestrator] [US2] Add failing unit test: `open trade (no EXIT event) renders "—" for Gross and Net` in `frontend/src/__tests__/components/TradeAccordion.test.tsx`

### Implementation

- [x] T014 [orchestrator] [US2] In the imperative loop in `frontend/src/services/backtest-api.ts` (from T009), add `SellOrderExecuted` handling: hold a reference `lastExitEvent` to the most recently pushed `EXIT` TradeEvent, then on `SellOrderExecuted` patch `lastExitEvent.fee = parseFloat(d.fee ?? '0')` and clear the reference
- [x] T015 [orchestrator] [US2] In `frontend/src/components/ResultsDashboard.tsx` — `TradeAccordion` component:
  - Import `Decimal` from `decimal.js`
  - Compute `tradeTotalFees` by reducing `events` with `Decimal` accumulation: `events.reduce((acc, e) => acc.plus(e.fee ?? 0), new Decimal(0)).toNumber()`
  - Compute `grossProfit`: if `netProfit !== null` then `new Decimal(netProfit).plus(tradeTotalFees).toNumber()`, else `null`
  - Replace the collapsed header `<button>` JSX to display `Trade #{tradeId} | Gross: ±$X.XX | Fees: -$Y.YY | Net: ±$Z.ZZ` (open positions show `—` for Gross and Net)
  - Net profit value coloured `text-emerald-400` when `> 0`, `text-rose-400` when `<= 0`, `text-slate-400` when null
- [x] T016 [orchestrator] [US2] Confirm tests T011–T013 pass: `npm test` in `frontend/`

**Checkpoint**: Every closed trade accordion header shows three distinct values; Gross = Net + Fees invariant holds; open trades show dashes.

---

## Phase 5: User Story 3 — Correct Safety Order Usage Chart (Priority: P2)

**Goal**: Chart X-axis starts at SO1, never SO0. Entry orders are excluded from counts.

**Independent Test**: Backtest with SO1 triggered 3×, SO2 triggered 1× → chart shows exactly two bars at levels 1 and 2. No SO0 bar.

**Depends on**: Phase 2 (ResultAggregator fix ensures stored counts have no `"0"` key).

### Tests (write first, confirm failure)

- [x] T017 [orchestrator] [P] [US3] Add failing unit test `getResults — safetyOrderUsage array starts at level "1" when numberOfOrders=5` in `frontend/src/__tests__/services/backtest-api.test.ts`
- [x] T018 [orchestrator] [P] [US3] Add failing unit test `getResults — no level "0" entry in safetyOrderUsage even when pnl_summary contains legacy key "0"` in `frontend/src/__tests__/services/backtest-api.test.ts`

### Implementation

- [x] T019 [orchestrator] [P] [US3] In `frontend/src/services/backtest-api.ts` — change the safety order usage padding loop from `for (let i = 0; i < numberOfOrders; i++)` to `for (let i = 1; i < numberOfOrders; i++)` so the array starts at level `"1"`
- [x] T020 [orchestrator] [P] [US3] Confirm tests T017–T018 pass: `npm test -- --testPathPattern="backtest-api"` in `frontend/`

**Checkpoint**: Safety Order chart never shows an SO0 bar. Levels 1 through N-1 are shown.

---

## Phase 6: User Story 4 — Legible Header & Accurate P&L Label (Priority: P3)

**Goal**: Accordion headers use consistent gray/slate styling; pill labels are legible; main summary card is labelled "Total Net P&L".

**Independent Test**: Load results page; confirm all trade accordion headers have slate background; summary reads "Total Net P&L"; pills are readable.

**Depends on**: Phase 4 (accordion header is redesigned in T015; styling is applied here as a refinement of that work).

### Implementation

- [x] T021 [orchestrator] [P] [US4] In `frontend/src/components/ResultsDashboard.tsx` — `TradeAccordion` header `<button>`: replace any `bg-gray-800` / status-dependent background classes with `bg-slate-800 hover:bg-slate-700` ensuring all trade headers are the same slate colour regardless of trade profit/loss status
- [x] T022 [orchestrator] [P] [US4] In `frontend/src/components/ResultsDashboard.tsx` — `EVENT_PILL` styles: ensure each pill variant uses a foreground colour with sufficient contrast against its background (e.g., `text-emerald-300` on `bg-emerald-900/40`, `text-rose-300` on `bg-rose-900/40`, `text-slate-200` on `bg-slate-600/40`)
- [x] T023 [orchestrator] [P] [US4] In `frontend/src/components/ResultsDashboard.tsx` — Metrics Cards section: add a primary "Total Net P&L" card (dollar value computed from EXIT event balances), expand grid to `sm:grid-cols-2 lg:grid-cols-4`

---

## Phase 7: Polish & Green Light Verification

**Purpose**: Full regression pass, integration smoke test, and quickstart.md validation.

- [x] T024 [orchestrator] Run full orchestrator test suite: `npm test` in `orchestrator/api/` — all tests must pass
- [x] T025 [orchestrator] Run full frontend test suite: `npm test` in `frontend/` — all tests must pass
- [ ] T026 [orchestrator] [P] Start API server (`npm start` in `orchestrator/api/`) and frontend dev server (`npm run dev` in `frontend/`) and perform end-to-end smoke test using the quickstart.md steps for all 4 changes
- [ ] T027 [orchestrator] [P] Verify with the stored result `9e4e8c78-f53a-4e8b-83f8-5cdeb80a4732.json`: accordion shows Trade #1…#N, no SO0 bar, Gross/Fees/Net values shown, header is slate, P&L card reads "Total Net P&L"

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup / Green baseline)
  └─► Phase 2 (ResultAggregator SO0 fix — server-side)
        └─► Phase 3 (US1: Trade Numbering — frontend loop refactor)  ← BLOCKS Phase 4
              └─► Phase 4 (US2: Gross/Net Fees — depends on T009 loop from Phase 3)
Phase 2
  └─► Phase 5 (US3: Chart fix — depends on corrected counts from Phase 2)
Phase 4 + Phase 5 + Phase 6 (US4 styling)
  └─► Phase 7 (Polish & verification)
```

### User Story Dependencies

| Story | Depends On | Independent? |
|-------|-----------|--------------|
| US1 — Trade Numbering | Phase 2 complete | Yes (standalone server-side + loop refactor) |
| US2 — Gross/Net/Fees | US1 loop (T009) must exist | Same file — implement after T009 |
| US3 — Chart Fix | Phase 2 (corrected counts) | Yes — independent of US1/US2 |
| US4 — Styling | US2 header redesign (T015) | Styling refinement of accordion work |

### Parallel Opportunities

**Within Phase 2** (all in `ResultAggregator.ts` — same file, sequential):
- T002, T003, T004 can be written together as one edit

**Between Phase 3 and Phase 5** (different files):
- Once Phase 2 is done, US1 (`backtest-api.ts` loop) and US3 (`backtest-api.ts` chart loop) can be done in the same pass since they are in the same file — implement US1 loop first, then add US3 loop fix in the same edit.

**Within Phase 6** — T021, T022, T023 touch different JSX sections of the same file — can be applied as a single multi-replace edit.

### MVP Scope

**Minimum deliverable**: Phase 1 + Phase 2 + Phase 3 (Trade Numbering only). This alone makes trade grouping correct and sequential. All other phases build on top.

**Full deliverable**: All 7 phases in order.

---

## Implementation Strategy

1. **Red-Green-Refactor**: Write each test group, confirm failure, implement, confirm green.
2. **Same-file edits**: Phases 3 and 5 both modify `backtest-api.ts`; implement in a single pass after tests are written.
3. **No new files**: All changes are to existing files. Zero new source files required.
4. **Backwards compatibility**: Existing stored result JSON files with legacy `"0"` keys are handled gracefully — the new chart loop never reads index 0, so old files render correctly.
