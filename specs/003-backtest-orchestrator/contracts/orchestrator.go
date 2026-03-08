// orchestrator.go - Public API Contract
// Package: core-engine/application/orchestrator (or core-engine/infrastructure/orchestrator)
//
// This file documents the public interface contract for the Backtest Orchestrator.
// The orchestrator bridges CSV data loading and PSM execution.

package orchestrator

import (
	"context"
	"time"

	"dca-bot/core-engine/domain/position" // PSM domain
	"github.com/shopspring/decimal"
)

// Candle represents a single OHLCV market data point.
type Candle struct {
	Symbol    string
	Timestamp time.Time
	Open      decimal.Decimal
	High      decimal.Decimal
	Low       decimal.Decimal
	Close     decimal.Decimal
	Volume    decimal.Decimal
}

// EventType enumerates possible trading events emitted by the PSM.
type EventType string

const (
	EventTypePositionOpened       EventType = "PositionOpened"
	EventTypeBuyOrderExecuted     EventType = "BuyOrderExecuted"
	EventTypeTakeProfitHit        EventType = "TakeProfitHit"
	EventTypeLiquidation          EventType = "Liquidation"
	EventTypePositionClosed       EventType = "PositionClosed"
	EventTypeMarginWarning        EventType = "MarginWarning"
)

// Event represents a single trading event captured from PSM execution.
type Event struct {
	Timestamp time.Time       // UTC time of event
	Type      EventType       // Event classification
	Data      interface{}     // Event-specific payload (type depends on EventType)
	RawEvent  interface{}     // Raw PSM event object for extensibility
}

// BacktestRun encapsulates a complete backtest execution.
type BacktestRun struct {
	ID         string        // Unique backtest identifier
	Symbol     string        // Trading pair
	StartTime  time.Time     // Execution start time
	EndTime    time.Time     // Execution end time
	CandleCount int          // Total candles processed
	EventCount int           // Total events captured
	EventBus   *EventBus     // In-memory event log
	PSMConfig  position.Config // PSM configuration used
}

// EventBus is an in-memory append-only event log.
type EventBus struct {
	events []Event
	// mu protects events slice during concurrent read/append
}

// Append adds a single event to the bus. Thread-safe for append.
func (eb *EventBus) Append(e Event) error {
	// Implementation: append to events slice
	// Thread-safe write; callers must not append concurrently
	return nil
}

// GetAllEvents returns all captured events in chronological order.
func (eb *EventBus) GetAllEvents() []Event {
	// Return a snapshot of all events
	return nil
}

// GetEventsByType filters events by type.
func (eb *EventBus) GetEventsByType(eventType EventType) []Event {
	// Return filtered events
	return nil
}

// GetEventsByTimeRange returns events within a time window.
func (eb *EventBus) GetEventsByTimeRange(start, end time.Time) []Event {
	// Return events where start <= Timestamp <= end
	return nil
}

// OrchestratorConfig configures the backtest orchestrator.
type OrchestratorConfig struct {
	// PSM configuration
	PSMConfig position.Config
	
	// CSV input file path (or reader interface for testability)
	DataSourcePath string
	
	// Optional: expected total candles (if known; allows pre-allocation)
	EstimatedCandleCount int
	
	// Optional: backtest ID (generated if not provided)
	BacktestID string
	
	// Optional: early exit callback for progress monitoring
	ProgressCallback func(candleIdx int, eventCount int) error
}

// Orchestrator coordinates backtest execution.
type Orchestrator struct {
	config    OrchestratorConfig
	psm       *position.PositionStateMachine // or similar PSM type
	eventBus  *EventBus
	// Additional fields as needed
}

// New creates a new Orchestrator with the given configuration.
// Initializes PSM and prepares for backtest execution.
//
// Returns error if PSMConfig is invalid or EventBus allocation fails.
func New(ctx context.Context, cfg OrchestratorConfig) (*Orchestrator, error) {
	// Implementation: validate config, create PSM, initialize EventBus
	return nil, nil
}

// RunBacktest loads CSV data, feeds candles to PSM, and captures events.
//
// Guarantees:
// - All candles are processed in CSV order (no skips, no duplicates)
// - All PSM events are captured in emission order (no loss, no reordering)
// - Execution is deterministic: same input produces identical event sequence
// - Completes within performance target (<10 seconds for 250K candles)
//
// Returns error if CSV loading fails or PSM panics.
// After RunBacktest returns (successfully or with error), the EventBus can be queried for partial results.
func (o *Orchestrator) RunBacktest(ctx context.Context) (*BacktestRun, error) {
	// Implementation:
	// 1. Load CSV data (streaming or buffered)
	// 2. For each candle in order:
	//    a. Feed candle to PSM via PSM.ProcessCandle(candle)
	//    b. Capture returned events to EventBus
	//    c. Call ProgressCallback if provided
	// 3. Return BacktestRun with final results
	//
	// Handle errors: malformed CSV, invalid Decimal, PSM errors, context cancellation
	return nil, nil
}

// GetRun returns the BacktestRun results after RunBacktest completes.
func (o *Orchestrator) GetRun() *BacktestRun {
	// Return current run snapshot
	return nil
}

// GetEventBus allows callers to query captured events.
func (o *Orchestrator) GetEventBus() *EventBus {
	return nil
}

// CSV Loader Adapter (internal, may be exported for testing)

// CSVLoader handles parsing and streaming OHLCV data from CSV files.
type CSVLoader struct {
	filePath string
	// buffered reader fields
}

// NewCSVLoader opens and validates a CSV file.
func NewCSVLoader(filePath string) (*CSVLoader, error) {
	// Validate file exists, readable
	return nil, nil
}

// NextCandle reads the next candle from CSV.
// Returns io.EOF when file is exhausted.
func (l *CSVLoader) NextCandle() (*Candle, error) {
	// Parse next row, return Candle or error
	return nil, nil
}

// Close releases CSV file resources.
func (l *CSVLoader) Close() error {
	return nil
}

// Error Types

// ErrMalformedCSV indicates a CSV parsing error (missing columns, invalid format).
type ErrMalformedCSV struct {
	Row    int
	Column string
	Reason string
}

// ErrInvalidCandle indicates a Candle validation failure (e.g., High < Low).
type ErrInvalidCandle struct {
	Reason string
	Candle *Candle
}

// ErrPSMProcessing indicates PSM processing failed during candle feed.
type ErrPSMProcessing struct {
	CandleIdx int
	Candle    *Candle
	Reason    string
}

// === Acceptance Test Contracts ===
//
// The following scenarios MUST pass before merging:
//
// Scenario 1: Load Valid Data and Process (P1/S1)
//   Given: Valid CSV with 100 candles
//   When:  RunBacktest() is called
//   Then:  All 100 candles are processed, EventBus.GetAllEvents() returns non-empty list
//
// Scenario 2: Empty CSV File (P2/S1)
//   Given: Empty CSV file (no data rows)
//   When:  RunBacktest() is called
//   Then:  RunBacktest succeeds, EventBus.GetAllEvents() is empty
//
// Scenario 3: Single Candle (P2/S2)
//   Given: CSV with 1 candle
//   When:  RunBacktest() is called
//   Then:  1 candle processed, EventBus has any resulting events
//
// Scenario 4: Malformed CSV (P1/S3)
//   Given: CSV with missing CLOSE column
//   When:  RunBacktest() is called
//   Then:  Error returned, EventBus has partial results (events up to error)
//
// Scenario 5: Determinism (P1/S4)
//   Given: Same CSV, same PSMConfig
//   When:  RunBacktest() called twice
//   Then:  Both runs produce identical event sequences
//
// Scenario 6: Event Order (P1/S3)
//   Given: CSV with 3 candles that trigger events
//   When:  RunBacktest() processes all candles
//   Then:  EventBus.GetAllEvents() returns events in exact PSM emission order
//
// Scenario 7: Large Backtest (P3/S1)
//   Given: CSV with 250K candles
//   When:  RunBacktest() is called
//   Then:  Completes in under 10 seconds, all candles processed, no events lost
