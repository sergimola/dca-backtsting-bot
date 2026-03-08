package position

import (
	"time"

	"github.com/shopspring/decimal"
)

// StateMachine implements the PositionStateMachine interface
type StateMachine struct {
	// Placeholder for future internal state management
}

// NewStateMachine creates a new Position State Machine instance
func NewStateMachine() *StateMachine {
	return &StateMachine{}
}

// NewPosition is a factory method that creates a fresh position with pre-calculated grids
// This is mostly a wrapper around the Position constructor
func (sm *StateMachine) NewPosition(tradeID string, timestamp time.Time, prices, amounts []decimal.Decimal) (*Position, error) {
	if tradeID == "" {
		return nil, ErrInvalidTradeID
	}
	if len(prices) == 0 {
		return nil, ErrNoPricesConfigured
	}
	if len(amounts) != len(prices) {
		return nil, ErrPricesAmountsMismatch
	}
	
	return NewPosition(tradeID, timestamp, prices, amounts), nil
}
