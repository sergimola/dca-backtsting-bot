# Data Model: Spot Trading Liquidation Bypass (Multiplier = 1)

**Branch**: `014-spot-no-liquidation` | **Date**: 2026-03-23

## Summary of Changes

One domain entity is modified. No new entities, events, or state transitions are introduced.

---

## Modified Entity: `Position`

**File**: `core-engine/domain/position/position.go`

### New Field

| Field | Type | Default | Description |
|---|---|---|---|
| `Multiplier` | `decimal.Decimal` | `decimal.Zero` (0) | Leverage multiplier from config. `1` = spot (no liquidation). `> 1` = futures (liquidation active). Set once by orchestrator at position creation; never mutated. |

### Field Placement in Struct

The `Multiplier` field belongs in the "Exit strategy / configuration-derived invariants" section alongside `ExitOnLastOrder` and `TakeProfitDistance`:

```
Position {
    ...
    ExitOnLastOrder   bool             // set from Config.ExitOnLastOrder()
    Multiplier        decimal.Decimal  // set from Config.Multiplier()    ← NEW
    TakeProfitDistance decimal.Decimal // set from Config.TakeProfitDistancePercent()
    ...
}
```

### Invariant

Once `pos.Multiplier` is set by the orchestrator at position creation, it MUST NOT be mutated for the lifetime of that position. It is a configuration constant for that backtest run.

---

## Unchanged Entities

| Entity | Change |
|---|---|
| `OrderFill` | None |
| `Candle` | None |
| `StateMachine` | None |
| `TradeOpenedEvent` | None |
| `BuyOrderExecutedEvent` | None |
| `LiquidationPriceUpdatedEvent` | No schema change; `LiquidationPrice` field now emits `"0"` for spot positions (valid, existing consumers already handle zero) |
| `TradeClosedEvent` | None |
| `SellOrderExecutedEvent` | None |

---

## Behavioral Contract for `LiquidationPrice` Field on `Position`

The following invariant governs `pos.LiquidationPrice` throughout the entire position lifecycle:

| Condition | `LiquidationPrice` value | Source |
|---|---|---|
| `pos.Multiplier == 1` (spot), at position open (Step 2) | `decimal.Zero` | Explicitly set by Task Group 4 guard |
| `pos.Multiplier == 1` (spot), after any safety order fill (Step 3b) | `decimal.Zero` | Task Group 5 guard prevents assignment |
| `pos.Multiplier > 1` (futures), at position open (Step 2) | `decimal.Zero` (initial; formula hasn't run yet) | `NewPosition` zero-value |
| `pos.Multiplier > 1` (futures), after first safety order fill (Step 3b) | `∈ (0, AverageEntryPrice × 0.5]` | Existing `half`-formula proxy |
| `pos.Multiplier == 0` (unset — tests using direct `NewPosition`) | `decimal.Zero` initially; `AverageEntryPrice × 0.5` after first SO fill | Existing behaviour unchanged |

---

## State Machine: No Changes

The Position State Machine state graph is unchanged:

```
StateIdle → StateOpening → StateSafetyOrderWait ⇄ ... → StateClosed
```

For spot positions (`Multiplier = 1`):
- The transition to `StateClosed` via the `"liquidation"` reason path is **permanently unreachable**.
- Valid closure paths: `"take_profit"`, `"last_order_filled"` (if `ExitOnLastOrder = true`), `"trailing_stop"` (if implemented in a future feature).

For futures positions (`Multiplier > 1`):
- All existing paths, including `"liquidation"`, remain unchanged.
