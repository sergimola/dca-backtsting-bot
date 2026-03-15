package orchestrator

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ──────────────────────────────────────────────────────────────────────────────
// T017 Test Cases (MockCandleLoader is defined in test_helpers.go)
// ──────────────────────────────────────────────────────────────────────────────

// T017-A: NextCandle returns candles in insertion order.
func TestMockCandleLoader_ReturnsInOrder(t *testing.T) {
	candles := makeCandles(3)
	loader := NewMockCandleLoader(candles)

	for i, expected := range candles {
		got, err := loader.NextCandle()
		require.NoError(t, err, "row %d should not error", i)
		require.NotNil(t, got, "row %d should not be nil", i)
		assert.Equal(t, expected.Timestamp, got.Timestamp, "timestamp order mismatch at row %d", i)
		assert.Equal(t, expected.Close.String(), got.Close.String(), "close price mismatch at row %d", i)
	}
}

// T017-B: After the last candle, NextCandle returns (nil, nil).
func TestMockCandleLoader_ReturnsNilAtEOF(t *testing.T) {
	loader := NewMockCandleLoader(makeCandles(2))

	loader.NextCandle() //nolint:errcheck // first
	loader.NextCandle() //nolint:errcheck // second

	got, err := loader.NextCandle() // EOF
	assert.NoError(t, err)
	assert.Nil(t, got, "loader should return nil at EOF")
}

// T017-C: Close sets the closed flag; a second Close must not panic.
func TestMockCandleLoader_CloseIsIdempotent(t *testing.T) {
	loader := NewMockCandleLoader(makeCandles(1))

	assert.NoError(t, loader.Close())
	assert.True(t, loader.closed)

	// Second close — must not panic
	assert.NoError(t, loader.Close())
}

// T017-D: Ascending timestamp invariant — each candle is 1 minute after the previous.
func TestMockCandleLoader_AscendingTimestamps(t *testing.T) {
	candles := makeCandles(5)
	loader := NewMockCandleLoader(candles)

	var prev *Candle
	for {
		c, err := loader.NextCandle()
		require.NoError(t, err)
		if c == nil {
			break
		}
		if prev != nil {
			assert.True(t, c.Timestamp.After(prev.Timestamp),
				"candle at %v should be after %v", c.Timestamp, prev.Timestamp)
		}
		prev = c
	}
}

// T017-E: Empty loader returns nil on the first call.
func TestMockCandleLoader_EmptyLoader(t *testing.T) {
	loader := NewMockCandleLoader(nil)
	got, err := loader.NextCandle()
	assert.NoError(t, err)
	assert.Nil(t, got)
}
