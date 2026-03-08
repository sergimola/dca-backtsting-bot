# API Contracts: Position State Machine

**Reference**: SDD Master Report Section 4.2  
**Version**: 1.0  
**Last Updated**: March 8, 2026

## Core Interfaces

### StateMachine Interface

```go
type StateMachine struct {
    // Stateless; only holds configuration/defaults if needed
}

// ProcessCandle processes one 1-minute OHLCV candle through the position state machine.
// Returns ordered list of events emitted during processing.
// Returns error if invariant violated or state transition invalid.
func (sm *StateMachine) ProcessCandle(pos *Position, candle *Candle) ([]Event, error)
```

**Contract**:
- Input: `pos` must be in valid state (StateIdle, StateOpening, StateSafetyOrderWait, or StateClosed)
- Input: `candle` must have all OHLCV > 0 (no negative prices)
- Output: `[]Event` in order of emission (Price → Fills → Liquidation → Close)
- Output: Error only if precondition violated (invariant or state logic)
- Postcondition: `pos.State` may transition; all invariants remain satisfied

### Position Struct

```go
type Position struct {
    TradeID              string              // Unique identifier
    OpenTime             time.Time           // When position opened
    Prices               []decimal.Decimal   // Order price grid (monotonically decreasing)
    Amounts              []decimal.Decimal   // Order size grid
    State                State               // Current state
    NextOrderIndex       int                 // Next unfilled order (0-based)
    PositionQuantity     decimal.Decimal     // Total coin/token quantity held
    AverageEntryPrice    decimal.Decimal     // Weighted average of all fills
    TakeProfitTarget     decimal.Decimal     // P_tp = AverageEntryPrice * 1.005
    LiquidationPrice     decimal.Decimal     // P_liq (recalculated after each fill)
    Profit               decimal.Decimal     // Total profit (negative if loss)
    Orders               []*Order            // Filled orders (for audit)
    AccountBalance       decimal.Decimal     // Starting balance for position sizing
    MonthlyAddition      decimal.Decimal     // Monthly capital injection (optional)
    ExitOnLastOrder      bool                // Close on last order fill [US6]
    DayCounter           int                 // Days elapsed (incremented per 1440 candles)
    CloseTimestamp       *time.Time          // When position closed
    FeesAccumulated      decimal.Decimal     // Total trading fees
}
```

**Invariants**:
- `NextOrderIndex` ∈ [0, len(Prices)]
- `Prices` strictly monotonically decreasing: `Prices[i] > Prices[i+1]`
- `len(Amounts) == len(Prices)`
- `PositionQuantity >= 0`
- `AccountBalance >= 0`
- `FeesAccumulated >= 0` (only increases or stays same)
- `Orders` size ≤ `NextOrderIndex`
- If `State == StateClosed`, position immutable (no further updates)

### Event Interface

```go
type Event interface {
    EventType() string         // Type identifier (e.g., "trade.opened", "buy.order.executed")
    EventTimestamp() time.Time // When event occurred
}
```

**Concrete Event Types**:

#### TradeOpenedEvent
```go
type TradeOpenedEvent struct {
    TradeID       string
    OpenTime      time.Time
    OpenPrice     decimal.Decimal
    Quantity      decimal.Decimal
    RunID         string // For audit correlation
}
```
**Emitted**: When first candle fills market buy order

#### BuyOrderExecutedEvent
```go
type BuyOrderExecutedEvent struct {
    TradeID          string
    OrderNumber      int                // 0-based index
    Timestamp        time.Time
    ExecutedPrice    decimal.Decimal    // Actual fill price (pessimistic)
    Quantity         decimal.Decimal    // Amount filled
    Fee              decimal.Decimal    // Fee charged on this fill
    AveragePrice     decimal.Decimal    // Updated weighted average
    LiquidationPrice decimal.Decimal    // Updated P_liq
}
```
**Emitted**: When safety order fills; one event per fill (gap-down may emit multiple)

#### LiquidationPriceUpdatedEvent
```go
type LiquidationPriceUpdatedEvent struct {
    TradeID            string
    Timestamp          time.Time
    LiquidationPrice   decimal.Decimal
    CurrentPrice       decimal.Decimal
    PriceRatio         decimal.Decimal    // For diagnostics
}
```
**Emitted**: After each buy order fill (when P_liq recalculated)

#### TradeClosedEvent
```go
type TradeClosedEvent struct {
    TradeID       string
    CloseTime     time.Time
    ClosingPrice  decimal.Decimal    // Price at which position closed
    Quantity      decimal.Decimal    // Total quantity held
    Profit        decimal.Decimal    // Cumulative profit (negative = loss)
    Reason        string             // "take_profit", "liquidation", or "last_order_filled"
    Duration      time.Duration      // Time held
}
```
**Emitted**: When position transitions to StateClosed

**Reason Values**:
- `"take_profit"`: Position closed at take-profit target
- `"liquidation"`: Position force-closed below liquidation price
- `"last_order_filled"`: Position closed on last order fill (US6 early exit)

#### SellOrderExecutedEvent
```go
type SellOrderExecutedEvent struct {
    TradeID    string
    Timestamp  time.Time
    Price      decimal.Decimal
    Quantity   decimal.Decimal
    Profit     decimal.Decimal
}
```
**Emitted**: When take-profit order fills

#### PriceChangedEvent
```go
type PriceChangedEvent struct {
    TradeID   string
    Timestamp time.Time
    Open      decimal.Decimal
    High      decimal.Decimal
    Low       decimal.Decimal
    Close     decimal.Decimal
}
```
**Emitted**: At start of candle processing (first event)

#### MonthlyAdditionEvent
```go
type MonthlyAdditionEvent struct {
    TradeID        string
    Timestamp      time.Time
    AdditionAmount decimal.Decimal
    NewBalance     decimal.Decimal
    Day            int
}
```
**Emitted**: On day 30, 60, 90, ... (every 1440 candles)

### Candle Struct

```go
type Candle struct {
    Timestamp time.Time
    Open      decimal.Decimal
    High      decimal.Decimal
    Low       decimal.Decimal
    Close     decimal.Decimal
    Volume    decimal.Decimal
}
```

**Contract**:
- `Open`, `High`, `Low`, `Close` > 0
- `Low <= Open, High <= Close` (logical consistency)
- `High >= Low` (always true by definition)
- `Volume >= 0`

## Error Types

### PositionError (base)
```go
type PositionError struct {
    Reason string
    Err    error
}
func (e *PositionError) Error() string
```

### InvariantViolationError
```go
type InvariantViolationError struct {
    PositionError
    Invariant string  // Which invariant violated
}
```
**Examples**:
- NextOrderIndex out of bounds
- PositionQuantity became negative
- Price array not monotonic

### InvalidStateTransitionError
```go
type InvalidStateTransitionError struct {
    PositionError
    From string  // Current state
    To   string  // Attempted target
    Reason string // Why transition invalid
}
```
**Examples**:
- Cannot close already-closed position
- Cannot reopen closed position

### OrderExecutionError
```go
type OrderExecutionError struct {
    PositionError
    OrderNumber int
    Reason      string
}
```
**Examples**:
- Order price out of range
- Order amount invalid

### PrecisionError
```go
type PrecisionError struct {
    PositionError
    Value   decimal.Decimal
    Context string
}
```
**Examples**:
- Decimal arithmetic failed
- Rounding error exceeded tolerance

## Constructor Contracts

### NewStateMachine()
```go
func NewStateMachine() *StateMachine
```
**Returns**: New, stateless state machine instance
**Contract**: Always succeeds; no external dependencies

### NewPosition(tradeID string, openTime time.Time, prices, amounts []decimal.Decimal) *Position
```go
func NewPosition(tradeID string, openTime time.Time, prices, amounts []decimal.Decimal) *Position
```
**Preconditions**:
- `tradeID` non-empty
- `prices`, `amounts` non-empty and equal length
- All prices > 0
- All amounts > 0
- Prices strictly monotonically decreasing

**Returns**: New Position in StateIdle

**Postconditions**:
- `State == StateIdle`
- `NextOrderIndex == 0`
- `PositionQuantity == 0`
- All invariants satisfied

## Method Contracts

### Position.RecalculateLiquidationPrice()
```go
func (p *Position) RecalculateLiquidationPrice() error
```
**Precondition**: Position has at least one filled order

**Postcondition**: `LiquidationPrice` updated based on current average entry price and account leverage

**Returns**: Error if calculation fails (precision error)

### Position.CalculateProfit(closingPrice decimal.Decimal, totalQuantity decimal.Decimal, orders []*Order, fees decimal.Decimal) decimal.Decimal
```go
func CalculateProfit(closingPrice decimal.Decimal, totalQuantity decimal.Decimal, orders []*Order, fees decimal.Decimal) decimal.Decimal
```
**Precondition**: `closingPrice > 0`, `totalQuantity > 0`, `fees >= 0`

**Postcondition**: Profit calculated as `(closingPrice - averageEntryPrice) * totalQuantity - fees`

**Contract**: If `closingPrice < costBasis`, profit is negative (loss)

## State Constants

```go
const (
    StateIdle              = "IDLE"               // No active position
    StateOpening           = "OPENING"            // Market buy filled, awaiting safety orders
    StateSafetyOrderWait   = "SAFETY_ORDER_WAIT"  // Awaiting take-profit or liquidation
    StateClosed            = "CLOSED"             // Position closed (immutable)
)
```

## Fee Calculation

**Contract**: Fees deducted from realized profit
- Maker fee: 0.1% (typical exchange default)
- Applied at order fill time (pessimistic)
- Accumulated across all fills
- Never decreases

## Decimal Precision

**Contract**: All price/amount calculations use `decimal.Decimal` with `RoundHalfUp` mode

- No float operations on monetary values
- Precision: 8 decimal places (standard for crypto)
- Comparisons exact to full precision

## Thread Safety

**Contract**: Position State Machine is NOT thread-safe
- Single-threaded use only
- No internal locks or goroutines
- For concurrent use, caller must synchronize with `sync.Mutex`

## Performance Contract

**ProcessCandle() Latency**:
- Typical (10 orders): < 500 µs
- Worst-case (20 orders, gap-down fill): < 1000 µs
- Memory: O(orders) allocations, minimal GC pressure

## Backward Compatibility

**Current Version**: 1.0
- No deprecated APIs
- Future changes will maintain semantic versioning
- Breaking changes only with major version bump

## References

- SDD Master Report § 4.2: State Machine API
- SDD Master Report § 4.3: Event Contract
