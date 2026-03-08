// Package config — Error types for DCA Config domain validation and sequence computation.
// SDD Reference: Section 2.0 (Precision), Section 4.1 (Config Contract)
package config

import "fmt"

// ValidationError is returned when a Config parameter fails type or constraint validation.
// FR-003, FR-009, FR-010, FR-011, FR-012
type ValidationError struct {
	Field   string
	Value   any
	Message string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("Config validation failed: %s (value=%v): %s", e.Field, e.Value, e.Message)
}

// SequenceComputationError is returned when price or amount sequence computation fails.
// FR-004, FR-006
type SequenceComputationError struct {
	Sequence string // "price" or "amount"
	Message  string
}

func (e *SequenceComputationError) Error() string {
	return fmt.Sprintf("sequence computation failed [%s]: %s", e.Sequence, e.Message)
}

// PrecisionError is returned when a fixed-point precision violation is detected.
// FR-013
type PrecisionError struct {
	Operation string
	Message   string
}

func (e *PrecisionError) Error() string {
	return fmt.Sprintf("precision error in %s: %s", e.Operation, e.Message)
}

// SumInvariantViolation is returned when amount sequence sum deviates from C*m.
// FR-007, SC-007
type SumInvariantViolation struct {
	Expected string
	Actual   string
}

func (e *SumInvariantViolation) Error() string {
	return fmt.Sprintf("amount sequence sum invariant violated: expected %s, got %s", e.Expected, e.Actual)
}
