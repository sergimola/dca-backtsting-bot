# Data Model: Position State Machine Types

**Phase**: 1 (Design)  
**Date**: March 8, 2026  
**Input**: Implementation plan, research decisions, SDD § 2–3

---

## Domain Value Objects (Immutable)

### Candle (Market Data Input)

Represents one 1-minute OHLCV bar from market data.

```go
// Candle represents a single 1-minute OHLCV candlestick
type Candle struct {
    Timestamp time.Time       // UTC timezone-aware
    Open      decimal.Decimal
    High      decimal.Decimal
    Low       decimal.Decimal
    Close     decimal.Decimal
    Volume    decimal.Decimal
}
```

**Invariant**: All prices must be positive. Validated by caller before PSM receives.

**SDD Mapping**: Section 4.2 OHLCV Contract.

---

### OrderFill (Executed Order Record)

Immutable record of a filled buy or sell order.

```go
// OrderFill represents a single executed order (buy or sell)
type OrderFill struct {
    OrderIndex       int                 // 0-indexed into Prices/Amounts grid
    OrderNumber      int                 // 1-indexed for human readability
    OrderType        OrderType           // MARKET (buy #1) or LIMIT (safety orders)
    ExecutedPrice    decimal.Decimal
    ExecutedQuantity decimal.Decimal     // Base currency (e.g., BTC quantity)
    QuoteAmount      decimal.Decimal     // Quote currency (USDT) before fees
    Timestamp        time.Time
    Fee              decimal.Decimal     // Deducted from profit (SDD § 2.6)
}

type OrderType int

const (
    OrderTypeMarket OrderType = iota
    OrderTypeLimit
)

// Fee rates (SDD § 2.6)
const (
    FeeRateSpot         = "0.00075"  // 0.075% spot (1 multiplier)
    FeeRateMarginMarket = "0.0006"   // 0.06% margin market
    FeeRateMarginLimit  = "0.0002"   // 0.02% margin limit
)
```

**SDD Mapping**: 
- OrderIndex maps to position in Prices/Amounts grids (SDD § 2.1–2.2)
- ExecutedQuantity = $Q_n$ (SDD § 2.2)
- QuoteAmount = $A_n$ (SDD § 2.2)
- Fee calculation per SDD § 2.6

---

## State Machine Types

### PositionState Enum

```go
// PositionState represents the current phase of a position lifecycle
type PositionState int

const (
    StateIdle PositionState = iota      // No position open
    StateOpening                        // Market buy #1 just filled
    StateSafetyOrderWait                // Waiting for next safety order trigger
    StateClosed                         // Position closed (terminal state)
)

func (s PositionState) String() string {
    switch s {
    case StateIdle:
        return "IDLE"
    case StateOpening:
        return "OPENING"
    case StateSafetyOrderWait:
        return "SAFETY_ORDER_WAIT"
    case StateClosed:
        return "CLOSED"
    default:
        return "UNKNOWN"
    }
}
```

**SDD Mapping**: Section 3.3 State Transition Diagram.

**Valid Transitions**:
- IDLE → OPENING (first candle, market buy evaluated)
- OPENING → SAFETY_WAIT (first buy confirmed, more orders available)
- SAFETY_WAIT → SAFETY_WAIT (more safety orders filled, loop)
- SAFETY_WAIT → CLOSED (take-profit or liquidation triggered)
- CLOSED → (terminal, cannot transition back; new position created by caller)

---

### Position (Core Aggregate Root)

The mutable Position object is managed by the caller and passed to PSM on each candle. PSM modifies it via the ProcessCandle() call.

```go
// Position represents a single active DCA trade
type Position struct {
    // Identification
    TradeID        string      // UUID for this position
    OpenTimestamp  time.Time   // When position was first opened
    CloseTimestamp *time.Time  // When position was closed (nil if open)
    
    // State
    State          PositionState
    
    // Configuration (pre-calculated from config.Config + trading pair)
    Prices         []decimal.Decimal  // P₀, P₁, ..., P_n (SDD § 2.1)
    Amounts        []decimal.Decimal  // A₀, A₁, ..., A_n (SDD § 2.2)
    
    // Execution history
    Orders         []OrderFill        // All filled orders (buy + sell)
    
    // Current aggregates (recalculated after each fill)
    PositionQuantity  decimal.Decimal // Total base currency held (Σ Q_n)
    AverageEntryPrice decimal.Decimal // Size-weighted avg entry (Pbar, SDD § 2.3)
    TakeProfitTarget  decimal.Decimal // Trigger price (P_tp, SDD § 2.4)
    LiquidationPrice  decimal.Decimal // Trigger price (P_liq, SDD § 2.5; clamped ≥ 0)
    
    // P&L tracking (quote currency)
    Profit             decimal.Decimal
    FeesAccumulated    decimal.Decimal
    
    // Metadata
    OpenPrice         decimal.Decimal   // Market buy execution price
    NextOrderIndex    int               // Which order (by index) fills next
    HasMoreOrders     bool              // Shorthand: NextOrderIndex < len(Prices)
}

// Constructor: Initialize a fresh position with pre-calculated grids
func NewPosition(tradeID string, timestamp time.Time, prices, amounts []decimal.Decimal) *Position {
    return &Position{
        TradeID:       tradeID,
        OpenTimestamp: timestamp,
        State:         StateIdle,
        Prices:        prices,
        Amounts:       amounts,
        Orders:        []OrderFill{},
        // All aggregates start at zero
    }
}
```

**State Invariants** (enforced by PSM and caller):
- If `State == StateIdle`: `Orders` is empty, `PositionQuantity == 0`
- If `State == StateOpening` or `StateSafetyOrderWait`: `len(Orders) > 0`, first order is MARKET, `PositionQuantity > 0`
- If `State == StateClosed`: `CloseTimestamp` is not nil
- `len(Prices) == len(Amounts)` (consistent grid)
- `NextOrderIndex < len(Prices)` or `NextOrderIndex == len(Prices)` if all filled
- `AverageEntryPrice > 0` if position has fills
- `TakeProfitTarget >= AverageEntryPrice * 1.001` (always above entry for long)
- `LiquidationPrice >= 0` (clamped from formula result)

**SDD Mapping**:
- Prices, Amounts: SDD § 2.1–2.2
- AverageEntryPrice: SDD § 2.3
- TakeProfitTarget: SDD § 2.4
- LiquidationPrice: SDD § 2.5
- Profit: SDD § 2.7
- Re-entry price: SDD § 2.8

---

## Event Types (Domain Output)

All events implement the `Event` interface:

```go
// Event is the base interface for all domain events
type Event interface {
    EventType() string
    EventTimestamp() time.Time
}
```

### TradeOpenedEvent

Emitted when the market buy (order #1) is executed.

```go
type TradeOpenedEvent struct {
    RunID            string                  // Backtest run identifier
    TradeID          string                  // UUID of this trade
    Timestamp        time.Time               // When market buy was filled
    TradingPair      string                  // e.g., "BTC/USDT"
    Amount           decimal.Decimal         // Total capital allocated (C)
    ConfiguredOrders []OrderGrid             // Pre-calculated grids (SDD § 5.5)
    Config           *config.Config          // Full config (strict type, not dict)
}

type OrderGrid struct {
    OrderIndex int
    OrderNumber int
    Price      decimal.Decimal             // P_n
    Amount     decimal.Decimal             // A_n
}

func (e *TradeOpenedEvent) EventType() string {
    return "trade.opened"
}

func (e *TradeOpenedEvent) EventTimestamp() time.Time {
    return e.Timestamp
}
```

**SDD Mapping**: Section 4.3, event schema. Section 5.5 requires `ConfiguredOrders` be populated (not empty list).

---

### BuyOrderExecutedEvent

Emitted when a safety order (market or limit) is filled.

```go
type BuyOrderExecutedEvent struct {
    RunID            string              // Backtest run identifier
    TradeID          string              // UUID of this trade
    Timestamp        time.Time           // When order was filled
    Price            decimal.Decimal     // Execution price
    Size             decimal.Decimal     // Quote amount (USDT) - SDD § 5.7
    BaseSize         decimal.Decimal     // Base currency quantity (e.g., BTC)
    OrderType        OrderType           // MARKET or LIMIT
    LiquidationPrice decimal.Decimal     // Updated liquidation price after fill
    OrderNumber      int                 // 1-indexed ("order #3")
    Fee              decimal.Decimal     // Fee deducted this order
}

func (e *BuyOrderExecutedEvent) EventType() string {
    return "order.buy.executed"
}

func (e *BuyOrderExecutedEvent) EventTimestamp() time.Time {
    return e.Timestamp
}
```

**SDD Mapping**:
- Price: execution price ($P_n$ or market, depending on order type)
- Size: quote amount ($A_n$), SDD § 2.2, § 5.7
- BaseSize: base quantity ($Q_n$ = Size / Price)
- LiquidationPrice: recalculated after fill, SDD § 2.5
- Fee: per SDD § 2.6 fee table

---

### LiquidationPriceUpdatedEvent

Emitted after each buy order fill to announce updated liquidation threshold.

```go
type LiquidationPriceUpdatedEvent struct {
    RunID           string              // Backtest run identifier
    TradeID         string
    Timestamp       time.Time
    TradingPair     string
    LiquidationPrice decimal.Decimal    // New P_liq
    CurrentPrice    decimal.Decimal     // Market price at time of update
    PriceRatio      decimal.Decimal     // CurrentPrice / LiquidationPrice (SDD § 5.6)
}

func (e *LiquidationPriceUpdatedEvent) EventType() string {
    return "liquidation.price.updated"
}

func (e *LiquidationPriceUpdatedEvent) EventTimestamp() time.Time {
    return e.Timestamp
}
```

**SDD Mapping**: Section 5.6 requires `PriceRatio` be computed (not left at 0.0).

**Formula**: `PriceRatio = CurrentPrice / LiquidationPrice` (with null check: if LiquidationPrice == 0, ratio is undefined/infinity represented as special value).

---

### TradeClosedEvent

Emitted when position closes (take-profit or liquidation).

```go
type TradeClosedEvent struct {
    RunID         string              // Backtest run identifier
    TradeID       string
    OpenTimestamp time.Time           // When position was opened
    Timestamp     time.Time           // When position was closed
    TradingPair   string
    ClosingPrice  decimal.Decimal     // Sell price (P_tp or liquidation point)
    Size          decimal.Decimal     // Total position size (base currency)
    Profit        decimal.Decimal     // P&L (SDD § 2.7)
    Duration      time.Duration       // Timestamp - OpenTimestamp
    Reason        string              // "take_profit", "liquidation", "end_of_backtest"
}

func (e *TradeClosedEvent) EventType() string {
    return "trade.closed"
}

func (e *TradeClosedEvent) EventTimestamp() time.Time {
    return e.Timestamp
}
```

**Reason values**:
- `"take_profit"`: high ≥ P_tp
- `"liquidation"`: low ≤ P_liq (profit = -AccountBalance)
- `"end_of_backtest"`: forced close at final candle

**SDD Mapping**: Section 2.7 profit formula, Section 3.1 step 5.

---

### SellOrderExecutedEvent

Emitted when position is sold (take-profit or end-of-backtest close).

```go
type SellOrderExecutedEvent struct {
    RunID   string              // Backtest run identifier
    TradeID string
    Timestamp time.Time         // When sell was executed
    Price   decimal.Decimal     // Sell price
    Size    decimal.Decimal     // Base quantity sold
    Profit  decimal.Decimal     // P&L from this sell
}

func (e *SellOrderExecutedEvent) EventType() string {
    return "order.sell.executed"
}

func (e *SellOrderExecutedEvent) EventTimestamp() time.Time {
    return e.Timestamp
}
```

---

### PriceChangedEvent

Emitted at the start of each candle to broadcast market data.

```go
type PriceChangedEvent struct {
    RunID       string              // Backtest run identifier
    TradingPair string
    Timestamp   time.Time           // Candle timestamp
    Open        decimal.Decimal
    High        decimal.Decimal
    Low         decimal.Decimal
    Close       decimal.Decimal
    Volume      decimal.Decimal
}

func (e *PriceChangedEvent) EventType() string {
    return "price.changed"
}

func (e *PriceChangedEvent) EventTimestamp() time.Time {
    return e.Timestamp
}
```

**SDD Mapping**: Section 3.1 "Dispatch PriceChangedEvent" (step 2).

---

### MonthlyAdditionEvent

Emitted on 30-day boundaries if `monthly_addition > 0`.

```go
type MonthlyAdditionEvent struct {
    RunID          string              // Backtest run identifier
    Timestamp      time.Time           // Candle timestamp when addition occured
    TradingPair    string
    AdditionAmount decimal.Decimal     // Capital injected
    PreviousBalance decimal.Decimal    // Account balance before injection
    NewBalance     decimal.Decimal     // Account balance after injection
    AdditionNumber int                 // 1st, 2nd, 3rd injection
    DaysSinceStart int                 // Days elapsed in backtest
}

func (e *MonthlyAdditionEvent) EventType() string {
    return "monthly.addition"
}

func (e *MonthlyAdditionEvent) EventTimestamp() time.Time {
    return e.Timestamp
}
```

**SDD Mapping**: Section 3.1 "Monthly Addition Check" (step 1), Section 3.4 "Day Counter" temporal logic.

---

## Type Relationships (Entity Diagram)

```
┌──────────────────────────────────────────┐
│          Position (Aggregate Root)       │
├──────────────────────────────────────────┤
│ TradeID, State, OpenTimestamp            │
│ Prices[], Amounts[]                      │
│ Orders[] (0+ OrderFill)                  │
│ PositionQuantity, AverageEntryPrice,     │
│ TakeProfitTarget, LiquidationPrice       │
│ Profit, FeesAccumulated, etc.            │
└──────────────────────────────────────────┘
           │
           ├─ contains: OrderFill[]
           │            │
           │            └─ OrderType (MARKET | LIMIT)
           │               ExecutedPrice, ExecutedQuantity
           │               Fee (per SDD § 2.6)
           │
           └─ emits: Event[] (via ProcessCandle)
                        │
                        ├─ TradeOpenedEvent
                        ├─ BuyOrderExecutedEvent
                        ├─ LiquidationPriceUpdatedEvent
                        ├─ TradeClosedEvent
                        ├─ SellOrderExecutedEvent
                        ├─ PriceChangedEvent
                        └─ MonthlyAdditionEvent

┌──────────────────────────────────────────┐
│          Input: Candle                   │
├──────────────────────────────────────────┤
│ Timestamp, Open, High, Low, Close, Vol   │
└──────────────────────────────────────────┘

Caller Flow:
  Candle + Position → PSM.ProcessCandle() → []Event + updated Position
```

---

## Enum Reference

### OrderType

```go
type OrderType int

const (
    OrderTypeMarket OrderType = iota
    OrderTypeLimit
)
```

### PositionState

(See section above)

---

## Calculated Properties

The following properties are derived and updated during ProcessCandle():

| Property | Formula | Update Trigger |
|----------|---------|---|
| `AverageEntryPrice` (Pbar) | $\frac{\sum P_j \cdot Q_j}{\sum Q_j}$ (SDD § 2.3) | After each buy fill |
| `TakeProfitTarget` (P_tp) | $\bar{P} \times (1 + \frac{d_{tp}}{100})$ (SDD § 2.4) | After each buy fill |
| `LiquidationPrice` (P_liq) | $\frac{M - Q \cdot \bar{P}}{Q \cdot (mmr - 1)}$, clamped ≥ 0 (SDD § 2.5) | After each buy fill |
| `PositionQuantity` | $\sum Q_j$ | After each buy fill |
| `HasMoreOrders` | `NextOrderIndex < len(Prices)` | After each fill |
| `Profit` | $Q_{total} \cdot (P_{sell} - \bar{P}) - \text{fees}$ (SDD § 2.7) | On position close |
| `FeesAccumulated` | $\sum \text{buy\_fee} + \text{sell\_fee}$ (SDD § 2.6) | After each fill |

---

## Next Steps

1. Implement `contracts/` directory with concrete Go types
2. Write `quickstart.md` example
3. Begin implementation (Phase 2)
