# Implementation Plan: Monthly Capital Injection (DCA Savings)

**Branch**: `012-monthly-capital-injection` | **Date**: 2026-03-22 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `/specs/012-monthly-capital-injection/spec.md`

---

## Summary

Restores the monthly capital injection (DCA savings) feature end-to-end: the `monthly_addition` parameter flows from the React UI form → API validation → Go engine config → Orchestrator 43,200-candle tick → event bus → TypeScript aggregator ROI correction → frontend timeline display. US1–US5 and the DEPOSIT ledger display portion of US7 are already implemented. Three work units remain: (1) **US6** — correct the Aggregator ROI denominator and propagate `total_additions` through the API response, (2) **US8** — build the `TradingTimeline` React component with expandable cards visualizing capital injections and trades in chronological order.

---

## Technical Context

**Language/Version**: Go 1.22 (core engine) | TypeScript 5.x / React 18 (frontend + orchestrator API)  
**Primary Dependencies**: `shopspring/decimal` (Go fixed-point), `decimal.js` (TypeScript fixed-point), React 18, Tailwind CSS, Vite  
**Storage**: PostgreSQL (Drizzle ORM) — JSONB columns store config + result blobs; no migration required  
**Testing**: `go test` (core engine unit + integration) | `jest` + `@testing-library/react` (frontend + orchestrator API)  
**Target Platform**: Linux Docker container (API + engine) | browser (frontend SPA)  
**Project Type**: Web service + SPA + compiled domain engine (polyglot)  
**Performance Goals**: Engine processes multi-year candle datasets in < 60 seconds; UI renders timeline without visible jank for ≤ 100 trade cards  
**Constraints**: All monetary arithmetic — including running equity trail in the timeline — must use `decimal.js` (no JavaScript `Number` arithmetic for money); zero floating-point drift  
**Scale/Scope**: Single-user local tool; timeline component handles ≤ 50 trades and ≤ 36 injections per backtest in the common case

---

## Constitution Check

*GATE: All gates must pass before implementation. Re-checked after Phase 1 design.*

| Gate | Status | Evidence |
|---|---|---|
| **No Live Trading** | ✅ PASS | Feature is read-only backtest results display; no trade execution paths touched |
| **Green Light Protocol** | ✅ PASS | US1–US5, partial US7 already merged; existing test suite is green. Plan requires updating `ResultAggregator.test.ts` for US6 and adding new React tests for US8 before merge |
| **Fixed-point arithmetic** | ✅ PASS | Running equity trail uses `decimal.js` (FR-027); `ResultAggregator` uses `Decimal` from `decimal.js`; no `Number` arithmetic introduced for money |
| **Single-position invariant** | ✅ PASS | Timeline component is purely display — does not touch position state machine |
| **Gap-Down execution rules** | ✅ PASS | Not touched by this feature |
| **Architecture constraints** | ✅ PASS | `TradingTimeline.tsx` lives in `frontend/src/components/` (UI layer); `ResultAggregator` changes stay in `orchestrator/api/src/services/` (orchestration layer); no domain contamination |

**BDD coverage**: US6 scenarios covered by `ResultAggregator.test.ts`. US8 scenarios covered by `TradingTimeline.test.tsx`. Links: [spec.md US6](spec.md#user-story-6), [spec.md US8](spec.md#user-story-8).

---

## Project Structure

### Documentation (this feature)

```text
specs/012-monthly-capital-injection/
├── plan.md              ← this file
├── research.md          ← Phase 0 output (complete)
├── data-model.md        ← Phase 1 output (complete, amended for US8)
├── quickstart.md        ← Phase 1 output (to be amended for US8 steps)
├── contracts/
│   └── api-monthly-addition.md  ← Phase 1 output (complete)
└── tasks.md             ← Phase 2 output (/speckit.tasks — not yet generated)
```

### Source Code (Polyglot Architecture)

```text
core-engine/                                         ← Go — DONE (US1–US5)
├── application/orchestrator/orchestrator.go         ← globalCandleCount + runningBalance ✅
├── domain/position/minute_loop.go                   ← PSM cleanup done ✅
└── domain/position/monthly_addition_test.go         ← Tests updated ✅

orchestrator/api/src/                                ← TypeScript — US6 REMAINING
├── types/index.ts                                   ← Add total_additions to PnlSummary
├── services/ResultAggregator.ts                     ← US6: totalAdditions + corrected ROI
└── services/ResultAggregator.test.ts                ← US6: new test cases

frontend/src/                                        ← React — US8 REMAINING
├── components/TradingTimeline.tsx                   ← NEW (US8 full component)
├── components/DashboardView.tsx                     ← Wire TradingTimeline into results view
└── __tests__/TradingTimeline.test.tsx               ← NEW unit tests
```

**Feature Placement Contract**: US6 is an orchestrator-layer concern (aggregation/reporting). US8 is a frontend UI concern. Neither touches the Go core engine domain.

---

## Implementation Status

| US | Title | Status | Remaining Work |
|---|---|---|---|
| US1 | Go Engine Config | ✅ Done | — |
| US2 | Running Balance Carryover | ✅ Done | — |
| US3 | UI Form Field | ✅ Done | — |
| US4 | API Validation | ✅ Done | — |
| US5 | PSM Cleanup | ✅ Done | — |
| US6 | Aggregator ROI Correction | ❌ Outstanding | `ResultAggregator.aggregateGoEvents` + `PnlSummary` type |
| US7 | UI Display (DEPOSIT rows + equity) | ✅ Done | FR-021 + FR-022 + FR-023 all done |
| US8 | TradingTimeline Component | ❌ Outstanding | New component + tests + integration |

---

## Phase 0: Research

*Status: **Complete** — see [research.md](research.md)*

All NEEDS CLARIFICATION items resolved. Key findings:
- Go engine config, PSM, and Orchestrator state are already implemented.
- `ResultAggregator.aggregateGoEvents` does NOT yet handle `monthly.addition` events or correct the ROI denominator (confirmed US6 outstanding).
- Frontend `useResultsMetrics.ts` already computes correct account equity and ROI from DEPOSIT trade events — the display is correct. However, the API-stored `roi_percent` value is still wrong (overcalculated), which US6 fixes at the authoritative source.
- `TradingTimeline.tsx` does not exist — US8 is the only remaining frontend work.

---

## Phase 1: Design

*Status: **Complete** — see [data-model.md](data-model.md), [contracts/api-monthly-addition.md](contracts/api-monthly-addition.md)*

All entities documented. US8 entities (`TradingTimeline`, `CapitalInjectionCard`, `TradeSummaryCard`, `TradeOrdersDetail`, `TimelineItem` union type) added to data-model.md on 2026-03-22.

### Constitution Check (Post-Design)

All gates remain GREEN. No violations identified. The `TimelineItem` union type and running equity trail computation are purely display-layer constructs. Running equity is computed using `decimal.js` (FR-027) with no monetary side effects.

---

## Phase 2: Implementation

### Task Groups

---

### Group A — US6: ResultAggregator ROI Correction

**Domain**: `orchestrator/api/` (TypeScript, orchestrator layer)  
**Dependencies**: None (pure logic change inside existing service)  
**Constitution gates**: Fixed-point arithmetic (decimal.js throughout); tests required before merge

#### A1 — Add `total_additions` to `PnlSummary` type

**File**: `orchestrator/api/src/types/index.ts`

Add optional field to `PnlSummary` interface:
```typescript
total_additions?: string;  // sum of all monthly addition amounts; absent treated as "0"
```

**Why optional**: Preserves backward compatibility with historical stored records that lack the field.

---

#### A2 — Update `ResultAggregator.aggregateGoEvents`

**File**: `orchestrator/api/src/services/ResultAggregator.ts`

Four changes inside the `aggregateGoEvents` method:

1. **Declare accumulator** (after existing accumulators at ~line 251):
   ```typescript
   let totalAdditions = new Decimal(0);
   ```

2. **Add event branch** inside the `for` loop (after the `PositionClosed` branch):
   ```typescript
   } else if (type === 'monthly.addition') {
     // FR-019: accumulate addition_amount; skip silently if unparseable
     try {
       totalAdditions = totalAdditions.plus(new Decimal(d.addition_amount ?? '0'));
     } catch {
       console.warn('[ResultAggregator] unparseable monthly.addition amount:', d.addition_amount);
     }
   }
   ```

3. **Correct ROI denominator** (FR-020, replacing the calculation at ~line 295):
   ```typescript
   // ROI = (realized P&L / (accountBalance + totalAdditions)) × 100
   const roiDenominator = accBalance.plus(totalAdditions);
   const roiPercent = roiDenominator.isZero()
     ? new Decimal(0)
     : totalPnl.dividedBy(roiDenominator).times(100);
   ```

4. **Add to return object** (inside the `return` block):
   ```typescript
   total_additions: PrecisionFormatter.formatPrice(totalAdditions),
   ```

**Invariant**: When `totalAdditions.isZero()`, `roiDenominator === accBalance` — identical to existing behavior. No behavioral regression for backtests without monthly additions.

---

#### A3 — Write ResultAggregator tests for US6

**File**: `orchestrator/api/src/services/ResultAggregator.test.ts`

New test cases (append to existing suite), driven by SC-007 and the canonical test data table:

| Test | Input | Expected |
|---|---|---|
| 3 monthly additions of `"500"` + realized P&L `"250"`, `accountBalance = "1000"` | 3 `monthly.addition` events + 3 `PositionClosed` events | `roi_percent = "10.00000000"`, `total_additions = "1500.00000000"` |
| Baseline: 0 monthly additions | No `monthly.addition` events | `roi_percent` unchanged vs old formula; `total_additions = "0.00000000"` |
| Unparseable `addition_amount = "abc"` | 1 malformed `monthly.addition` event | Does not throw; `total_additions = "0.00000000"` |
| 2 monthly additions + standard trade events | Mixed event stream | `totalAdditions` accumulated correctly; denominator = `accountBalance + 2 × addition` |

---

### Group B — US8: TradingTimeline Component

**Domain**: `frontend/src/` (React, UI layer)  
**Dependencies**: Group A (can be developed in parallel using mock data; types from A1 needed for import)  
**Constitution gates**: Fixed-point arithmetic for equity trail (decimal.js); Green Light Protocol (tests required before merge)

#### B1 — Create `TradingTimeline.tsx`

**File**: `frontend/src/components/TradingTimeline.tsx` (NEW)

**Props**:
```typescript
interface TradingTimelineProps {
  tradeEvents: TradeEvent[]        // full ledger including DEPOSIT rows
  tradeGroups: TradeGroupMetrics[] // from useResultsMetrics (netProfit, events, durationHours, etc.)
  initialBalance: number           // config.accountBalance parsed as number
}
```

**Internal `TimelineItem` type** (union):
```typescript
type InjectionItem = {
  kind: 'injection'; timestamp: string; rawTimestamp: string;
  amount: number; runningEquity: number;
}
type TradeItem = {
  kind: 'trade'; index: number; tradeId: string;
  openTimestamp: string; closeTimestamp: string; durationMs: number;
  fillCount: number; maxOrders: number; capitalDeployed: number;
  netProfit: number; totalFees: number; runningEquity: number;
  orders: TradeEvent[];
}
type TimelineItem = InjectionItem | TradeItem;
```

**Running equity trail** (FR-027, inside `useMemo`):
1. Extract `InjectionItem[]` from `tradeEvents.filter(e => e.eventType === 'DEPOSIT')`.
2. Build `TradeItem[]` from `tradeGroups` (closed trades: `status === 'CLOSED'`), derive `openTimestamp` from earliest ENTRY event, `closeTimestamp` from EXIT event, `fillCount` from ENTRY + SAFETY_ORDER count.
3. Sort all items by `rawTimestamp` ascending.
4. Walk the sorted list computing equity with `decimal.js`:
   ```typescript
   let equity = new Decimal(initialBalance);
   for (const item of sorted) {
     equity = item.kind === 'injection'
       ? equity.plus(item.amount)
       : equity.plus(item.netProfit);
     item.runningEquity = equity.toNumber();
   }
   ```

**Sub-components** (co-located in same file):

- **`CapitalInjectionCard`**: Renders on the left column. Shows "CAPITAL INJECTION" header, formatted timestamp, `+$X,XXX.XX` in `text-emerald-400`, `Equity: $X,XXX.XX` subtitle.
- **`TradeSummaryCard`**: Renders on the right column. Accepts `isExpanded: boolean` + `onToggle`. Collapsed: numbered `#N` badge, "Trade" label, duration badge, `fillCount/maxOrders` badge, `$capitalDeployed` badge, P&L (green/red), date range (`openTimestamp → closeTimestamp`), equity. Expanded: adds `TradeOrdersDetail` inline.
- **`TradeOrdersDetail`**: Dark table (`bg-[#0d1117]`), columns TIME | ACTION | PRICE | QUANTITY | COST/PNL | FEE DEDUCTED. Maps ENTRY → dark badge, SAFETY ORDER → amber badge, EXIT → slate badge. Matches `TradeEventsTable.tsx` dark theme.

**Layout** (FR-030): Flex column. Each row: `[left 48%] [center dot] [right 48%]`. Center vertical line via `border-l-2 border-slate-700` on the center column. Injection dot: `bg-emerald-400`; trade dot: `bg-slate-500`.

---

#### B2 — Wire TradingTimeline into results view

**File**: `frontend/src/components/DashboardView.tsx`

Add `TradingTimeline` as a new section below the KpiGrid in the results view (it does not replace `TradeAccordion` or `TradeEventsTable` — it is additive):
```tsx
<TradingTimeline
  tradeEvents={results.tradeEvents}
  tradeGroups={metrics.tradeGroups}
  initialBalance={parseFloat(config.accountBalance) || 0}
/>
```

---

#### B3 — Write TradingTimeline unit tests

**File**: `frontend/src/__tests__/TradingTimeline.test.tsx` (NEW)

Test fixture: `mockTimeline()` factory with a known dataset matching the canonical values from the spec screenshots (Jan/Feb 2024: `initial=$1000`, injection $1000 Jan 1, trade #1 +$45.50, injection $250 Feb 1, trade #2 -$12.25).

| Test | Verifies | SC |
|---|---|---|
| Renders 2 injection cards + 2 trade cards in chronological order | Card count and order | SC-009 |
| Equity trail: 1000 → 1045.50 → 1295.50 → 1283.25 | Decimal precision | SC-010 |
| Expanding trade card shows 6-column order table | Column headers + row count | SC-011 |
| Clicking expanded card collapses it | Toggle state | SC-011 |
| Zero injections: only trade cards render | No injection card elements | SC-012 |
| Equity trail without injections = initialBalance + cumulative P&L | Baseline correctness | SC-012 |

---

### Group C — Quickstart Update

**File**: `specs/012-monthly-capital-injection/quickstart.md`

Append **Step 6: US6 ResultAggregator** and **Step 7: US8 TradingTimeline** to the existing quickstart document, with the same format as Steps 1–5: files touched, what to change, and the exact `npm test` command to verify.

---

## Complexity Tracking

No constitution violations. No complexity justification required.

---

## Execution Order

```
A1 → A2 → A3     (US6: type addition → implementation → tests)
B1 → B2 → B3     (US8: component → integration → tests)
C                 (quickstart update, can be done any time)

A and B are independent and can proceed in parallel.
A1 must complete before B1 imports the updated PnlSummary type.
```

---

## Test Verification Commands

```bash
# US6 — Orchestrator API
cd "orchestrator/api"
npx jest ResultAggregator --coverage

# US8 — Frontend
cd "frontend"
npx jest TradingTimeline --coverage

# Full suites (Green Light Protocol gate — must all be green before merge)
cd "orchestrator/api" && npx jest
cd "frontend" && npx jest
cd "core-engine" && go test ./...
```
