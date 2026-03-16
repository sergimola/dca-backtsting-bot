# Data Model: Go Engine I/O Optimization

**Date**: 2026-03-15 | **Feature**: 011-go-engine-io-optimization | **Phase**: 1

---

## Go Engine Structs (new / replaced in `core-engine/cmd/engine/`)

### ProgressPayload

Emitted to stdout every `--progress-interval-ms` milliseconds during the hot loop.

```go
// ProgressPayload is the JSON object emitted to stdout on each ticker tick.
// JSON field names are snake_case to match the TypeScript ProgressLine interface.
type ProgressPayload struct {
    Type             string  `json:"type"`              // always "progress"
    Percent          float64 `json:"percent"`           // 0–99 (capped; 100 only on final result)
    CurrentDate      string  `json:"current_date"`      // RFC3339 timestamp of last processed candle
    ProcessedCandles int64   `json:"processed_candles"` // candles consumed so far
    TotalCandles     int64   `json:"total_candles"`     // from pre-flight COUNT; 0 if unknown
    CurrentPrice     float64 `json:"current_price"`     // last candle close (InexactFloat64)
    RealizedPnl      float64 `json:"realized_pnl"`      // cumulative PositionClosed.profit (InexactFloat64)
    CandlesPerSecond int64   `json:"candles_per_second"` // candles processed in the last tick window
}
```

### PnlSummaryOutput

Matches the TypeScript `StoredPnlSummary` interface **exactly** (camelCase JSON tags).

```go
// PnlSummaryOutput is the aggregate financial summary for the full backtest.
// JSON tags MUST match orchestrator/api/src/types/index.ts StoredPnlSummary exactly.
type PnlSummaryOutput struct {
    Roi         float64 `json:"roi"`         // (realizedPnl / accountBalance) * 100
    MaxDrawdown float64 `json:"maxDrawdown"` // peak-to-trough equity drawdown as percent
    TotalFees   float64 `json:"totalFees"`   // entryFees + tradingFees + sellFees
}
```

### TradeEventOutput

Matches the TypeScript `StoredTradeEvent` interface field-for-field (mixed case JSON tags — note `trade_id` is snake_case in the TS interface and must remain so).

```go
// TradeEventOutput is a single frontend-ready trade event.
// JSON tags MUST match orchestrator/api/src/types/index.ts StoredTradeEvent exactly.
type TradeEventOutput struct {
    Timestamp    string  `json:"timestamp"`    // localized display string via time.Local.Format
    RawTimestamp string  `json:"rawTimestamp"` // RFC3339 UTC
    EventType    string  `json:"eventType"`    // "ENTRY" | "SAFETY_ORDER" | "EXIT"
    Price        float64 `json:"price"`
    Quantity     float64 `json:"quantity"`
    Balance      float64 `json:"balance"`      // cost for ENTRY/SAFETY_ORDER; profit for EXIT
    TradeID      string  `json:"trade_id"`     // NOTE: snake_case — matches TS interface
    Fee          float64 `json:"fee"`
}
```

### SafetyOrderUsageEntry

```go
// SafetyOrderUsageEntry is a histogram bucket for safety order depth usage.
// JSON tags match the TypeScript { level: string; count: number } shape.
type SafetyOrderUsageEntry struct {
    Level string `json:"level"` // "1", "2", "3", ... (1-indexed string)
    Count int    `json:"count"`
}
```

### EngineResultPayload (replaces BacktestOutput)

The single JSON line emitted to stdout at simulation end.

```go
// EngineResultPayload is the final JSON line emitted to stdout.
// JSON tags MUST match the TypeScript EngineResultLine interface in contracts/.
// IMPORTANT: ExecutionTimeMs uses camelCase json tag to match the TS convention.
type EngineResultPayload struct {
    Type             string                  `json:"type"`             // always "result"
    PnlSummary       PnlSummaryOutput        `json:"pnlSummary"`
    TradeEvents      []TradeEventOutput      `json:"tradeEvents"`
    SafetyOrderUsage []SafetyOrderUsageEntry `json:"safetyOrderUsage"`
    ExecutionTimeMs  int64                   `json:"executionTimeMs"`
    CandleCount      int                     `json:"candleCount"`
    EventCount       int                     `json:"eventCount"`
}
```

---

## TypeScript Interfaces (new / changed in `orchestrator/api/src/`)

### ProgressLine (new — `types/index.ts`)

```typescript
export interface ProgressLine {
  type: 'progress';
  percent: number;
  current_date: string;           // RFC3339
  processed_candles: number;
  total_candles: number;
  current_price: number;
  realized_pnl: number;
  candles_per_second: number;
}
```

### SafetyOrderUsageEntry (new — `types/index.ts`)

```typescript
export interface SafetyOrderUsageEntry {
  level: string;
  count: number;
}
```

### BacktestExecutionResult (changed — `services/BacktestService.ts`)

The old shape (`{events, finalPosition, executionTimeMs}`) is replaced by the engine's structured payload:

```typescript
// Old shape (DELETED):
// export interface BacktestExecutionResult {
//   events: any[];
//   finalPosition: any | null;
//   executionTimeMs: number;
// }

// New shape matches EngineResultPayload minus the `type` discriminant:
export interface BacktestExecutionResult {
  pnlSummary: StoredPnlSummary;
  tradeEvents: StoredTradeEvent[];
  safetyOrderUsage: SafetyOrderUsageEntry[];
  engineExecutionTimeMs: number;  // engine's internal timing (from EngineResultPayload.executionTimeMs)
  candleCount: number;
  eventCount: number;
}
```

---

## PostgreSQL Schema Changes (Drizzle)

### Current state of `backtests` table

| Column | Type | Current? |
|---|---|---|
| `id` | uuid PK | ✅ |
| `status` | text | ✅ |
| `config` | jsonb | ✅ |
| `summary` | jsonb | ✅ |
| `trades` | jsonb | ✅ |
| `safety_orders` | jsonb | ✅ |
| `execution_time_ms` | integer | ✅ (migration 0001) |
| `error_message` | text | ✅ |
| `created_at` | timestamptz | ✅ |
| `updated_at` | timestamptz | ✅ |
| `progress` | integer | ❌ NEEDS ADDING |
| `current_metrics` | jsonb | ❌ NEEDS ADDING |

### Required migration (new file `drizzle/0002_*.sql`)

```sql
ALTER TABLE "backtests" ADD COLUMN "progress" integer NOT NULL DEFAULT 0;
ALTER TABLE "backtests" ADD COLUMN "current_metrics" jsonb;
```

### Updated `schema.ts` additions

```typescript
import { pgTable, uuid, text, jsonb, integer, timestamp, check } from 'drizzle-orm/pg-core';
import type { StoredPnlSummary, StoredTradeEvent, ProgressLine } from '../types/index.js';

export const backtests = pgTable('backtests', {
  // ... existing columns unchanged ...
  progress:        integer('progress').notNull().default(0),
  currentMetrics:  jsonb('current_metrics').$type<ProgressLine | null>(),
});
```

### New `BacktestJobRepository.updateProgress()` method

```typescript
/**
 * Lightweight UPDATE to record the engine's progress percentage.
 * Called by BackgroundWorker on every 'progress' line from the engine.
 * Only touches `progress`, `current_metrics`, and `updated_at` — never status.
 */
async updateProgress(
  id: string,
  percent: number,
  metrics?: ProgressLine,
): Promise<void> {
  await db
    .update(backtests)
    .set({
      progress:       Math.max(0, Math.min(100, Math.floor(percent))),
      ...(metrics ? { currentMetrics: metrics } : {}),
      updatedAt:      new Date(),
    })
    .where(eq(backtests.id, id));
}
```

Also update `claimNext()` raw SQL mapping to include the two new columns:

```typescript
return {
  // existing fields...
  progress:      (row['progress'] as number) ?? 0,
  currentMetrics: (row['current_metrics'] as ProgressLine | null) ?? null,
};
```

---

## Aggregation Algorithm (in-Go port)

### aggregateBacktestEvents() — ports ResultAggregator.aggregateGoEvents()

Input: `[]orchestrator.Event`, `accountBalance decimal.Decimal`
Output: intermediate aggregation result used to build `PnlSummaryOutput` + the safety order usage map

```
Walk events:
  PositionOpened:     entryFees += decimal(data.entry_fee)
  BuyOrderExecuted:   tradingFees += decimal(data.fee)
                      soIndex = data.order_number - 1
                      safetyOrderCounts[soIndex]++
                      totalFills++
  SellOrderExecuted:  tradingFees += decimal(data.fee)
                      pendingSellFee = decimal(data.fee)  // patch next PositionClosed
  PositionClosed:     realizedPnl += decimal(data.profit)
                      // Max drawdown tracking:
                      runningEquity = accountBalance + realizedPnl
                      if runningEquity > peakEquity: peakEquity = runningEquity
                      drawdown = (peakEquity - runningEquity) / peakEquity * 100
                      if drawdown > maxDrawdown: maxDrawdown = drawdown

totalFees = entryFees + tradingFees
roi = (realizedPnl / accountBalance) * 100  (0 if accountBalance is zero)
```

### buildTradeEvents() — ports processGoEventsForFrontend()

```
tradeCounter = 0
currentTradeID = "0"
Walk events:
  PositionOpened:
    tradeCounter++
    currentTradeID = strconv.Itoa(tradeCounter)
    entry = data.configured_orders[0]
    cost = decimal(entry.amount)
    price = decimal(entry.price)
    qty = cost / price
    emit TradeEventOutput{
      Timestamp: formatLocal(event.Timestamp)
      RawTimestamp: event.Timestamp.Format(RFC3339)
      EventType: "ENTRY"
      Price: price.InexactFloat64()
      Quantity: qty.InexactFloat64()
      Balance: cost.InexactFloat64()
      TradeID: currentTradeID
      Fee: decimal(data.entry_fee).InexactFloat64()
    }

  BuyOrderExecuted:
    price = decimal(data.price)
    qty = decimal(data.base_size)
    emit TradeEventOutput{...EventType: "SAFETY_ORDER", Balance: price*qty, TradeID: currentTradeID}

  PositionClosed:
    lastExitEvent = TradeEventOutput{...EventType: "EXIT", Balance: decimal(data.profit), Fee: 0}
    emit lastExitEvent

  SellOrderExecuted (immediately follows PositionClosed):
    if lastExitEvent != nil:
      lastExitEvent.Fee = decimal(data.fee).InexactFloat64()
      lastExitEvent = nil
    skip (do not emit)

  All other event types: skip
```
