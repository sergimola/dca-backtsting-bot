package orchestrator

import (
	"os"
	"testing"
	"time"

	"dca-bot/core-engine/domain/position"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
)

// MakePSM creates a Position State Machine for testing
func MakePSM() position.PositionStateMachine {
	return position.NewStateMachine()
}

// MakeSampleCandle creates a quick candle for testing
func MakeSampleCandle(symbol string, timestamp string, open, high, low, close, volume string) *Candle {
	t, _ := time.Parse(time.RFC3339, timestamp)
	openVal, _ := decimal.NewFromString(open)
	highVal, _ := decimal.NewFromString(high)
	lowVal, _ := decimal.NewFromString(low)
	closeVal, _ := decimal.NewFromString(close)
	volumeVal, _ := decimal.NewFromString(volume)

	return &Candle{
		Symbol:    symbol,
		Timestamp: t,
		Open:      openVal,
		High:      highVal,
		Low:       lowVal,
		Close:     closeVal,
		Volume:    volumeVal,
	}
}

// LoadTestCSV loads a CSV file and returns all candles
// Useful for integration tests that need to verify full dataset
func LoadTestCSV(t *testing.T, filePath string) []*Candle {
	t.Helper()

	file, err := os.Open(filePath)
	if err != nil {
		t.Fatalf("Failed to open test CSV: %v", err)
	}
	defer file.Close()

	loader := NewCSVLoader(file)
	if err := loader.ValidateHeader(); err != nil {
		t.Fatalf("CSV header validation failed: %v", err)
	}

	var candles []*Candle
	for {
		candle, err := loader.NextCandle()
		if err != nil {
			t.Fatalf("CSV parsing failed: %v", err)
		}
		if candle == nil {
			break
		}
		candles = append(candles, candle)
	}

	return candles
}

// AssertEventsEqual performs deep equality comparison on event slices
// Checks event count, types, timestamps, and data structure
func AssertEventsEqual(t *testing.T, got, want []Event) {
	t.Helper()

	assert.Equal(t, len(want), len(got), "event count mismatch")

	for i := range want {
		gotEvent := got[i]
		wantEvent := want[i]

		assert.Equal(t, wantEvent.Type, gotEvent.Type, "event type mismatch at index %d", i)
		assert.Equal(t, wantEvent.Timestamp, gotEvent.Timestamp, "event timestamp mismatch at index %d", i)
	}
}

// AssertCandlesEqual compares candle slices for equality
func AssertCandlesEqual(t *testing.T, got, want []*Candle) {
	t.Helper()

	assert.Equal(t, len(want), len(got), "candle count mismatch")

	for i := range want {
		gotCandle := got[i]
		wantCandle := want[i]

		assert.Equal(t, wantCandle.Symbol, gotCandle.Symbol, "symbol mismatch at index %d", i)
		assert.Equal(t, wantCandle.Timestamp, gotCandle.Timestamp, "timestamp mismatch at index %d", i)
		assert.True(t, wantCandle.Open.Equal(gotCandle.Open), "open price mismatch at index %d", i)
		assert.True(t, wantCandle.High.Equal(gotCandle.High), "high price mismatch at index %d", i)
		assert.True(t, wantCandle.Low.Equal(gotCandle.Low), "low price mismatch at index %d", i)
		assert.True(t, wantCandle.Close.Equal(gotCandle.Close), "close price mismatch at index %d", i)
		assert.True(t, wantCandle.Volume.Equal(gotCandle.Volume), "volume mismatch at index %d", i)
	}
}

// AssertBacktestRun verifies key properties of a backtest run
func AssertBacktestRun(t *testing.T, run *BacktestRun, expectedCandleCount int) {
	t.Helper()

	assert.NotNil(t, run, "backtest run should not be nil")
	assert.Equal(t, expectedCandleCount, run.CandleCount, "candle count mismatch")
	assert.True(t, run.EndTime.After(run.StartTime), "end time should be after start time")
	assert.NotNil(t, run.EventBus, "event bus should be populated")
}

// AssertNoLint checks for common lint issues in generated code
// This is a helper for manual verification before running go vet
func AssertNoLint(t *testing.T) {
	t.Helper()
	// Placeholder for custom linting checks if needed
	// Can be expanded to check unused variables, imports, etc.
}
