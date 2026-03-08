# Implementation Plan: Core Domain Position State Machine

**Branch**: `002-position-state-machine` | **Date**: March 8, 2026 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification: Core Domain Position State Machine enforcing single-position invariant and Pessimistic Execution "Minute Loop" (SDD §3.1–3.2)

## Summary

The Position State Machine (PSM) is the **canonical execution engine** for backtesting. It processes 1-minute OHLCV candles in strict pessimistic order (Buy → Liquidation → Take-Profit) and transitions between five states (IDLE → OPENING → SAFETY_WAIT → CLOSED). All monetary math uses fixed-point Decimal arithmetic (`shopspring/decimal`). The PSM is a pure domain layer with zero knowledge of data sources, event persistence, or API concerns. It accepts OHLCV candles as input and returns domain events as output, enabling complete isolation for testing, parallelization, and parity verification against the canonical Python bot.

## Technical Context

**Language/Version**: Go 1.22+ (core-engine domain layer)  
**Primary Dependencies**: 
  - `github.com/shopspring/decimal` — Fixed-point arithmetic (maps to Python Decimal with ROUND_HALF_UP)
  - `github.com/google/uuid` — Event and trade ID generation
  - Standard `testing` package for unit tests
  
**Storage**: N/A (PSM is stateless per candle; caller manages state persistence)  
**Testing**: Go `testing` package + table-driven tests with canonical test cases derived from Python bot  
**Target Platform**: Linux server (backtesting orchestration via gRPC or embedded calls)  
**Project Type**: Library (core domain; consumed by orchestrator and test harnesses)  
**Performance Goals**: <1ms per candle on typical position (10-20 orders) on commodity hardware  
**Constraints**: 
  - Deterministic (no random state, reproducible across runs)
  - Exact parity with Python canonical bot on all decimal calculations
  - No external I/O or side effects during candle processing
  - State transitions must be synchronous and atomic per candle
  
**Scale/Scope**: 
  - Supports up to 1000+ candles/sec per position (enabling parallel backtest runs)
  - Handles 1–100+ orders per position
  - Multi-position orchestration delegated to orchestrator layer

## Constitution Check

*GATE: Verifies compliance before Phase 0 research and after Phase 1 design.*

✅ **No Live Trading Enforcement**: PSM is simulation-only. On liquidation, it clamps price to 0 and logs loss; it never issues live orders.  
✅ **Green Light Protocol**: All state transitions, order fills, and liquidation logic have canonical test data (SDD § 2.0–2.5) with expected Decimal values. Tests must pass before merge (spec.md "Canonical Test Data" section).  
✅ **Fixed-Point Arithmetic**: All price, quantity, and profit calculations use `shopspring/decimal.Decimal` with `RoundHalfUp` precision. Integer quantities are truncated to lot-size (e.g., 8 decimals for most pairs). No float operations in monetary code paths.  
✅ **Single-Position Invariant**: PSM enforces that exactly one position is open at a time. New positions open only on the candle *after* a previous close (FR-003, User Story 4).  
✅ **Gap-Down Execution Rule**: Safety orders are always filled at pre-calculated limit prices ($P_n$), never at gap-down market prices (FR-007, User Story 3, SDD § 3.2).  
✅ **Architecture Isolation**: PSM is a pure domain library with zero knowledge of:
  - Where OHLCV data originates (Binance, files, database, test synthesis)
  - Where events are persisted (Elasticsearch, ClickHouse, stdout, test mock)
  - API request/response cycles
  - Concurrency models or goroutines
  
  PSM accepts `Candle` as input and returns `[]Event` as output. Caller orchestrates everything else.

**BDD Acceptance Scenarios** validating Constitution gates (from spec.md):
- User Story 1, Scenario 1–5: Process candles → emit events → state transitions
- User Story 2: Pessimistic order enforcement (Buy → Liquidation → Take-Profit)
- User Story 3: Gap-Down Paradox Rule (fill at $P_n$, not market)
- User Story 4: Single-position invariant and re-entry on next candle

**TDD Unit Tests** validating Decimal arithmetic (from spec.md canonical test data table):
- Test P₁ = 98.00 (from P₀=100, entry=2%)
- Test P₂ = 95.844 (from P₁=98, entry=2%, scale=1.1)
- Test order amounts: A[0]=14.28571428, A[1]=28.57142857, A[2]=57.14285715 (from total=100)
- Test average entry: Pbar=96.922 (size-weighted average)
- Test take-profit: P_tp=97.40661 (Pbar × 1.005)
- Test liquidation: P_liq=50.33725964 (from formula in SDD § 2.5)

## Project Structure

### Documentation (this feature)

```text
specs/002-position-state-machine/
├── plan.md              # This file
├── research.md          # Phase 0: Decimal precision in Go, shopspring/decimal API
├── data-model.md        # Phase 1: Position, OrderFill, State, Event domain models
├── contracts/           # Phase 1: Go struct contracts for domain boundaries
│   ├── position.go      # Position and OrderFill types
│   ├── events.go        # Event domain (interface + concrete types)
│   └── config.go        # Config and OHLCV input types
├── quickstart.md        # Phase 1: Hello-world example with synthetic candles
├── checklists/
│   └── requirements.md  # (Existing) Specification quality checklist
└── spec.md              # (Existing) Feature specification
```

### Source Code (Polyglot Architecture)

```text
core-engine/
├── domain/
│   ├── config/                  # [EXISTING CONFIG FEATURE]
│   │   ├── config.go            
│   │   ├── config_test.go       
│   │   └── errors.go            
│   │
│   ├── position/                # [NEW: Position State Machine]
│   │   ├── position.go          # Core Position state object
│   │   ├── state.go             # State enum (IDLE, OPENING, SAFETY_WAIT, CLOSED)
│   │   ├── events.go            # Domain events (TradeOpened, BuyOrder, etc.)
│   │   ├── minute_loop.go       # ProcessCandle() - the main execution loop
│   │   ├── order_fills.go       # Order fill logic, gap-down handling
│   │   ├── liquidation.go       # Liquidation price calc + checks
│   │   ├── averaging.go         # Average entry price recalculation
│   │   ├── profit.go            # Profit calculation and fee deduction
│   │   │
│   │   ├── position_test.go     # Integration tests
│   │   ├── minute_loop_test.go  # Minute Loop Protocol tests (SDD § 3.1)
│   │   ├── gap_down_test.go     # Gap-Down Paradox Rule (SDD § 3.2)
│   │   ├── canonical_test.go    # Canonical test data from spec.md
│   │   └── fixtures/            # Synthetic candle test data
│   │       ├── synthetic_candles.go
│   │       └── test_config.go
│   │
│   └── pricegrid/               # [Pre-existing: Price & amount calculation]
│       └── (config feature already handles this)
│
└── infrastructure/              # Not in scope for this feature
    └── (Event publishers, data fetchers, etc. are orchestrator responsibility)

orchestrator/                   # Not in scope for this feature
└── (API, jobs, persistence handled elsewhere)
```

**Feature Placement Contract**: ✅ **This feature belongs entirely to `core-engine/domain/position/`** (mathematical domain logic, state machine, event schemas). Zero infrastructure, API, or orchestration logic.

---

## Design Phase: Data Models & Interfaces

### Phase 1a: Core Domain Types

**Goal**: Define the minimum set of types that PSM needs to accept as input and produce as output.

#### Input Contract: OHLCV Candle

```go
// Candle represents one 1-minute OHLCV bar from market data
type Candle struct {
    Timestamp time.Time
    Open      decimal.Decimal
    High      decimal.Decimal
    Low       decimal.Decimal
    Close     decimal.Decimal
    Volume    decimal.Decimal
}
```

#### State Machine State Enum

```go
type PositionState int

const (
    StateIdle PositionState = iota
    StateOpening
    SafetyOrderWait
    StateClosed
)
```

#### Core Position Data Model

```go
// Position represents a single open DCA trade
type Position struct {
    TradeID               string                  // UUID
    OpenTimestamp        time.Time               // When position was opened
    State                 PositionState           // Current state
    
    // Price grid (pre-calculated from config)
    Prices                []decimal.Decimal       // P₀, P₁, P₂, ... P_n (SDD § 2.1)
    Amounts               []decimal.Decimal       // A₀, A₁, A₂, ... A_n (SDD § 2.2)
    
    // Executed fills
    Orders                []OrderFill             // All filled orders (buy + sell)
    
    // Current position state
    PositionQuantity      decimal.Decimal         // Total base currency held (Q)
    AverageEntryPrice     decimal.Decimal         // Size-weighted avg entry (Pbar, SDD § 2.3)
    TakeProfitTarget      decimal.Decimal         // Take-profit trigger price (P_tp, SDD § 2.4)
    LiquidationPrice      decimal.Decimal         // Liquidation trigger (P_liq, SDD § 2.5)
    
    // P&L tracking (in quote currency)
    Profit                decimal.Decimal
    FeesAccumulated       decimal.Decimal
    
    // Metadata
    OpenPrice             decimal.Decimal         // Market buy price
    NextOrderIndex        int                     // Which order fills next
    HasMoreOrders         bool
}

// OrderFill represents a single executed buy or sell
type OrderFill struct {
    OrderIndex       int                 // 0-indexed into Prices/Amounts
    OrderNumber      int                 // 1-indexed for humans
    OrderType        OrderType           // MARKET (buy #1) or LIMIT (safety orders)
    ExecutedPrice    decimal.Decimal
    ExecutedQuantity decimal.Decimal
    QuoteAmount      decimal.Decimal     // Amount in USDT before fees
    Timestamp        time.Time
    Fee              decimal.Decimal     // Fee deducted from profit
}

type OrderType int

const (
    OrderTypeMarket OrderType = iota
    OrderTypeLimit
)
```

#### Domain Events (Output Contract)

```go
// Event is the base interface for all domain events
type Event interface {
    EventType() string
    Timestamp() time.Time
}

// TradeOpenedEvent
type TradeOpenedEvent struct {
    RunID            string
    TradeID          string
    Timestamp        time.Time
    TradingPair      string
    Amount           decimal.Decimal
    ConfiguredOrders []OrderFill         // Pre-calculated grid
    Config           *config.Config      // Strict Config type (SDD § 5.5)
}

// BuyOrderExecutedEvent
type BuyOrderExecutedEvent struct {
    RunID            string
    TradeID          string
    Timestamp        time.Time
    Price            decimal.Decimal
    Size             decimal.Decimal     // Quote amount (USDT) - SDD § 5.7
    BaseSize         decimal.Decimal     // Base currency quantity
    OrderType        OrderType
    LiquidationPrice decimal.Decimal
    OrderNumber      int
    Fee              decimal.Decimal
}

// LiquidationPriceUpdatedEvent
type LiquidationPriceUpdatedEvent struct {
    RunID           string
    TradeID         string
    Timestamp       time.Time
    TradingPair     string
    LiquidationPrice decimal.Decimal
    CurrentPrice    decimal.Decimal
    PriceRatio      decimal.Decimal     // (current / liquidation)
}

// TradeClosedEvent
type TradeClosedEvent struct {
    RunID         string
    TradeID       string
    OpenTimestamp time.Time
    Timestamp     time.Time
    TradingPair   string
    ClosingPrice  decimal.Decimal
    Size          decimal.Decimal     // Total position size
    Profit        decimal.Decimal
    Duration      time.Duration
    Reason        string              // "take_profit", "liquidation", "end_of_backtest"
}

// SellOrderExecutedEvent
type SellOrderExecutedEvent struct {
    RunID   string
    TradeID string
    Timestamp time.Time
    Price   decimal.Decimal
    Size    decimal.Decimal
    Profit  decimal.Decimal
}

// PriceChangedEvent
type PriceChangedEvent struct {
    RunID       string
    TradingPair string
    Timestamp   time.Time
    Open, High, Low, Close decimal.Decimal
    Volume      decimal.Decimal
}

// MonthlyAdditionEvent
type MonthlyAdditionEvent struct {
    RunID          string
    Timestamp      time.Time
    TradingPair    string
    AdditionAmount decimal.Decimal
    PreviousBalance decimal.Decimal
    NewBalance     decimal.Decimal
    AdditionNumber int
    DaysSinceStart int
}
```

### Phase 1b: Primary Interface Contract (Domain Boundary)

```go
// PositionStateMachine is the canonical interface for PSM operations
type PositionStateMachine interface {
    // ProcessCandle ingests one 1-minute OHLCV candle
    // Returns events emitted during processing (trade opened, order filled, liquidation, etc.)
    // PSM is stateless per call; caller retains Position state between calls
    ProcessCandle(ctx context.Context, position *Position, candle *Candle) ([]Event, error)
    
    // NewPosition initializes a fresh position with pre-calculated price/amount grids
    NewPosition(tradeID string, timestamp time.Time, cfg *config.Config) (*Position, error)
}
```

### Phase 1c: Implementation Structure (by responsibility)

Each `.go` file in `core-engine/domain/position/` handles one concern:

| File | Responsibility |
|------|---|
| `position.go` | Core Position struct definition, initialization |
| `state.go` | StateEnum, state transition logic |
| `events.go` | All concrete Event types + factory functions |
| `minute_loop.go` | **Main execution loop** (ProcessCandle) orchestrating buy → liquidation → take-profit |
| `order_fills.go` | Buy order matching, gap-down logic, fill determination |
| `liquidation.go` | `CalcLiquidationPrice()`, liquidation checks, mandatory loss calculation |
| `averaging.go` | `RecalcAverageEntryPrice()`, take-profit target recalculation |
| `profit.go` | `CalcProfit()`, fee deduction, quote/base quantity splitting |
| `position_test.go` | Integration tests across all concerns |
| `minute_loop_test.go` | BDD tests for Minute Loop Protocol (SDD § 3.1) |
| `gap_down_test.go` | Pessimistic execution tests: fill at P_n, not at market |
| `canonical_test.go` | Hard test cases from spec.md canonical table |
| `fixtures/` | Synthetic candle generation, test configuration helpers |

---

## Design Phase: Decimal Arithmetic Mapping

### Python `Decimal` → Go `shopspring/decimal.Decimal`

**Requirement** (SDD § 2.0): Fixed-point arithmetic with ROUND_HALF_UP precision.

| Python | Go (shopspring/decimal) | Notes |
|--------|---|---|
| `from decimal import Decimal, ROUND_HALF_UP` | `import "github.com/shopspring/decimal"` | Must import once in init |
| `d = Decimal("98.00")` | `d := decimal.NewFromString("98.00")` | Parse from string to avoid float |
| `d.quantize(Decimal("0.01"))` | `d.Round(2)` | Round to N decimal places |
| `d1 + d2` | `d1.Add(d2)` | Operator-like methods |
| `d1 * d2` | `d1.Mul(d2)` | Chaining supported |
| `d1 / d2` | `d1.Div(d2)` | No division by zero guard—caller must check |
| `Decimal("100") * Decimal("0.02")` | `decimal.NewFromString("100").Mul(decimal.NewFromString("0.02"))` | Exact 2% calculation |
| `round(d, 8)` → truncate | `d.Truncate(8)` | Truncation (not rounding) for lot-size |

**Precision enforcement** (in parity test):
```go
// Expected value from canonical Python bot
expected := decimal.NewFromString("98.00000000")

// Computed value from PSM
computed := calculatePrice(p0, entry, scale)

// Comparison (to exact decimal place)
if !computed.Equal(expected) {
    t.Errorf("precision loss: got %s, want %s", computed, expected)
}
```

---

## Design Phase: Architecture Isolation (Infrastructure Boundary)

### What PSM DOES (Domain)
- ✅ Accept `Candle` input
- ✅ Calculate liquidation price
- ✅ Determine order fills
- ✅ Return `[]Event` output
- ✅ Manage state transitions
- ✅ All Decimal math

### What PSM DOES NOT (Orchestrator responsibility)
- ❌ Fetch market data from Binance
- ❌ Persist events to Elasticsearch
- ❌ Manage Position state across candles (caller does this)
- ❌ Parse configuration files (pre-validated Config passed in)
- ❌ Dispatch events to message queues
- ❌ Measure latency or report metrics
- ❌ Handle HTTP requests
- ❌ Manage goroutines or concurrency

**Concrete boundary example**:
```go
// ✅ GOOD: PSM receives OHLCV data, returns events
func (psm *PSM) ProcessCandle(ctx context.Context, pos *Position, candle *Candle) ([]Event, error) {
    // All logic here is pure domain
    liq := calculateLiquidationPrice(pos.PositionQuantity, pos.AverageEntryPrice, ...)
    events := []Event{}
    
    // Check buy triggers
    if candle.Low.LessThanOrEqual(pos.Prices[pos.NextOrderIndex]) {
        events = append(events, &BuyOrderExecutedEvent{...})
    }
    
    return events, nil
}

// ❌ BAD: PSM should not touch infrastructure
func (psm *PSM) ProcessCandle(ctx context.Context, pos *Position, candle *Candle) ([]Event, error) {
    // NO: HTTP requests
    data, _ := http.Get("https://api.binance.com/...") 
    
    // NO: Elasticsearch
    esClient.Publish(event)
    
    // NO: Logging framework
    logger.Info("processing candle", "price", candle.Close)
}
```

**Orchestrator layer (outside scope)** consumes PSM:
```go
// orchestrator/backtester.go
func RunBacktest(cfg *config.Config, candles []Candle) error {
    psm := position.NewStateMachine()
    
    // Orchestrator manages state and integration
    pos, _ := psm.NewPosition(uuid.New().String(), candles[0].Timestamp, cfg)
    
    for _, candle := range candles {
        events, err := psm.ProcessCandle(ctx, pos, &candle)
        if err != nil {
            return err
        }
        
        // Orchestrator handles events
        for _, event := range events {
            elasticClient.Publish(event)  // ← Not PSM's concern
            updatePositionState(pos, event)
        }
    }
    
    return nil
}
```

---

## Complexity Tracking

| Element | Justification | Simpler Alternative Rejected |
|---------|---|---|
| 5 state enums (IDLE, OPENING, WAIT, CLOSED) | SDD § 3.3 specifies strict state machine with explicit transitions | Single boolean `isOpen` flag insufficient—cannot represent partial order fill states |
| Decimal arithmetic throughout | SDD § 2.0 mandates fixed-point for parity with Python | Float operations cause precision loss; Python bot uses Decimal for 100% reproducibility |
| Separate Order/Event types | SDD § 5.7 identifies semantic mismatch in legacy `size` field (quote vs. base currency) | Single combined type risks perpetuating confusion; explicit types enforce correctness |
| Gap-Down logic in order_fills.go | SDD § 3.2 requires pessimistic fill at P_n even on gap-down | Naive "fill at best available price" approach would over-optimize backtest (cheating) |

---

## Next Steps (Phase 0–1)

1. **Phase 0 (Research)**: `research.md`
   - Verify shopspring/decimal API and rounding modes
   - Confirm Go testing patterns for canonical test data validation
   - Document any edge cases in Decimal operations vs. Python equivalents

2. **Phase 1 (Design)**:
   - Generate `data-model.md` with complete type definitions
   - Create `contracts/` directory with Go struct definitions
   - Draft `quickstart.md` with example PSM usage
   - Update agent context for Copilot via `update-agent-context.ps1`

3. **Phase 2 (Implementation)**: Run `/speckit.tasks` to generate implementation tasks
