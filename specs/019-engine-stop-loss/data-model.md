# Data Model: Engine Stop-Loss Mechanism

**Feature**: 019-engine-stop-loss  
**Date**: April 3, 2026

---

## New Config Fields (`domain/config/config.go`)

| Field | Go Type | JSON Key | Default | Constraints |
|-------|---------|----------|---------|-------------|
| `stopLossEnabled` | `bool` | `stop_loss_enabled` | `false` | — |
| `stopLossPercent` | `decimal.Decimal` | `stop_loss_percent` | `0` | > 0 and ≤ 100 when enabled |
| `stopLossBaseline` | `string` | `stop_loss_baseline` | `"average_entries"` | `"first_entry"` \| `"average_entries"` |
| `stopLossTimeoutMinutes` | `int` | `stop_loss_timeout_minutes` | `0` | ≥ 0 |

**Validation rules** (added to `Config.Validate()`):
- When `stopLossEnabled = true`: `stopLossPercent > 0 && <= 100`
- When `stopLossEnabled = true`: `stopLossBaseline in ["first_entry", "average_entries"]`
- When `stopLossEnabled = true`: `stopLossTimeoutMinutes >= 0`
- When `stopLossEnabled = false`: other SL fields are ignored (no validation)

---

## New Position Runtime State Fields (`domain/position/position.go`)

These fields are added to the `Position` struct. They are set at position open from `domain/config.Config` and updated during candle processing.

| Field | Go Type | Description |
|-------|---------|-------------|
| `StopLossEnabled` | `bool` | Copied from config at position open |
| `StopLossPercent` | `decimal.Decimal` | Copied from config at position open |
| `StopLossBaseline` | `string` | `"first_entry"` or `"average_entries"` |
| `StopLossTimeoutMinutes` | `int` | 0 = immediate; >0 = timeout |
| `SlTriggerPrice` | `decimal.Decimal` | Computed at position open (first_entry) or after each SO fill (average_entries); zero if SL disabled |
| `SlBreachTimestamp` | `time.Time` | zero value (`time.Time{}`) when no active breach; set to `candle.Timestamp` when Low ≤ SlTriggerPrice; cleared via `time.Time{}` on recovery. Value type (not pointer) — avoids heap escape and GC overhead in the hot candle loop. Check with `.IsZero()`. |

**State transitions**:
```
nil (no breach) ──[Low ≤ trigger]──→ &candle.Timestamp
&t (breach active) ──[Low > trigger]──→ nil  (reset)
&t (breach active) ──[elapsed ≥ timeout]──→ EXECUTE STOP (close position)
&t (breach active) ──[TP fires first]──→ nil  (TP wins, SL cleared)
```

---

## New Domain Event (`domain/position/events.go`)

### `StopLossExecutedEvent`

Emitted when a stop-loss closes a position. Replaces `SellOrderExecutedEvent` for SL closes.

```go
type StopLossExecutedEvent struct {
    RunID         string    `json:"run_id"`
    TradeID       string    `json:"trade_id"`
    Timestamp     time.Time `json:"timestamp"`
    TradingPair   string    `json:"trading_pair"`
    ExecutionPrice string   `json:"execution_price"`  // candle.Close at breach or timeout candle
    Size           string   `json:"size"`              // total base quantity sold
    RealizedLoss   string   `json:"realized_loss"`     // negative decimal string
    Fee            string   `json:"fee"`               // taker fee decimal string
}
```

`EventType()` returns `"stop_loss.executed"`

### Updated `TradeClosedEvent.Reason`

New allowed value: `"stop_loss"` (added to existing `"take_profit"`, `"liquidation"`, `"end_of_backtest"`, `"last_order_filled"`)

---

## Updated Engine I/O Contracts (`cmd/engine/main.go`)

### `EngineRequest` — 4 new fields

```go
StopLossEnabled          bool   `json:"stop_loss_enabled,omitempty"`
StopLossPercent          string `json:"stop_loss_percent,omitempty"`
StopLossBaseline         string `json:"stop_loss_baseline,omitempty"`
StopLossTimeoutMinutes   int    `json:"stop_loss_timeout_minutes,omitempty"`
```

### `EngineResultPayload` — 2 new fields

```go
TotalStopsTriggered  int     `json:"total_stops_triggered"`
TotalTakeProfits     int     `json:"total_take_profits"`
```

`PnlSummaryOutput` gains `WinRate float64 json:"winRate"`.

---

## Database Schema Changes

### `sweep_run_summaries` — new column

```sql
total_stops_triggered  integer  NOT NULL DEFAULT 0
```

Migration file: `orchestrator/api/drizzle/0005_019_stop_loss_kpis.sql`

```sql
ALTER TABLE "sweep_run_summaries"
  ADD COLUMN "total_stops_triggered" integer DEFAULT 0 NOT NULL;
```

Drizzle schema addition (`orchestrator/api/src/db/schema.ts`):
```typescript
totalStopsTriggered: integer('total_stops_triggered').notNull().default(0),
```

---

## TypeScript Type Extensions

### `ApiSweepRunConfig` (or equivalent sweep config type)

4 new optional fields:
```typescript
stop_loss_enabled?: boolean;
stop_loss_percent?: string;                           // decimal string
stop_loss_baseline?: 'first_entry' | 'average_entries';
stop_loss_timeout_minutes?: number;
```

### `EngineResultLine` (TypeScript contract for Go output)

2 new fields:
```typescript
total_stops_triggered: number;
total_take_profits: number;
```

`StoredPnlSummary.winRate` already exists — it will now reflect SL losses.

---

## SL Trigger Price Formulas

### `first_entry` mode

```
SL_trigger = base_order_execution_price × (1 − stop_loss_percent / 100)
```

Computed once at position open. Never changes.

### `average_entries` mode

```
SL_trigger = volume_weighted_avg_entry × (1 − stop_loss_percent / 100)
```

Recomputed after each SO fill when `StopLossBaseline == "average_entries"`.

When the trigger recalculates (SO fill during active breach), check if `SlBreachTimestamp` should reset:
- If `new_trigger > candle.Low` → breach still active (candle's Low is still below new trigger)
- If `new_trigger < candle.Low` → price is now above new trigger → reset `SlBreachTimestamp = time.Time{}`

---

## SL Execution Formula

```
realized_loss = (execution_price - avg_entry_price) × position_quantity
taker_fee     = execution_price × position_quantity × taker_fee_rate
net_pnl       = realized_loss - taker_fee
```

`execution_price` = `candle.Close` of the triggering candle (immediate) or timeout candle.

---

## WideEvent Integration

No new fields required on `WideEvent`. The existing fields cover SL:
- `event_type = "position_closed"`
- `close_reason = "stop_loss"`
- `action_price` = execution price
- `action_fee` = taker fee
- `realized_pnl` = net PnL (negative)

---

## Pessimistic Execution Order (Updated)

```
Step 1: PriceChangedEvent
Step 2: Market buy (StateIdle → StateOpening) — first candle only
Step 3a: FillOrdersForCandle (buy orders at candle.Low)
Step 3b: Recalculate aggregates (avgEntry, liqPrice, tpTarget, fees)
         ↳ If average_entries: recalculate SlTriggerPrice; possibly reset SlBreachTimestamp
Step 3c: Liquidation check  [Low ≤ LiquidationPrice → close, RETURN]
Step 3c.5: Stop-Loss check  [Low ≤ SlTriggerPrice → breach/timeout/execute, RETURN if executed]
Step 3d: Take-Profit check  [High ≥ TakeProfitTarget → close, RETURN]
         ↳ On TP fires: clear SlBreachTimestamp
```

---

## Entity Relationship

```
Config (domain)
  ├── stop_loss_enabled: bool
  ├── stop_loss_percent: decimal
  ├── stop_loss_baseline: enum
  └── stop_loss_timeout_minutes: int
       │
       ▼ copied at position open
Position (runtime state)
  ├── StopLossEnabled: bool
  ├── StopLossPercent: decimal
  ├── StopLossBaseline: string
  ├── StopLossTimeoutMinutes: int
  ├── SlTriggerPrice: decimal       ← computed; updated on SO fill if average_entries
  └── SlBreachTimestamp: time.Time ← zero | candle.Timestamp; updated per candle
       │
       ▼ on execution
StopLossExecutedEvent
  ├── execution_price: decimal
  ├── realized_loss: decimal
  └── fee: decimal

TradeClosedEvent (reason="stop_loss")
  └── profit: decimal (negative or zero)
```
