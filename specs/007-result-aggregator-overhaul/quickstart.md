# Quickstart: Result Aggregator Overhaul

**Branch**: `007-result-aggregator-overhaul`  
**Date**: 2026-03-14

This guide describes the four targeted changes an implementer must make and how to verify each one in isolation.

---

## Prerequisites

```powershell
# All commands from repo root
cd "D:\personal\bot-dca\dca-bot\DCA Backtesting bot"

# Confirm tests are green before starting (Green Light Protocol)
cd orchestrator/api && npm test -- --passWithNoTests 2>&1 | tail -5
cd ../../frontend   && npm test 2>&1 | tail -5
```

---

## Change 1 — Fix SO0 Bug in ResultAggregator (`orchestrator/api`)

**File**: `orchestrator/api/src/services/ResultAggregator.ts`  
**Method**: `aggregateGoEvents()`

**What to remove** (inside the `if (type === 'PositionOpened')` block):
```typescript
// DELETE these two lines:
totalFills++;
safetyOrderUsageCounts[0] = (safetyOrderUsageCounts[0] ?? 0) + 1;
```

**What remains in the PositionOpened block** after the fix:
```typescript
if (type === 'PositionOpened') {
  const fee = new Decimal(d.entry_fee ?? '0');
  entryFee = entryFee.plus(fee);
  // ← no totalFills increment; no safetyOrderUsageCounts write
}
```

**Verify**:
```powershell
cd orchestrator/api
npm test -- --testPathPattern="ResultAggregator"
# Expect: all existing tests pass + new test "PositionOpened not counted in safety orders"
```

---

## Change 2 — Incremental Trade Counter + SellOrderExecuted Fee (`frontend`)

**File**: `frontend/src/services/backtest-api.ts`  
**Function**: `getResults()`

Replace the `.filter().map()` chain with an imperative loop:

```typescript
// BEFORE (remove):
const tradeEvents = (data.events as any[])
  .filter((e) => FILL_EVENT_TYPES.has(e.type))
  .map((e) => { ... trade_id: (d.trade_id as string) ?? '' ... });

// AFTER (replace with):
let tradeCounter = 0;
let lastExitEvent: any | null = null;  // reference to patch SellOrderExecuted fee
const tradeEvents: TradeEvent[] = [];

for (const e of data.events as any[]) {
  const d: any = e.data ?? {};
  
  if (e.type === 'PositionOpened') {
    tradeCounter++;
    lastExitEvent = null;
    const entryOrder = d.configured_orders?.[0] ?? {};
    const tradeCost = parseFloat(entryOrder.amount ?? '0');
    const price = parseFloat(entryOrder.price ?? '0');
    tradeEvents.push({
      timestamp: new Date(e.timestamp ?? '').toLocaleString(),
      rawTimestamp: e.timestamp ?? '',
      eventType: 'ENTRY',
      price,
      quantity: tradeCost / price || 0,
      balance: tradeCost,
      trade_id: String(tradeCounter),
      fee: parseFloat(d.entry_fee ?? '0'),
    });

  } else if (e.type === 'BuyOrderExecuted') {
    const btcQty = parseFloat(d.base_size ?? '0');
    const price  = parseFloat(d.price ?? '0');
    tradeEvents.push({
      timestamp: new Date(e.timestamp ?? '').toLocaleString(),
      rawTimestamp: e.timestamp ?? '',
      eventType: 'SAFETY_ORDER',
      price,
      quantity: btcQty,
      balance: price * btcQty,
      trade_id: String(tradeCounter),
      fee: parseFloat(d.fee ?? '0'),
    });

  } else if (e.type === 'PositionClosed') {
    const exitEvent: TradeEvent = {
      timestamp: new Date(e.timestamp ?? '').toLocaleString(),
      rawTimestamp: e.timestamp ?? '',
      eventType: 'EXIT',
      price:    parseFloat(d.closing_price ?? '0'),
      quantity: parseFloat(d.size          ?? '0'),
      balance:  parseFloat(d.profit        ?? '0'),
      trade_id: String(tradeCounter),
      fee: 0,  // patched below when SellOrderExecuted arrives
    };
    tradeEvents.push(exitEvent);
    lastExitEvent = exitEvent;

  } else if (e.type === 'SellOrderExecuted') {
    // Patch exit fee onto the preceding PositionClosed event
    if (lastExitEvent) {
      lastExitEvent.fee = parseFloat(d.fee ?? '0');
      lastExitEvent = null;
    }
  }
  // price.changed, LiquidationPriceUpdated → ignored
}
```

**Verify**:
```powershell
cd frontend
npm test -- --testPathPattern="backtest-api"
# Expect: trade_id = "1", "2", "3"... per trade; EXIT event has non-zero fee
```

---

## Change 3 — Fix Safety Order Chart Loop (`frontend`)

**File**: `frontend/src/services/backtest-api.ts`  
**Location**: The `safetyOrderUsage` padding loop, just after the `tradeEvents` loop.

```typescript
// BEFORE:
for (let i = 0; i < numberOfOrders; i++) {

// AFTER:
for (let i = 1; i < numberOfOrders; i++) {
```

Also update the `level` field to show `SO${i}` format if desired by the chart, or leave as `String(i)` — the chart already reads the `level` field as the X-axis label.

**Verify**:
```powershell
cd frontend
npm test -- --testPathPattern="backtest-api"
# Expect: safetyOrderUsage array starts at level "1", no level "0" entry
```

---

## Change 4 — Accordion Header Redesign & "Total Net P&L" Label (`frontend`)

**File**: `frontend/src/components/ResultsDashboard.tsx`

### 4a. TradeAccordion header

Replace the header `<button>` content to compute and display Gross/Fees/Net:

```tsx
// Compute per-trade values using Decimal for the addition
import Decimal from 'decimal.js'

// Inside TradeAccordion, replace: const feesPaid / netProfit / shortId block with:
const exitEvent = events.find(e => e.eventType === 'EXIT')
const netProfit  = exitEvent ? exitEvent.balance : null
const feesPaid   = events.reduce((sum, e) => new Decimal(sum).plus(e.fee ?? 0).toNumber(), 0)
const grossProfit = netProfit !== null
  ? new Decimal(netProfit).plus(feesPaid).toNumber()
  : null
const tradeLabel = `Trade #${tradeId}`

// Replace the collapsed header JSX with:
<button onClick={...} className="w-full flex items-center justify-between px-5 py-3.5 bg-slate-800 hover:bg-slate-750 transition-colors text-left">
  <div className="flex items-center gap-4 min-w-0 flex-wrap">
    <span className="font-semibold text-slate-200 text-sm">{tradeLabel}</span>
    <span className="text-slate-400 text-sm">|</span>
    <span className="text-slate-300 text-sm tabular-nums">
      Gross: <span className="font-semibold">{grossProfit !== null ? `${grossProfit >= 0 ? '+' : ''}$${grossProfit.toFixed(2)}` : '—'}</span>
    </span>
    <span className="text-slate-400 text-sm">|</span>
    <span className="text-slate-300 text-sm tabular-nums">
      Fees: <span className="font-semibold text-slate-400">-${feesPaid.toFixed(2)}</span>
    </span>
    <span className="text-slate-400 text-sm">|</span>
    <span className="text-slate-300 text-sm tabular-nums">
      Net: <span className={`font-semibold ${netProfit === null ? 'text-slate-400' : netProfit > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
        {netProfit !== null ? `${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}` : '—'}
      </span>
    </span>
  </div>
  <span className="text-slate-500 text-xs select-none ml-4">{open ? '▲' : '▼'}</span>
</button>
```

### 4b. "Total Net P&L" label

In the Metrics Cards section, find:
```tsx
<p className="text-gray-500 text-xs uppercase tracking-wide mb-1">Total P&L</p>
```
And change to:
```tsx
<p className="text-gray-500 text-xs uppercase tracking-wide mb-1">Total Net P&L</p>
```

*(If the existing card shows "Return on Investment" and doesn't currently have "Total P&L", add/find the P&L card. The stored JSON shows `total_pnl` but the current `pnlSummary` only exposes `roi`, `maxDrawdown`, `totalFees` — if a "Total P&L" card is added, ensure it reads from `pnlSummary.totalPnl` and is labelled "Total Net P&L".)*

**Verify** (visual + snapshot):
```powershell
cd frontend && npm run dev
# Open http://localhost:5173 → run a backtest → inspect accordion headers
# Verify: Trade #1, #2, … ; Gross/Fees/Net shown; Net is green if >0, red if <0
```

---

## Running All Tests

```powershell
# Orchestrator API tests
cd "D:\personal\bot-dca\dca-bot\DCA Backtesting bot\orchestrator\api"
npm test

# Frontend tests  
cd "D:\personal\bot-dca\dca-bot\DCA Backtesting bot\frontend"
npm test
```

Expected: all pre-existing tests pass; new tests for SO chart loop, trade counter, and exit fee patching pass.

---

## Test Cases to Add

### ResultAggregator.test.ts — new test block: `aggregateGoEvents`

```typescript
describe('aggregateGoEvents — Safety Order Usage', () => {
  it('should NOT count PositionOpened in safetyOrderUsageCounts', async () => {
    const events = [
      { type: 'PositionOpened', data: { entry_fee: '0.1' } },
      { type: 'PositionClosed',  data: { profit: '-1.0' } },
    ];
    const summary = await aggregator.aggregateGoEvents(events, '1000');
    expect(summary.safety_order_usage_counts).toEqual({});
    expect(summary.total_fills).toBe(0);
  });

  it('should record BuyOrderExecuted at 1-based level (order_number 2 → level 1)', async () => {
    const events = [
      { type: 'PositionOpened',     data: { entry_fee: '0.1' } },
      { type: 'BuyOrderExecuted',   data: { fee: '0.05', order_number: 2, base_size: '0.01', price: '50000' } },
      { type: 'SellOrderExecuted',  data: { fee: '0.08' } },
      { type: 'PositionClosed',     data: { profit: '2.0' } },
    ];
    const summary = await aggregator.aggregateGoEvents(events, '1000');
    expect(summary.safety_order_usage_counts).toEqual({ 1: 1 });
    expect(summary.safety_order_usage_counts[0]).toBeUndefined();
    expect(summary.total_fills).toBe(1);
  });
});
```

### backtest-api.test.ts — new tests

```typescript
it('should assign sequential trade IDs ignoring engine trade_id', async () => {
  // Mock response with 2 PositionOpened events, same engine trade_id
  // getResults() should return tradeEvents with trade_id "1" and "2"
});

it('should patch SellOrderExecuted fee onto the preceding EXIT event', async () => {
  // Mock response: PositionClosed then SellOrderExecuted
  // getResults() should return EXIT event with fee = SellOrderExecuted.fee
});

it('should start safety order usage array at level 1', async () => {
  // Mock response with numberOfOrders=5 and pnl_summary.safety_order_usage_counts = {"1":3}
  // getResults() should return safetyOrderUsage starting at level "1"
  // No level "0" entry
});
```
