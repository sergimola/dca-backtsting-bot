package position

import (
	"time"

	"github.com/shopspring/decimal"
)

// Candle represents one 1-minute OHLCV bar from market data
// This is the primary input to ProcessCandle()
type Candle struct {
	Timestamp time.Time       // UTC timezone-aware
	Open      decimal.Decimal
	High      decimal.Decimal
	Low       decimal.Decimal
	Close     decimal.Decimal
	Volume    decimal.Decimal
}

// PositionStateMachine defines the interface for the core execution engine
type PositionStateMachine interface {
	// NewPosition creates a fresh position with pre-calculated price and amount grids
	NewPosition(tradeID string, timestamp time.Time, prices, amounts []decimal.Decimal) (*Position, error)
	
	// ProcessCandle applies the Minute Loop Protocol (SDD § 3.1) to one candle
	// Returns all events dispatched during this candle's processing
	ProcessCandle(pos *Position, candle *Candle) ([]Event, error)
}

// Event is the base interface for all domain events
type Event interface {
	EventType() string
	EventTimestamp() time.Time
}
