# Architecture: Position State Machine (PSM)

**Reference**: SDD Master Report Sections 4.2–4.3  
**Version**: 1.0  
**Last Updated**: March 8, 2026

## Overview

The Position State Machine (PSM) is a specialized finite-state automaton that manages the complete lifecycle of a single trading position during backtesting. It enforces the **single-position-at-a-time invariant** and implements the **Pessimistic Execution "Minute Loop" Protocol** (SDD 3.1–3.2).

## Architecture Layers

### Layer 1: Core State Machine (position.go)

**Responsibility**: Define Position struct, state constants, and invariant checks

**Components**:
- `Position` struct: Central domain entity containing position metadata, price grids, order book, and state
- `State` constants: `StateIdle`, `StateOpening`, `StateSafetyOrderWait`, `StateClosed`
- `Order` struct: Encapsulates individual order with price, size, fill status
- Helper functions: AverageEntryPrice(), TakeProfitTarget(), LiquidationPrice(), Profit()

**Key Invariants**:
- `NextOrderIndex` ≥ 0 and ≤ `len(Prices)`
- `PositionQuantity` ≥ 0
- All prices in `Prices` array are strictly monotonically decreasing
- `Orders` slice size matches `NextOrderIndex` (only filled orders retained)

### Layer 2: State Machine Logic (minute_loop.go)

**Responsibility**: Implement `ProcessCandle()` state machine execution

**Components**:
- `ProcessCandle(pos *Position, candle *Candle) ([]Event, error)`: Main entry point
- `FillOrdersForCandle()`: Order filling logic (pessimistic gap-down handling)
- `CheckLiquidation()`: Liquidation check with recalculation
- `CheckTakeProfit()`: Take-profit logic
- `RecalculateLiquidationPrice()`: Update P_liq after order fills
- Re-entry and monthly addition logic

**Execution Order** (pessimistic):
1. Emit `PriceChangedEvent` with candle OHLC
2. Fill buy orders (pessimistic gap-down processing)
3. Recalculate liquidation price if orders filled
4. Check liquidation (close if breached)
5. Check take-profit (close if reached)
6. Check early exit (if ExitOnLastOrder and all orders filled) [US6]
7. Process monthly addition (every 1440 candles)

### Layer 3: Event System (events.go)

**Responsibility**: Emit domain events for audit and tracking

**Components**:
- `Event` interface: Common interface for all events
- `TradeOpenedEvent`: Position creation
- `BuyOrderExecutedEvent`: Safety order fill
- `LiquidationPriceUpdatedEvent`: P_liq recalculation
- `TradeClosedEvent`: Position closure (reasons: take_profit, liquidation, last_order_filled)
- `SellOrderExecutedEvent`: Take-profit fill
- `PriceChangedEvent`: Candle processed
- `MonthlyAdditionEvent`: Capital injection

**Event Dispatch**:
- Events collected in slice during candle processing
- Returned in order of occurrence
- Caller responsible for persisting/reacting to events

### Layer 4: Error Handling (errors.go)

**Responsibility**: Define domain-specific errors

**Components**:
- `PositionError`: Base error type
- `InvariantViolationError`: Invariant constraint breached
- `InvalidStateTransitionError`: Illegal state transition attempted
- `OrderExecutionError`: Order fill logic failed
- `PrecisionError`: Decimal arithmetic error

## Data Flow: Candle Processing

```
InputCandle
    ↓
ProcessCandle()
    ├─ PriceChangedEvent
    ├─ FillOrdersForCandle()
    │  ├─ BuyOrderExecutedEvents (one per fill)
    │  └─ Update NextOrderIndex, PositionQuantity
    ├─ RecalculateLiquidationPrice()
    │  └─ LiquidationPriceUpdatedEvent
    ├─ CheckLiquidation()
    │  └─ TradeClosedEvent (if triggered)
    ├─ CheckTakeProfit()
    │  ├─ SellOrderExecutedEvent
    │  └─ TradeClosedEvent
    ├─ CheckEarlyExit() [US6]
    │  └─ TradeClosedEvent (reason: last_order_filled)
    └─ ProcessMonthlyAddition() [US5]
       └─ MonthlyAdditionEvent
    ↓
OutputEvents []Event
```

## Gap-Down Paradox Rule (SDD 3.2)

When a candle opens below multiple order levels (gap-down):

**Algorithm**:
1. For each order level (in ascending pessimistic order):
   - If `candle.low <= order.price`, fill order at `order.price` (not at gap)
   - Emit `BuyOrderExecutedEvent`
   - Recalculate `AverageEntryPrice` and `LiquidationPrice`
   - Continue to next order

**Result**: Orders fill pessimistically at limit prices, never at the gap-down market price

**Rationale**: Most conservative backtest; prevents over-optimistic results from market gaps

## State Transitions

```
StateIdle
  └─ [candle 1: market buy fills] → StateOpening
     ├─ [next candles: orders filled] → StateSafetyOrderWait
     │  ├─ [take-profit price reached] → StateClosed (reason: take_profit)
     │  ├─ [liquidation price breached] → StateClosed (reason: liquidation)
     │  └─ [all orders filled + ExitOnLastOrder] → StateClosed (reason: last_order_filled) [US6]
     └─ [gap-down liquidation on first candle] → StateClosed (reason: liquidation)
```

## Re-entry Mechanism (US4)

After position closes via take-profit:
- On the **next** candle (not the same candle):
  - If backtesting continues, a new position opens
  - Re-entry price: `P_new = P_sell × 1.0005` (0.05% upward offset)
  - Fresh price grid and order book calculated
  - Profit from first position accumulated

**Single Position Invariant**: Never two concurrent positions in a single state machine instance

## Monthly Addition Mechanism (US5)

Every 1440 candles (1 day in 1-minute candles):
- If `MonthlyAddition > 0`:
  - `AccountBalance += MonthlyAddition`
  - Emit `MonthlyAdditionEvent`
  - Subsequent position sizing uses increased balance

## Performance Characteristics

| Scenario | Typical Latency | Target |
|----------|-----------------|--------|
| Single order (market buy only) | ~100 µs | < 1000 µs |
| 10 orders | ~300 µs | < 1000 µs |
| 20 orders | ~500 µs | < 1000 µs |
| Gap-down fill (all orders) | ~700 µs | < 1000 µs |

- All measurements on commodity hardware (2023+ CPU)
- Uses shopspring/decimal (pure Go, no CGo)
- No memory allocations after position creation

## Testing Strategy

| Test Type | Category | Coverage |
|-----------|----------|----------|
| Unit Tests | State transitions, order fills, calculations | 85%+ |
| Integration Tests | Multi-position backtests, canonical scenarios | 8 scenarios |
| Stress Tests | 10,000 candles, 50+ positions, memory stability | Performance baseline |
| Invariant Tests | Quantity bounds, price monotonicity, index validity | Continuous verification |
| Benchmark | ProcessCandle latency vs. order count | < 1ms/call |

## API Entry Point

```go
// Create state machine (stateless)
sm := NewStateMachine()

// Create position with price grid and amounts
pos := NewPosition(tradeID, openTime, prices, amounts)
pos.AccountBalance = decimal.NewFromString("1000.00")
pos.MonthlyAddition = decimal.NewFromString("500.00")  // Optional
pos.ExitOnLastOrder = true  // Optional [US6]

// Process each candle
for candle := range candleStream {
    events, err := sm.ProcessCandle(pos, candle)
    if err != nil {
        // Handle error: invariant violation, invalid state
    }
    
    for _, evt := range events {
        // Handle event: audit log, metrics, decision-making
    }
    
    if pos.State == StateClosed {
        // Position closed, cumulative profit in pos.Profit
        // Ready for re-entry on next candle (create new position)
    }
}
```

## Locking and Concurrency

**Current Implementation**: Not thread-safe

- Single-threaded use only (backtest loop)
- Future: Could wrap Position with sync.Mutex for thread safety
- No internal goroutines; ProcessCandle() is blocking

## References

- SDD Master Report § 3.1: Minute Loop Protocol
- SDD Master Report § 3.2: Gap-Down Paradox Rule
- SDD Master Report § 4.2: State Machine Design
- SDD Master Report § 4.3: Order Execution Logic
