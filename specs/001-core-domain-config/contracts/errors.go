// Package config defines error types for configuration and sequence operations.
// SDD Reference: Section 4.1 (Configuration validation requirements)
package config

import (
	"fmt"

	"github.com/shopspring/decimal"
)

// ErrNilAmountInSequence indicates that an amount in the sequence is nil.
var ErrNilAmountInSequence = fmt.Errorf("amount sequence contains nil element")

// ValidationError represents a configuration validation failure with actionable diagnostics.
type ValidationError struct {
	Parameter string // Name of the invalid parameter
	Value     interface{} // Actual value provided
	Reason    string // Diagnostic message (why it's invalid)
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("Config validation failed: %s=%v (%s)", e.Parameter, e.Value, e.Reason)
}

// NewValidationError constructs a ValidationError with diagnostic message.
func NewValidationError(param string, value interface{}, reason string) *ValidationError {
	return &ValidationError{
		Parameter: param,
		Value:     value,
		Reason:    reason,
	}
}

// SequenceComputationError represents a failure during price or amount sequence calculation.
type SequenceComputationError struct {
	SequenceType string // "PriceSequence" or "AmountSequence"
	Order        int    // Which order (n) failed
	Reason       string // Why computation failed
}

func (e *SequenceComputationError) Error() string {
	return fmt.Sprintf("%s computation failed at order %d: %s", e.SequenceType, e.Order, e.Reason)
}

// NewSequenceComputationError constructs a SequenceComputationError.
func NewSequenceComputationError(seqType string, order int, reason string) *SequenceComputationError {
	return &SequenceComputationError{
		SequenceType: seqType,
		Order:        order,
		Reason:       reason,
	}
}

// PrecisionError indicates loss of Decimal precision in computation.
type PrecisionError struct {
	Operation string // Operation that failed precision check
	Expected  string // Expected value (from canonical test data)
	Actual    string // Actual value produced
}

func (e *PrecisionError) Error() string {
	return fmt.Sprintf("Precision loss in %s: expected %s, got %s", e.Operation, e.Expected, e.Actual)
}

// NewPrecisionError constructs a PrecisionError.
func NewPrecisionError(operation, expected, actual string) *PrecisionError {
	return &PrecisionError{
		Operation: operation,
		Expected:  expected,
		Actual:    actual,
	}
}

// SumInvariantViolation indicates that an amount sequence sum does not equal C*m exactly.
type SumInvariantViolation struct {
	ExpectedSum decimal.Decimal // C * m
	ActualSum   decimal.Decimal // Computed sum
	Tolerance   decimal.Decimal // Maximum allowed deviation
}

func (e *SumInvariantViolation) Error() string {
	return fmt.Sprintf("Amount sequence sum invariant violated: expected %s, got %s (difference: %s)",
		e.ExpectedSum.String(), e.ActualSum.String(), e.ExpectedSum.Sub(e.ActualSum).String())
}

// NewSumInvariantViolation constructs a SumInvariantViolation.
func NewSumInvariantViolation(expected, actual decimal.Decimal) *SumInvariantViolation {
	return &SumInvariantViolation{
		ExpectedSum: expected,
		ActualSum:   actual,
		Tolerance:   decimal.NewFromInt(0), // Zero tolerance per FR-007
	}
}
