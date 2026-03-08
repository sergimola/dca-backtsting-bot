package position

import "errors"

// Domain errors for Position State Machine
var (
	ErrInvalidTradeID        = errors.New("invalid or empty trade ID")
	ErrNoPricesConfigured    = errors.New("no prices configured for position")
	ErrPricesAmountsMismatch = errors.New("prices and amounts slices must have equal length")
	ErrNilCandle             = errors.New("candle cannot be nil")
	ErrNilPosition           = errors.New("position cannot be nil")
)
