# Feature Specification: Backtest Orchestrator

**Feature Branch**: `003-backtest-orchestrator`  
**Created**: March 8, 2026  
**Status**: Draft  
**Input**: User description: "Backtest Orchestrator that loads historical OHLCV data, instantiates the Position State Machine, feeds candles into ProcessCandle sequentially, and captures events into in-memory Event Bus as bridge between infrastructure and core domain"

**Constitution Gates (MANDATORY)**: 

This feature conforms to:
- **Green Light Protocol**: All functionality must be covered by acceptance tests using BDD Given/When/Then scenarios. No merges occur until all tests pass.
- **Fixed-point Arithmetic**: All price/monetary calculations use already-established PSM Decimal precision (shopspring/decimal). The orchestrator acts as a bridge and does not perform calculations itself.
- **BDD Acceptance Criteria**: This specification includes Given/When/Then scenarios covering the primary orchestration flow and edge cases (empty data, single candle, large datasets).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run Backtest with Historical Data (Priority: P1)

A backtester loads historical OHLCV data from a file, instantiates the Position State Machine, and runs a complete backtest to verify that the trading strategy behaves correctly against historical price movements. The orchestrator sequences the candles and captures all trading events (entries, exits, liquidations) for analysis.

**Why this priority**: This is the core MVP of the orchestrator. Without it, nothing else matters - the orchestrator must be able to load data and feed it through the PSM to produce a complete execution trace.

**Independent Test**: A backtest can be fully tested by loading sample historical data (e.g., 100 candles), running the orchestrator, and verifying that:
- All 100 candles were processed in sequence
- The resulting Event Bus contains all expected trading events
- The backtest completes deterministically with the same results on repeat runs

**Acceptance Scenarios**:

1. **Given** a valid historical OHLCV data file (CSV format with symbol, timestamp, OHLCV columns), **When** the orchestrator loads the file and instantiates the PSM, **Then** the PSM is initialized with the correct configuration and ready to accept candles.

2. **Given** an initialized orchestrator with PSM ready, **When** candles are fed sequentially through `ProcessCandle()`, **Then** each candle is processed in the exact order it appeared in the historical data.

3. **Given** the PSM processes multiple candles and generates trading events (entries, exits), **When** events are captured by the Event Bus, **Then** every event is recorded with correct timestamp and event data.

4. **Given** a backtest has completed, **When** the Event Bus is queried, **Then** all events can be retrieved in chronological order to reconstruct the complete execution trace.

---

### User Story 2 - Handle Empty and Single-Candle Edge Cases (Priority: P2)

The orchestrator gracefully handles edge cases where the data file contains no candles or only a single candle, without crashing or producing spurious events.

**Why this priority**: Robustness is required for production use. The system must handle edge cases cleanly to avoid confusing backtests that might have zero activity or minimal data.

**Independent Test**: Can be tested independently by:
- Loading an empty data file and confirming the orchestrator initializes without error and produces no spurious events
- Loading a single-candle data file and confirming that one candle processes correctly

**Acceptance Scenarios**:

1. **Given** an empty OHLCV data file, **When** the orchestrator loads it and runs, **Then** the PSM is initialized but receives no candles, and the Event Bus remains empty.

2. **Given** a data file with a single candle, **When** the orchestrator processes it, **Then** the candle is fed to PSM exactly once, any resulting events are captured, and the backtest completes normally.

---

### User Story 3 - Support Large Backtest Windows (Priority: P3)

The orchestrator efficiently processes large historical datasets (e.g., several years of minute-level data) without memory leaks or performance degradation. The in-memory Event Bus scales to handle thousands of events.

**Why this priority**: Unlocks analysis of long-term strategies while ensuring no data loss or performance pitfalls creep in during scaled testing.

**Independent Test**: Can be tested independently by:
- Loading 1+ years of minute-level data (e.g., ~250K candles) and confirming all candles process and all events are captured
- Comparing memory usage before and after to detect leaks

**Acceptance Scenarios**:

1. **Given** a large historical dataset (1+ years of data), **When** the orchestrator processes all candles sequentially, **Then** every candle is processed and no candles are skipped or duplicated.

2. **Given** thousands of trading events captured during a long backtest, **When** the Event Bus is queried, **Then** all events remain in memory and are retrievable without data loss or corruption.

### Canonical Test Data & Mathematical Proofs *(MANDATORY FOR CORE DOMAIN)*

Since the orchestrator bridges infrastructure and core domain but does not perform trading calculations itself, the canonical test data focuses on *event capture fidelity* rather than numerical precision:

| Input State | Action | Expected Outcome | PSM Reference |
|-------------|--------|------------------|----------------|
| Initialized PSM, candle with price below liquidation threshold | Feed candle → PSM.ProcessCandle() | Liquidation event captured in Event Bus with exact liquidation price from PSM | core-engine/domain/position/liquidation.go |
| Position open, candle triggers entry target | Feed candle → PSM.ProcessCandle() | Entry event captured with exact entry price and Decimal amount from PSM | core-engine/domain/position/position.go |
| Multiple candles in sequence | Feed candles 1, 2, 3 sequentially | Events captured in exact sequence; Event Bus has events[0] from candle1, events[1..N] from candle2, etc. | core-engine/domain/position/position_test.go |

**Rationale**: The orchestrator is a data-flow orchestrator, not a calculation engine. Its key guarantee is that events are captured in the exact order PSM produces them, with no loss or reordering. If PSM produces an event, the orchestrator MUST capture it with pristine fidelity.

### Edge Cases

- What happens when the OHLCV data file is malformed (missing columns, invalid number format)?
- How does the orchestrator handle a scenario where PSM panics or returns an error during `ProcessCandle()`?
- What happens if the Event Bus fills with too many events (is there a limit, or is memory the only constraint)?
- How does the orchestrator handle a gap in timestamp continuity in the historical data (e.g., market closed overnight)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The orchestrator MUST load historical OHLCV data from a file-based source (CSV or similar delimited format) with columns: symbol, timestamp, open, high, low, close, volume.

- **FR-002**: The orchestrator MUST instantiate a Position State Machine instance with a provided configuration (e.g., initial margin, DCA parameters, entry/exit thresholds).

- **FR-003**: The orchestrator MUST feed candles to the PSM sequentially in the order they appear in the historical data, calling `PSM.ProcessCandle(candle)` for each candle without skipping or reordering.

- **FR-004**: The orchestrator MUST capture all events emitted by the PSM during `ProcessCandle()` calls and record them in an in-memory Event Bus with full fidelity (timestamp, event type, event data).

- **FR-005**: The orchestrator MUST guarantee that all captured events remain in memory and can be retrieved in chronological order for post-backtest analysis.

- **FR-006**: The orchestrator MUST validate that the PSM instance is correctly initialized before accepting candles, and reject candles if initialization fails.

- **FR-007**: The orchestrator MUST handle errors during data loading (e.g., file not found, malformed data) gracefully with informative error messages.

- **FR-008**: The orchestrator MUST ensure deterministic execution — running the same backtest with the same data and PSM configuration must produce identical event sequences.

### Key Entities

- **Candle (OHLCV)**: Represents a single time period of market data with Open, High, Low, Close prices and Volume. Sourced from historical data files.

- **Position State Machine (PSM)**: The core domain component that processes candles and emits trading events. The orchestrator does not modify PSM internals; it only calls `ProcessCandle()` and observes event output.

- **Event Bus**: An in-memory event log that captures and stores all events emitted by the PSM during the backtest. Provides query/retrieval interface for post-backtest analysis.

- **Backtest Orchestrator**: The coordinator that loads data → instantiates PSM → feeds candles → captures events. Acts as the bridge between the infrastructure layer (data files) and the core domain layer (PSM + Event Bus).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of candles from the input data file are processed in correct sequential order with no skips or duplicates.

- **SC-002**: 100% of events emitted by the PSM are captured by the Event Bus with no loss, corruption, or reordering.

- **SC-003**: Backtests are deterministic — running with identical inputs (data, PSM config) produces identical event sequences on every run.

- **SC-004**: The orchestrator can process a full year of minute-level market data (≈250K candles) in under 10 seconds without memory leaks.

- **SC-005**: Users can retrieve all captured events from the Event Bus and reconstruct a complete execution trace of the backtest for analysis.

- **SC-006**: Errors during data loading or PSM processing are surfaced to the user with clear, actionable error messages (not silent failures or crashes).

## Assumptions

- OHLCV data files are well-formed CSV with headers (symbol, timestamp, open, high, low, close, volume) in that order.
- Timestamps in historical data are already in UTC or a consistent timezone; the orchestrator does not perform timezone conversions.
- The PSM is already initialized with a valid configuration before the orchestrator passes candles to it.
- The in-memory Event Bus is sufficient for the backtest window; no persistence layer is required during a single backtest run.
- The candles in the historical data are already sorted in ascending order by timestamp.
