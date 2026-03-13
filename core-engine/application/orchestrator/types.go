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
