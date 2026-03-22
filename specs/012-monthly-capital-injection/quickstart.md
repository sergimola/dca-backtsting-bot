# Quickstart: Feature 012 — Monthly Capital Injection

**Branch**: `012-monthly-capital-injection`  
**Date**: 2026-03-16  
**Prerequisites**: Go 1.21+, Node.js 20+, Docker Compose running (Postgres)

---

## Overview

This guide describes how to build, test, and manually verify all five implementation steps for Feature 012. Each step can be executed and verified independently.

---

## Step 1: TypeScript API — Types & Validation

**Files touched**: `orchestrator/api/src/types/index.ts`, `orchestrator/api/src/types/configuration.ts`

**What to add**:

In `types/index.ts`, add to `ApiBacktestRequest`:
```typescript
monthly_addition?: string;
```

In `types/configuration.ts`, add to the local `ApiBacktestRequest` interface:
```typescript
monthly_addition?: string;
```

In `validateBacktestRequest`, after the `account_balance` block:
```typescript
// Validate optional monthly_addition (decimal string >= 0, defaults to '0')
let validatedMonthlyAddition: string = '0';
if (request.monthly_addition !== undefined && request.monthly_addition !== null && request.monthly_addition !== '') {
  if (typeof request.monthly_addition !== 'string') {
    throw new ValidationError('monthly_addition', 'type_error',
      `monthly_addition must be a string decimal, got ${typeof request.monthly_addition}`);
  }
  try {
    validatedMonthlyAddition = validateDecimal(request.monthly_addition);
  } catch (error) {
    throw new ValidationError('monthly_addition', 'decimal_error',
      `Invalid monthly_addition: ${String(error)}`);
  }
  if (parseFloat(validatedMonthlyAddition) < 0) {
    throw new ValidationError('monthly_addition', 'out_of_bounds',
      `monthly_addition must be >= 0, got ${validatedMonthlyAddition}`);
  }
}
```

Add to the return object:
```typescript
monthly_addition: validatedMonthlyAddition,
```

**Verify**:
```bash
cd orchestrator/api
npm test -- --testPathPattern=configuration
```
All existing tests must pass. Optionally add a test case for `monthly_addition: "-1"` → throws.

---

## Step 2: React Frontend UI

**Files touched**: `frontend/src/services/types.ts`, `frontend/src/components/ConfigurationForm.tsx`, `frontend/src/services/backtest-api.ts`, `frontend/src/components/ConfigSummaryPanel.tsx`

**`types.ts`**: Add `monthlyAddition: string` to `BacktestFormState` after `accountBalance`.

**`ConfigurationForm.tsx`**:

Add to `EMPTY_FORM`:
```typescript
monthlyAddition: '',
```

Add to `validateField` switch:
```typescript
case 'monthlyAddition': {
  if (!value || (value as string).trim() === '') return undefined // optional
  const n = parseFloat(value as string)
  if (isNaN(n) || n < 0) return 'Monthly addition must be >= 0'
  return undefined
}
```

Add `FormInput` in the JSX grid (after accountBalance):
```tsx
<FormInput
  label="Monthly Addition (USDT)"
  type="text"
  value={values.monthlyAddition}
  onChange={(val) => handleChange('monthlyAddition', val)}
  onBlur={() => handleBlur('monthlyAddition')}
  error={errors.monthlyAddition}
  touched={touched.monthlyAddition}
  placeholder="e.g., 500.00 (0 = disabled)"
  serverError={serverErrors.monthlyAddition}
/>
```

**`backtest-api.ts`** — in `apiPayload`:
```typescript
monthly_addition: config.monthlyAddition && config.monthlyAddition.trim() !== ''
  ? config.monthlyAddition
  : '0',
```

In `mapConfigToFormState`:
```typescript
monthlyAddition: c.monthly_addition ?? '',
```

**`ConfigSummaryPanel.tsx`** — in `LABELS`:
```typescript
monthlyAddition: 'Monthly Addition',
```

**Verify**:
```bash
cd frontend
npm test
```

---

## Step 3: Go Engine — Orchestrator State Management

**File**: `core-engine/application/orchestrator/orchestrator.go`

**Step 3a**: Add fields to struct:
```go
type Orchestrator struct {
    psm               position.PositionStateMachine
    eventBus          *EventBus
    config            *OrchestratorConfig
    position          *position.Position
    globalCandleCount int64
    runningBalance    decimal.Decimal
}
```

**Step 3b**: Initialize at the top of `RunBacktest` (replace existing `lastMonth`/`runningBalance` local var block):
```go
orch.globalCandleCount = 0
if orch.config.DomainConfig != nil {
    orch.runningBalance = orch.config.DomainConfig.AccountBalance()
}
```

**Step 3c**: Increment counter and apply monthly tick at the top of the candle loop, before the `orch.position == nil` check:
```go
orch.globalCandleCount++

if orch.config.DomainConfig != nil {
    monthlyAdd := orch.config.DomainConfig.MonthlyAddition()
    if !monthlyAdd.IsZero() && orch.globalCandleCount%43200 == 0 {
        prevBalance := orch.runningBalance
        orch.runningBalance = orch.runningBalance.Add(monthlyAdd)
        additionNumber := int(orch.globalCandleCount / 43200)
        if orch.position != nil {
            orch.position.AccountBalance = orch.position.AccountBalance.Add(monthlyAdd)
            monthlyEvent := &position.MonthlyAdditionEvent{
                TradeID:         orch.position.TradeID,
                Timestamp:       candle.Timestamp,
                AdditionAmount:  monthlyAdd.String(),
                PreviousBalance: prevBalance.String(),
                NewBalance:      orch.position.AccountBalance.String(),
                AdditionNumber:  additionNumber,
                DaysSinceStart:  int(orch.globalCandleCount / 1440),
            }
            orchEvent := Event{
                Timestamp: candle.Timestamp,
                Type:      EventType("monthly.addition"),
                Data:      monthlyEvent,
                RawEvent:  monthlyEvent,
            }
            if appendErr := orch.eventBus.Append(orchEvent); appendErr != nil {
                slog.Warn("failed to append MonthlyAdditionEvent", "err", appendErr)
            }
            eventCount++
        }
    }
}
```

**Step 3d**: Replace the existing account-balance assignment on `NewPosition`:
```go
// Was:
if !runningBalance.IsZero() {
    newPos.AccountBalance = runningBalance
} else {
    newPos.AccountBalance = orch.config.DomainConfig.AccountBalance()
}
// Replace with:
newPos.AccountBalance = orch.runningBalance
```

**Step 3e**: Add profit carryover after `OnPositionClosed` callback:
```go
if profit, parseErr := decimal.NewFromString(tce.Profit); parseErr == nil {
    orch.runningBalance = orch.runningBalance.Add(profit)
} else {
    slog.Warn("could not parse trade profit for balance carryover", "profit", tce.Profit, "err", parseErr)
}
```

**Verify**:
```bash
cd core-engine
go build ./...
go test ./application/orchestrator/...
```

---

## Step 4: PSM Cleanup

**File**: `core-engine/domain/position/minute_loop.go`

**Remove** the entire `if pos.CandleCount > 0 && pos.CandleCount%43200 == 0 ...` block (approximately 15 lines). Keep `pos.CandleCount++`.

**Update tests**: In `monthly_addition_test.go`, update T088–T091 scenarios:
- Old assertion: "PSM emits MonthlyAdditionEvent at candle 43,200" → **change to**: "PSM emits NO MonthlyAdditionEvent at candle 43,200 (this is now Orchestrator's responsibility)"
- Verify `pos.AccountBalance` is unchanged at the 43,200 boundary.

**Verify**:
```bash
cd core-engine
go test ./domain/position/...
```

---

## Step 6: ResultAggregator ROI Correction (US6)

**Files touched**: `orchestrator/api/src/types/index.ts`, `orchestrator/api/src/services/ResultAggregator.ts`, `orchestrator/api/src/services/ResultAggregator.test.ts`

**`types/index.ts`** — add to `PnlSummary` interface:
```typescript
total_additions?: string;  // sum of all monthly addition amounts; absent = "0"
```

**`ResultAggregator.ts`** — three changes inside `aggregateGoEvents`:

1. Add accumulator after existing ones (~line 251):
```typescript
let totalAdditions = new Decimal(0);
```

2. Add event branch in the `for` loop (after `PositionClosed` branch):
```typescript
} else if (type === 'monthly.addition') {
  try {
    totalAdditions = totalAdditions.plus(new Decimal(d.addition_amount ?? '0'));
  } catch {
    console.warn('[ResultAggregator] unparseable monthly.addition amount:', d.addition_amount);
  }
}
```

3. Correct ROI denominator (~line 295) and add `total_additions` to return:
```typescript
const roiDenominator = accBalance.plus(totalAdditions);
const roiPercent = roiDenominator.isZero()
  ? new Decimal(0)
  : totalPnl.dividedBy(roiDenominator).times(100);
// ... in return object:
total_additions: PrecisionFormatter.formatPrice(totalAdditions),
```

**`ResultAggregator.test.ts`** — add test cases:
- 3 monthly additions of `"500"` + `realizePnl = "250"` + `accountBalance = "1000"` → `roi_percent = "10.00000000"`, `total_additions = "1500.00000000"`
- Baseline (0 additions) → roi unchanged vs existing formula; `total_additions = "0.00000000"`
- Unparseable `addition_amount = "abc"` → does not throw; `total_additions = "0.00000000"`

**Verify**:
```bash
cd orchestrator/api
npx jest ResultAggregator --coverage
```

---

## Step 7: TradingTimeline Component (US8)

**Files touched**: `frontend/src/components/TradingTimeline.tsx` (NEW), `frontend/src/components/DashboardView.tsx`, `frontend/src/__tests__/TradingTimeline.test.tsx` (NEW)

**What to build**: A vertical timeline component that renders capital injection cards (left side) and expandable trade summary cards (right side) in chronological order. Running equity is computed via `decimal.js` across all events.

**`TradingTimeline.tsx`** — props:
```typescript
interface TradingTimelineProps {
  tradeEvents: TradeEvent[]
  tradeGroups: TradeGroupMetrics[]
  initialBalance: number
}
```

Key implementation points:
- Extract `InjectionItem`s from `tradeEvents.filter(e => e.eventType === 'DEPOSIT')`
- Build `TradeItem`s from `tradeGroups` (closed trades only)
- Sort all items by `rawTimestamp` ascending
- Compute running equity trail with `decimal.js` (never `Number` arithmetic)
- `CapitalInjectionCard`: green header "CAPITAL INJECTION", timestamp, `+$X,XXX.XX`, `Equity: $X,XXX.XX`
- `TradeSummaryCard`: `#N` badge, duration, fill ratio (`fillCount/maxOrders`), capital deployed, P&L (green/red), date range, equity; click to expand/collapse
- `TradeOrdersDetail`: dark table, columns: TIME | ACTION | PRICE | QUANTITY | COST/PNL | FEE DEDUCTED

**`DashboardView.tsx`** — add below KpiGrid:
```tsx
<TradingTimeline
  tradeEvents={results.tradeEvents}
  tradeGroups={metrics.tradeGroups}
  initialBalance={parseFloat(config.accountBalance) || 0}
/>
```

**`TradingTimeline.test.tsx`** — test fixture:
```typescript
// initialBalance: 1000, injection $1000 Jan 1, trade #1 +$45.50, injection $250 Feb 1, trade #2 -$12.25
// Expected equity trail: 1000 → 1045.50 → 1295.50 → 1283.25
```

Cover: card count + order, equity trail arithmetic, expand/collapse toggle, zero-injection regression.

**Verify**:
```bash
cd frontend
npx jest TradingTimeline --coverage
npx jest  # full suite must be green
```

---

## Common Pitfalls

1. **Double-injection**: If the PSM `% 43200` block is not removed before testing the Orchestrator tick, every open-position month boundary fires twice. Always do Step 4 (PSM cleanup) before Step 3's integration test.

2. **`runningBalance` starts as zero decimal**: The `decimal.Decimal` zero value is `0`, which is falsy with `.IsZero()`. The old code guarded `if !runningBalance.IsZero()` — remove this guard; always use `orch.runningBalance` directly since it is explicitly initialised at the start of `RunBacktest`.

3. **PSM test T088 will fail after Step 4** until you update its assertion. This is expected — change the assertion, not the test framework.

4. **`monthly_addition` absent vs `"0"`**: The Go engine defaults absent to `decimal.Zero`; the API default is `"0"`. Both are equivalent. Do not add special-case handling for the absence case in the Orchestrator — the domain config's `MonthlyAddition()` returning `decimal.Zero` is sufficient.

5. **Running equity in TradingTimeline must use `decimal.js`**: Do not use JavaScript `Number` arithmetic for the equity trail. The canonical test values (1000 → 1045.50 → 1295.50 → 1283.25) will drift with float arithmetic at higher precisions.
```

---

## Step 5: Full Integration Smoke Test

```bash
# 1. (Re)build the Go engine binary
cd core-engine
go build -o ../orchestrator/api/core-engine.exe ./cmd/engine/

# 2. Start Postgres (if not running)
cd ..
docker-compose up -d postgres

# 3. Start the orchestrator API
cd orchestrator/api
npm run dev &

# 4. Submit a test backtest with monthly_addition
curl -s -X POST http://localhost:4000/backtests \
  -H "Content-Type: application/json" \
  -d '{
    "trading_pair": "BTC/USDC",
    "start_date": "2022-01-01T00:00:00Z",
    "end_date": "2022-04-30T23:59:59Z",
    "price_entry": "2.0",
    "price_scale": "1.1",
    "amount_scale": "2.0",
    "number_of_orders": 3,
    "amount_per_trade": "0.5",
    "margin_type": "cross",
    "multiplier": 1,
    "take_profit_distance_percent": "2.0",
    "account_balance": "1000.00",
    "monthly_addition": "500.00",
    "exit_on_last_order": false
  }' | jq .

# 5. Retrieve results and verify MonthlyAdditionEvent count
# Expected: at least 3 MonthlyAdditionEvents in the event bus (for a ~120-day run)
```

---

## Common Pitfalls

1. **Double-injection**: If the PSM `% 43200` block is not removed before testing the Orchestrator tick, every open-position month boundary fires twice. Always do Step 4 (PSM cleanup) before Step 3's integration test.

2. **`runningBalance` starts as zero decimal**: The `decimal.Decimal` zero value is `0`, which is falsy with `.IsZero()`. The old code guarded `if !runningBalance.IsZero()` — remove this guard; always use `orch.runningBalance` directly since it is explicitly initialised at the start of `RunBacktest`.

3. **PSM test T088 will fail after Step 4** until you update its assertion. This is expected — change the assertion, not the test framework.

4. **`monthly_addition` absent vs `"0"`**: The Go engine defaults absent to `decimal.Zero`; the API default is `"0"`. Both are equivalent. Do not add special-case handling for the absence case in the Orchestrator — the domain config's `MonthlyAddition()` returning `decimal.Zero` is sufficient.
