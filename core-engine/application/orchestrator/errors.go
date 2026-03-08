package orchestrator

import "fmt"

// ErrMalformedCSV indicates a CSV parsing error (missing columns, invalid format).
type ErrMalformedCSV struct {
	Row    int
	Column string
	Reason string
}

func (e *ErrMalformedCSV) Error() string {
	return fmt.Sprintf("malformed CSV at row %d, column %s: %s", e.Row, e.Column, e.Reason)
}

// ErrInvalidCandle indicates a Candle validation failure (e.g., High < Low).
type ErrInvalidCandle struct {
	Reason string
	Candle *Candle
}

func (e *ErrInvalidCandle) Error() string {
	return fmt.Sprintf("invalid candle: %s (timestamp: %v)", e.Reason, e.Candle.Timestamp)
}

// ErrPSMProcessing indicates PSM processing failed during candle feed.
type ErrPSMProcessing struct {
	CandleIdx int
	Candle    *Candle
	Reason    string
}

func (e *ErrPSMProcessing) Error() string {
	return fmt.Sprintf("PSM processing error at candle %d (timestamp: %v): %s", e.CandleIdx, e.Candle.Timestamp, e.Reason)
}
