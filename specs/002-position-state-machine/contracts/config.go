// Package position defines input contracts for the Position State Machine
package position

import (
	"time"

	"github.com/shopspring/decimal"
)

// Candle represents one 1-minute OHLCV bar from market data
type Candle struct {
	Timestamp time.Time       // UTC timezone-aware
	Open      decimal.Decimal
	High      decimal.Decimal
	Low       decimal.Decimal
	Close     decimal.Decimal
	Volume    decimal.Decimal
}

// PositionStateMachine is the canonical interface for PSM operations
type PositionStateMachine interface {
	// ProcessCandle ingests one 1-minute OHLCV candle and emits events
	// Position state is modified in-place if transactions occur
	// Returns events emitted during processing
	ProcessCandle(pos *Position, candle *Candle) ([]Event, error)

	// NewPosition initializes a fresh position with pre-calculated grids
	NewPosition(tradeID string, timestamp time.Time, prices, amounts []decimal.Decimal) (*Position, error)
}
