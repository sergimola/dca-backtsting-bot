package orchestrator

import (
	"time"

	"dca-bot/core-engine/domain/position"

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
	ID            string             // Unique backtest identifier
	Symbol        string             // Trading pair
	StartTime     time.Time          // Execution start time
	EndTime       time.Time          // Execution end time
	CandleCount   int                // Total candles processed
	EventCount    int                // Total events captured
	EventBus      *EventBus          // In-memory event log
	FinalPosition *position.Position // Live position state at end of backtest (nil if no position opened)
}

// CandleLoader is the abstraction over any candle source (ClickHouse, mock, etc.).
// NextCandle returns the next candle in ascending timestamp order.
// It returns (nil, nil) to signal end of stream, and (nil, err) on error.
// Count returns the total number of candles available for progress percentage calculation.
// Close must be called to release the underlying connection or resources.
type CandleLoader interface {
	NextCandle() (*Candle, error)
	Count() (int64, error) // pre-flight row count for progress percentage; returns (0, err) on failure
	Close() error
}

// ClickHouseConfig holds the connection parameters for the ClickHouse native TCP driver.
type ClickHouseConfig struct {
	Addr     string // host:port, e.g. "localhost:9000"
	Database string // e.g. "dca_bot"
	User     string
	Password string
}
