package position

import (
	"testing"

	"github.com/shopspring/decimal"
)

// mustDecimal parses a decimal string and panics on error
// Used in tests for convenience
func mustDecimal(s string) decimal.Decimal {
	d, err := decimal.NewFromString(s)
	if err != nil {
		panic("mustDecimal: failed to parse " + s + ": " + err.Error())
	}
	return d
}

// mustDecimalSlice creates a slice of decimals from strings
func mustDecimalSlice(strs ...string) []decimal.Decimal {
	result := make([]decimal.Decimal, len(strs))
	for i, s := range strs {
		result[i] = mustDecimal(s)
	}
	return result
}

// assertDecimalEqual checks if two decimals are exactly equal (for test assertions)
func assertDecimalEqual(t *testing.T, expected, actual decimal.Decimal, msg string) {
	t.Helper()
	if !expected.Equal(actual) {
		t.Errorf("%s: expected %s, got %s", msg, expected.String(), actual.String())
	}
}

// assertDecimalEqualWithPrecision checks decimals to N decimal places
// precision parameter specifies number of decimal places to compare
func assertDecimalEqualWithPrecision(t *testing.T, expected, actual decimal.Decimal, precision int32, msg string) {
	t.Helper()
	// Round both to specified precision for comparison
	expectedRounded := expected.Round(precision)
	actualRounded := actual.Round(precision)
	if !expectedRounded.Equal(actualRounded) {
		t.Errorf("%s: expected %s, got %s (precision: %d)", msg, expectedRounded.String(), actualRounded.String(), precision)
	}
}
