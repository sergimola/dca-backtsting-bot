# Data Model: Result Aggregator Overhaul

**Date**: 2026-03-14  
**Branch**: `007-result-aggregator-overhaul`

---

## Overview

This feature does not introduce new persisted entities. All changes are to **in-memory computed values** that flow from the Go engine event stream → TypeScript adapter → React UI. No database schema or `ResultStore` file format is changed.

---

## Entities & Computed Values

### 1. TradeGroup (in-memory, frontend)

A runtime grouping of `TradeEvent[]` belonging to one DCA cycle. Created by `groupByTradeId()` in `ResultsDashboard.tsx`.

| Field | Type | Source | Notes |
|-------|------|--------|-------|
| `tradeId` | `string` | `tradeCounter` from `backtest-api.ts` | Sequential integer as string: `"1"`, `"2"`, … |
| `events` | `TradeEvent[]` | Filtered event stream | Chronological; includes ENTRY, SAFETY_ORDER, EXIT |
| `netProfit` | `number \| null` | `EXIT` event `.balance` (= `PositionClosed.profit`) | Null if position still open |
| `tradeTotalFees` | `number` | `Decimal.sum(events.map(e => e.fee))` — converted to JS number for display | Entry fee + SO fees + exit fee |
| `grossProfit` | `number \| null` | `netProfit + tradeTotalFees` (Decimal add) | Null if netProfit is null |

**Invariant**: `grossProfit = netProfit + tradeTotalFees` (to 8 decimal places).

---

### 2. TradeEvent (updated — `frontend/src/services/types.ts`)

Existing type; semantic change only on `trade_id`.

| Field | Type | Change |
|-------|------|--------|
| `trade_id` | `string` | **Repurposed**: previously Go engine UUID; now sequential integer string `"1"`, `"2"`, … |
| `fee` | `number` | **Fix**: `PositionClosed` events now carry the `SellOrderExecuted.fee` value (previously 0) |
| All other fields | unchanged | No structural changes |

---

### 3. SafetyOrderUsage array (updated — `backtest-api.ts` output)

The array passed to `<SafetyOrderChart>`.

| Before (buggy) | After (fixed) |
|----------------|---------------|
| `[{ level: "0", count: 0 }, { level: "1", count: 9 }, ...]` | `[{ level: "1", count: 9 }, { level: "2", count: 8 }, ...]` |
| Starts at level 0 (phantom SO0 from entry order) | Starts at level 1 (first actual safety order) |
| `for (let i = 0; i < numberOfOrders; i++)` | `for (let i = 1; i < numberOfOrders; i++)` |

---

### 4. PnlSummary.safety_order_usage_counts (updated — `ResultAggregator.ts`)

The map stored in the persisted result JSON under `pnl_summary`.

| Before (buggy) | After (fixed) |
|----------------|---------------|
| `{ "0": N, "1": 9, "2": 8, ... }` — entry counted as SO0 | `{ "1": 9, "2": 8, ... }` — entry excluded |
| `PositionOpened` handler writes `safetyOrderUsageCounts[0]++` | `PositionOpened` handler only accumulates `entryFee`; no write to counts map |
| `totalFills` incremented for every PositionOpened | `totalFills` only incremented for `BuyOrderExecuted` |

---

## State Transitions

No state machine changes. All modifications are to derived/computed values, not to position state.

---

## Validation Rules

| Rule | Where Enforced | Detail |
|------|---------------|--------|
| `grossProfit = netProfit + tradeTotalFees` | `TradeAccordion` unit tests | Must hold to 8 decimal places |
| `tradeTotalFees ≥ 0` | Assumed (fees are always positive costs) | Missing fee fields default to 0 |
| SO chart has no level-0 entry | `backtest-api.ts` unit tests | Loop starts at `i=1` |
| `safetyOrderUsageCounts` has no key `"0"` | `ResultAggregator.test.ts` | `PositionOpened` excluded |
| `tradeId` is sequential starting at 1 | `backtest-api.ts` unit tests | `tradeCounter` resets per `getResults()` call |
