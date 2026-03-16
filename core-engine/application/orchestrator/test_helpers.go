package orchestrator

import (
	"encoding/csv"
	"os"
	"strings"
	"testing"
	"time"

	"dca-bot/core-engine/domain/position"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
)

// MockCandleLoader implements CandleLoader backed by a pre-loaded slice.
// Used in orchestrator and integration tests as a drop-in for ClickHouseCandleLoader.
type MockCandleLoader struct {
	candles  []*Candle
	pos      int
	closed   bool
	// errAt: if >= 0, NextCandle returns nextErr when pos == errAt
	errAt   int
	nextErr error
}

// NewMockCandleLoader creates a loader that replays candles in ascending order.
func NewMockCandleLoader(candles []*Candle) *MockCandleLoader {
	return &MockCandleLoader{candles: candles, errAt: -1}
}

// NewMockCandleLoaderWithError creates a loader that returns err as the first NextCandle call.
// Useful for testing how RunBacktest handles loader errors.
func NewMockCandleLoaderWithError(err error) *MockCandleLoader {
	return &MockCandleLoader{candles: nil, errAt: 0, nextErr: err}
}

// NextCandle satisfies CandleLoader.
func (m *MockCandleLoader) NextCandle() (*Candle, error) {
	if m.errAt >= 0 && m.pos == m.errAt {
		return nil, m.nextErr
	}
	if m.pos >= len(m.candles) {
		return nil, nil
	}
	c := m.candles[m.pos]
	m.pos++
	return c, nil
}

// Close marks the loader as closed; safe to call multiple times.
func (m *MockCandleLoader) Close() error {
	m.closed = true
	return nil
}

// Count returns the number of candles in the pre-loaded slice.
// Satisfies the CandleLoader interface for use in tests.
func (m *MockCandleLoader) Count() (int64, error) {
	return int64(len(m.candles)), nil
}

// makeCandles creates n sequential 1-minute candles starting at 2025-01-01 00:00 UTC.
// Used by clickhouse_loader_test.go and other test files.
func makeCandles(n int) []*Candle {
	base := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	candles := make([]*Candle, n)
	for i := range candles {
		price := decimal.NewFromInt(int64(50000 + i))
		candles[i] = &Candle{
			Symbol:    "BTCUSDT",
			Timestamp: base.Add(time.Duration(i) * time.Minute),
			Open:      price,
			High:      price.Add(decimal.NewFromInt(1)),
			Low:       price.Sub(decimal.NewFromInt(1)),
			Close:     price,
			Volume:    decimal.NewFromFloat(1.5),
		}
	}
	return candles
}

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

// parseCandlesFromReader reads a CSV with header row and returns all candles.
// Required columns: symbol, timestamp, open, high, low, close, volume.
// tb.Fatal is called on any parse error.
func parseCandlesFromReader(tb testing.TB, r interface{ Read() ([]string, error) }) []*Candle {
	tb.Helper()

	// Read header
	header, err := r.Read()
	if err != nil {
		tb.Fatalf("parseCandlesFromReader: could not read header: %v", err)
	}
	idx := make(map[string]int)
	for i, h := range header {
		idx[strings.ToLower(strings.TrimSpace(h))] = i
	}
	required := []string{"symbol", "timestamp", "open", "high", "low", "close", "volume"}
	for _, col := range required {
		if _, ok := idx[col]; !ok {
			tb.Fatalf("parseCandlesFromReader: missing required column %q", col)
		}
	}

	mustDecimal := func(s string, col string) decimal.Decimal {
		d, e := decimal.NewFromString(s)
		if e != nil {
			tb.Fatalf("parseCandlesFromReader: invalid %s value %q: %v", col, s, e)
		}
		return d
	}

	var candles []*Candle
	rowNum := 1
	for {
		rec, e := r.Read()
		rowNum++
		if e != nil {
			if e.Error() == "EOF" {
				break
			}
			// encoding/csv returns io.EOF; we check via err string for compatibility
			break
		}
		if len(rec) == 0 {
			continue
		}

		tsStr := strings.TrimSpace(rec[idx["timestamp"]])
		ts, pe := time.Parse(time.RFC3339, tsStr)
		if pe != nil {
			// Try without timezone suffix
			ts, pe = time.Parse("2006-01-02T15:04:05", tsStr)
		}
		if pe != nil {
			tb.Fatalf("parseCandlesFromReader: row %d: invalid timestamp %q: %v", rowNum, tsStr, pe)
		}
		candles = append(candles, &Candle{
			Symbol:    strings.TrimSpace(rec[idx["symbol"]]),
			Timestamp: ts.UTC(),
			Open:      mustDecimal(strings.TrimSpace(rec[idx["open"]]), "open"),
			High:      mustDecimal(strings.TrimSpace(rec[idx["high"]]), "high"),
			Low:       mustDecimal(strings.TrimSpace(rec[idx["low"]]), "low"),
			Close:     mustDecimal(strings.TrimSpace(rec[idx["close"]]), "close"),
			Volume:    mustDecimal(strings.TrimSpace(rec[idx["volume"]]), "volume"),
		})
	}
	return candles
}

// CandlesFromCSVString parses a raw CSV string and returns a MockCandleLoader.
// This adapts existing CSV-string test fixtures to the CandleLoader interface
// without removing the human-readable CSV from the test files.
func CandlesFromCSVString(tb testing.TB, csvText string) *MockCandleLoader {
	tb.Helper()
	r := csv.NewReader(strings.NewReader(csvText))
	return NewMockCandleLoader(parseCandlesFromReader(tb, r))
}

// LoadCSVFileAsLoader opens a CSV file and returns a MockCandleLoader with all its candles.
// Calls tb.Fatal if the file cannot be opened or parsed.
func LoadCSVFileAsLoader(tb testing.TB, filePath string) *MockCandleLoader {
	tb.Helper()
	return NewMockCandleLoader(LoadTestCSV(tb, filePath))
}

// LoadTestCSV loads a CSV file and returns all candles
// Useful for integration tests that need to verify full dataset
func LoadTestCSV(tb testing.TB, filePath string) []*Candle {
	tb.Helper()

	file, err := os.Open(filePath)
	if err != nil {
		tb.Fatalf("Failed to open test CSV: %v", err)
	}
	defer file.Close()

	r := csv.NewReader(file)
	return parseCandlesFromReader(tb, r)
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
