# Phase 1: Data Model

**Date**: March 8, 2026  
**Feature**: Backtest Orchestrator  

## Core Entities

### Candle (OHLCV Market Data)

Represents a single time period of market data from historical CSV source.

**Go Definition** (proposed):
```go
type Candle struct {
    Symbol    string          // Trading pair (e.g., "BTCUSDT")
    Timestamp time.Time       // UTC candle close/bar time
    Open      decimal.Decimal // Open price
    High      decimal.Decimal // High price
    Low       decimal.Decimal // Low price
    Close     decimal.Decimal // Close price
    Volume    decimal.Decimal // Trading volume
}
```

**Source**: CSV file with columns: `symbol,timestamp,open,high,low,close,volume`  
**Key Validation**:
- Timestamp must be valid UTC
- All prices (OHLC) must be positive Decimal values (no floats)
- High >= Low, High >= Open, High >= Close (OHLCV invariant)
- Volume must be non-negative

---

### Event (Captured Trading Event)

A single event emitted by the Position State Machine during `ProcessCandle()` execution.

**Properties**:
- **Timestamp** (time.Time): UTC time the event occurred (inherited from candle timestamp)
- **Type** (EventType enum): PositionOpenedEvent, BuyOrderExecutedEvent, TakeProfitHitEvent, LiquidationEvent, etc.
- **EventData** (typed): Event-specific payload:
  - For BuyOrderExecutedEvent: entry price, quantity (as Decimal)
  - For LiquidationEvent: liquidation price (as Decimal)
  - For TakeProfitHitEvent: exit price, total profit (as Decimal)
  - Raw reference to PSM's event struct (if applicable)

**Source**: Emitted by PSM during backtest execution  
**Destination**: Event Bus (in-memory append-only log)  
**Key Guarantee**: Events are captured in exact sequence emitted by PSM; no loss, no reordering

---

### Backtest Run (Execution Context)

Encapsulates a single backtest execution session.

**Properties**:
- **ID** (string or UUID): Unique identifier for this backtest run
- **Symbol** (string): Trading pair being backtested
- **ConfigRef** (position.Config or similar): Reference to PSM configuration used
- **StartTime** (time.Time): Backtest execution start time
- **EndTime** (time.Time): Backtest execution end time (after all candles processed)
- **CandleCount** (int): Total number of candles processed
- **EventCount** (int): Total number of events captured
- **Events** ([]Event): The complete event log

**State Flow**:
1. Created when orchestrator is initialized
2. Candles loaded from CSV during initial phase
3. PSM instantiated with Config
4. Candles fed sequentially to PSM
5. Events captured and appended to run.Events
6. Marked complete after final candle

---

### Event Bus (In-Memory Event Log)

Coordinator for storing and querying captured events.

**Go Definition** (proposed):
```go
type EventBus struct {
    events []Event            // Append-only log
    mu     sync.RWMutex       // For concurrent read access
    // Optional: index map for fast timestamp-range queries
    // mu ensures thread-safe read while events slice is being appended
}

// Key Methods:
// Append(e Event) error          // Called by orchestrator during candle loop
// GetAllEvents() []Event         // Return all captured events
// GetEventsByType(t EventType) []Event   // Filter by event type
// GetEventChronological() []Event        // Already chronological by append order
```

**Guarantees**:
- Thread-safe (at least for single-writer, multi-reader during backtest)
- Events remain in order of PSM emission
- No duplicate events
- No data corruption or loss

---

## Relationships

### Orchestrator → PSM (Dependency)
- Orchestrator creates/owns a PSM instance
- Orchestrator calls PSM.ProcessCandle(candle) for each candle in sequence
- PSM returns events via return value or callback
- PSM knows nothing about Orchestrator; clean unidirectional dependency

### Orchestrator → CSV Data (Adapter)
- Orchestrator reads CSV file using high-performance Go CSV parsing
- CSV parser is stateless; orchestrator owns file handle lifecycle
- Candles are parsed and immediately fed to PSM (streaming, not buffered)

### Orchestrator → Event Bus (Coordination)
- Orchestrator appends every event from PSM to Event Bus
- Event Bus is owned by orchestrator for the lifetime of the backtest
- After backtest completes, caller queries Event Bus for results

### Backtest Run ↔ Event Bus (Composition)
- Backtest Run contains or wraps the Event Bus
- Caller performs backtest, receives run results with event log

---

## Validation Rules

### Candle Validation (Pre-Processing)
- Timestamp must not be before previous candle (monotonically increasing)
- Missing columns in CSV are errors (not warnings)
- Invalid Decimal values (non-numeric) are errors
- Empty CSV file is valid (zero candles processed)

### Event Validation (Post-Processing)
- Events must not be empty for a valid backtest run (P1 story: "every event is recorded")
- Event timestamp must match or be ≤ the candle timestamp that triggered it
- All event Decimal values must preserve PSM precision (no float conversions)

### State Transitions
- Before backtest: Config validated, PSM initialized, CSV loaded
- During backtest: PSM processes candles deterministically; no external state changes allowed
- After backtest: Event Bus frozen (no new events appended); backtest results are final

---

## Key Design Decisions

1. **Streaming CSV**: Avoid loading entire file into memory. Use buffered reader to stream candles directly to PSM.
2. **Pre-allocation**: If total candle count is known (via file scan or header), pre-allocate event slice to avoid repeated allocations.
3. **No Event Filtering During Backtest**: Capture 100% of PSM events; filtering/analysis happens post-backtest.
4. **Decimal Precision**: Event prices and quantities are stored as-is from PSM (Decimal); no rounding or conversion.
5. **Single-Threaded Backtest Loop**: Candle → PSM → Event Bus is single-threaded for determinism. Event Bus is read-only after backtest.
