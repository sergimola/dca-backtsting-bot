# Data Model: Feature 012 — Monthly Capital Injection

**Branch**: `012-monthly-capital-injection`  
**Date**: 2026-03-16

---

## New / Modified Entities

### 1. `Orchestrator` struct (application layer — Go)

**File**: `core-engine/application/orchestrator/orchestrator.go`

**Change**: Add two new fields.

```go
type Orchestrator struct {
    psm               position.PositionStateMachine
    eventBus          *EventBus
    config            *OrchestratorConfig
    position          *position.Position
    // NEW ↓
    globalCandleCount int64           // Monotonic counter across all trade cycles; increments every candle
    runningBalance    decimal.Decimal // Authoritative capital pool: initial balance + profits + monthly additions
}
```

**Initialization** (top of `RunBacktest`):
```go
orch.globalCandleCount = 0
if orch.config.DomainConfig != nil {
    orch.runningBalance = orch.config.DomainConfig.AccountBalance()
}
```

**Invariants**:
- `globalCandleCount` is incremented exactly once per candle, unconditionally.
- `runningBalance` is only mutated by: (a) monthly tick addition, (b) trade close profit carryover.
- `runningBalance` is read exactly once per new position open.

---

### 2. `BacktestFormState` interface (UI layer — TypeScript)

**File**: `frontend/src/services/types.ts`

**Change**: Add one field.

```typescript
export interface BacktestFormState {
  // ... all existing 13 fields ...
  /** Monthly capital injection in USDT, e.g. "500.00". Empty string = disabled (sends as "0"). */
  monthlyAddition: string   // NEW
}
```

---

### 3. `ApiBacktestRequest` interface (API layer — TypeScript)

**Files**: `orchestrator/api/src/types/index.ts` and `orchestrator/api/src/types/configuration.ts`

**Change**: Add one optional field to both.

```typescript
export interface ApiBacktestRequest {
  // ... all existing fields ...
  monthly_addition?: string;  // NEW — non-negative decimal string; absent = treated as "0"
}
```

---

## Unchanged Entities

### `MonthlyAdditionEvent` (domain layer — Go)

**File**: `core-engine/domain/position/events.go`

No structural changes. The Orchestrator populates all fields including `PreviousBalance` and `AdditionNumber` which the PSM previously left empty.

```go
type MonthlyAdditionEvent struct {
    RunID           string
    TradeID         string
    Timestamp       time.Time
    AdditionAmount  string  // decimal string
    PreviousBalance string  // decimal string — NOW properly set by Orchestrator
    NewBalance      string  // decimal string
    AdditionNumber  int     // 1-based; = globalCandleCount / 43200
    DaysSinceStart  int     // = globalCandleCount / 1440
}
```

### `domain/config.Config` (domain layer — Go)

No changes. `monthlyAddition decimal.Decimal`, `MonthlyAddition()`, `WithMonthlyAddition()`, and `DefaultMonthlyAddition` are already implemented.

### `EngineRequest` (cmd layer — Go)

No changes. `MonthlyAddition string \`json:"monthly_addition,omitempty"\`` already exists.

### `buildConfigFromRequest` (cmd layer — Go)

No changes. Already parses `req.MonthlyAddition` and passes to `config.WithMonthlyAddition`.

### `Position.CandleCount` (domain layer — Go)

`pos.CandleCount` continues to increment inside `ProcessCandle`. It is position-scoped (resets per position) and serves display purposes (`DaysSinceStart` label). It is NOT used for the monthly tick after this change.

---

## State Transitions

### Running Balance State Machine

```
[backtest start]
    │
    ▼
runningBalance = config.AccountBalance()          ← initialization
    │
    ▼
[candle loop begins]
    │
    ├─ every candle: globalCandleCount++
    │
    ├─ if globalCandleCount % 43200 == 0 AND monthly_addition > 0:
    │       runningBalance += monthly_addition    ← monthly tick
    │       if position open:
    │           position.AccountBalance += monthly_addition
    │           emit MonthlyAdditionEvent
    │
    ├─ if position == nil:
    │       open NewPosition(... AccountBalance = runningBalance)
    │
    ├─ if position.State == StateClosed:
    │       runningBalance += decimal(tce.Profit) ← profit/loss carryover
    │       position = nil
    │
    ▼
[backtest end]
    final runningBalance = initial + Σ(monthly additions) + Σ(realized profits/losses)
```

### Removed State Transition

The following block is removed from `ProcessCandle` in `minute_loop.go`:

```go
// REMOVED:
if pos.CandleCount > 0 && pos.CandleCount%43200 == 0 && !pos.MonthlyAddition.IsZero() {
    pos.AccountBalance = pos.AccountBalance.Add(pos.MonthlyAddition)
    events = append(events, &MonthlyAdditionEvent{ ... })
}
```

---

## Validation Rules

| Field | Layer | Rule |
|---|---|---|
| `monthly_addition` (API) | TypeScript | Optional; if present, must be a non-negative decimal string parseable by `validateDecimal`; absent → defaults to `"0"` |
| `monthlyAddition` (UI) | React | Optional; if non-empty, must parse as float >= 0; empty field is valid (submitted as `"0"`) |
| `MonthlyAddition` (Go engine) | `buildConfigFromRequest` | Empty string → `decimal.Zero`; non-empty → `decimal.NewFromString`; error → returns error |
| `MonthlyAddition` (Go domain) | `config.Validate()` | Must be non-negative (`>= 0`); already enforced |

---

## US8 Additions — Timeline View Entities (amended 2026-03-22)

### 4. `PnlSummary` interface — `total_additions` field (API layer — TypeScript)

**File**: `orchestrator/api/src/types/index.ts`

**Change**: Add one optional field.

```typescript
export interface PnlSummary {
  total_pnl: string;
  entry_fee: string;
  trading_fees: string;
  liquidation_fee?: string;
  total_fees: string;
  roi_percent: string;
  max_drawdown_percent?: string;
  total_fills: number;
  realized_pnl: string;
  unrealized_pnl?: string;
  safety_order_usage_counts: Record<number, number>;
  total_additions?: string;  // NEW — sum of all monthly addition amounts; absent when none
}
```

**Why optional**: Historical backtest records stored before this change have no `total_additions` field in the JSONB blob. Callers treat absence the same as `"0"`.

---

### 5. `ResultAggregator.aggregateGoEvents` — Updated Return Shape (API layer — TypeScript)

**File**: `orchestrator/api/src/services/ResultAggregator.ts`

**Changes**:
- Add `let totalAdditions = new Decimal(0)` accumulator in the event loop.
- In the `for` loop, add a branch for `type === 'monthly.addition'` that parses `d.addition_amount` and adds to `totalAdditions` (invalid/unparseable values are skipped with `console.warn`, not thrown).
- Replace the ROI denominator from `accBalance` to `accBalance.plus(totalAdditions)`.
- Add `total_additions: PrecisionFormatter.formatPrice(totalAdditions)` to the return object.

**Invariant**: When `totalAdditions.isZero()`, the denominator is unchanged — mathematically identical to the existing formula. No behavioral regression for backtests without monthly additions.

---

### 6. `TradingTimeline` component and sub-components (frontend layer — React)

**File**: `frontend/src/components/TradingTimeline.tsx` (NEW)

**Props interface**:
```typescript
interface TradingTimelineProps {
  tradeEvents: TradeEvent[]        // full ledger including DEPOSIT rows
  tradeGroups: TradeGroupMetrics[] // from useResultsMetrics
  initialBalance: number           // from config.accountBalance
}
```

**Internal data shape** — `TimelineItem`:
```typescript
type TimelineItemKind = 'injection' | 'trade'

interface InjectionItem {
  kind: 'injection'
  timestamp: string
  rawTimestamp: string
  amount: number         // injected amount (non-negative)
  runningEquity: number  // cumulative equity immediately after this injection
}

interface TradeItem {
  kind: 'trade'
  index: number          // 1-based trade number
  tradeId: string
  openTimestamp: string
  closeTimestamp: string
  durationMs: number
  fillCount: number      // number of buy orders filled (ENTRY + SAFETY_ORDER count)
  maxOrders: number      // max number of possible orders (from safety order levels)
  capitalDeployed: number
  netProfit: number
  totalFees: number
  runningEquity: number  // cumulative equity after this trade closed
  orders: TradeEvent[]   // all order events for this trade (ENTRY, SAFETY_ORDER, EXIT)
}

type TimelineItem = InjectionItem | TradeItem
```

**Running equity trail computation** (FR-027):
```typescript
// Computed synchronously in useMemo:
let equity = new Decimal(initialBalance)
for (const item of sortedItems) {
  if (item.kind === 'injection') {
    equity = equity.plus(item.amount)
    item.runningEquity = equity.toNumber()
  } else {
    equity = equity.plus(item.netProfit)
    item.runningEquity = equity.toNumber()
  }
}
```

**Sub-components** (co-located in the same file or split into separate files):

- **`CapitalInjectionCard`**: Receives `InjectionItem`, displays "CAPITAL INJECTION" header, formatted date, `+$X,XXX.XX` in green, `Equity: $X,XXX.XX`.
- **`TradeSummaryCard`**: Receives `TradeItem` + `isExpanded: boolean` + `onToggle: () => void`. Collapsed view shows: numbered badge, "Trade" label, duration badge, fill ratio badge (`fillCount/maxOrders`), capital deployed badge, P&L (green/red), date range, equity. Expanded view adds inline `TradeOrdersDetail` table.
- **`TradeOrdersDetail`**: Receives `TradeEvent[]`, renders a dark table with columns TIME | ACTION | PRICE | QUANTITY | COST/PNL | FEE DEDUCTED.

---

### 7. `DashboardMetrics` interface (frontend layer — TypeScript)

**File**: `frontend/src/services/types.ts`

No change required — `tradeGroups` already carries the per-trade data needed to build `TradeItem` objects. `TradeGroupMetrics` already has `events`, `netProfit`, `totalFees`, `durationHours`, `maxCapitalDeployed`. The `TradingTimeline` component derives its data from `tradeEvents` (for DEPOSIT rows) and `tradeGroups` (for trade summaries) rather than requiring a new type.

---

## Updated Validation Rules

| Field | Layer | Rule |
|---|---|---|
| `monthly_addition` (API) | TypeScript | Optional; if present, must be a non-negative decimal string parseable by `validateDecimal`; absent → defaults to `"0"` |
| `monthlyAddition` (UI) | React | Optional; if non-empty, must parse as float >= 0; empty field is valid (submitted as `"0"`) |
| `MonthlyAddition` (Go engine) | `buildConfigFromRequest` | Empty string → `decimal.Zero`; non-empty → `decimal.NewFromString`; error → returns error |
| `MonthlyAddition` (Go domain) | `config.Validate()` | Must be non-negative (`>= 0`); already enforced |
| `total_additions` (API response) | TypeScript | Optional string decimal; absent treated as `"0"` by frontend; never negative |
| `TradingTimeline.tradeGroups` (UI) | React | Must always have matching `tradeId` between `tradeGroups` and non-DEPOSIT `tradeEvents`; mismatches render as empty order table |
