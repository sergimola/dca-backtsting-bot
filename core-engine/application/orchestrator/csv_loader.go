package orchestrator

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/shopspring/decimal"
)

// CSVLoader provides streaming CSV parsing for OHLCV candle data
type CSVLoader struct {
	reader    *csv.Reader
	columnMap map[string]int // Maps column names to indices
	rowNum    int             // Current row number (for error reporting)
	headers   []string        // Parsed headers
}

// NewCSVLoader creates a new CSV loader from an io.Reader
func NewCSVLoader(r io.Reader) *CSVLoader {
	return &CSVLoader{
		reader:    csv.NewReader(r),
		columnMap: make(map[string]int),
		rowNum:    0,
	}
}

// ValidateHeader reads and validates the CSV header row
// Required columns: symbol, timestamp, open, high, low, close, volume
func (cl *CSVLoader) ValidateHeader() error {
	if cl.rowNum != 0 {
		return errors.New("header already validated")
	}

	record, err := cl.reader.Read()
	if err != nil {
		if err == io.EOF {
			return errors.New("CSV is empty")
		}
		return fmt.Errorf("failed to read header: %w", err)
	}

	cl.rowNum = 1
	cl.headers = record

	// Build column map
	requiredColumns := []string{"symbol", "timestamp", "open", "high", "low", "close", "volume"}
	for i, header := range record {
		normalized := strings.ToLower(strings.TrimSpace(header))
		cl.columnMap[normalized] = i
	}

	// Validate all required columns exist
	for _, col := range requiredColumns {
		if _, exists := cl.columnMap[col]; !exists {
			return fmt.Errorf("missing required column: %s", col)
		}
	}

	return nil
}

// NextCandle reads the next row and returns a Candle struct
// Returns (nil, nil) at EOF
// Returns (nil, error) on parsing or validation error
func (cl *CSVLoader) NextCandle() (*Candle, error) {
	if len(cl.columnMap) == 0 {
		return nil, errors.New("header not validated; call ValidateHeader() first")
	}

	record, err := cl.reader.Read()
	if err != nil {
		if err == io.EOF {
			return nil, nil // End of file
		}
		return nil, fmt.Errorf("row %d: failed to read: %w", cl.rowNum+1, err)
	}

	cl.rowNum++

	// Validate column count
	if len(record) != len(cl.headers) {
		return nil, fmt.Errorf(
			"row %d: expected %d columns, got %d",
			cl.rowNum,
			len(cl.headers),
			len(record),
		)
	}

	// Extract and parse fields
	symbol := strings.TrimSpace(record[cl.columnMap["symbol"]])
	timestampStr := strings.TrimSpace(record[cl.columnMap["timestamp"]])
	openStr := strings.TrimSpace(record[cl.columnMap["open"]])
	highStr := strings.TrimSpace(record[cl.columnMap["high"]])
	lowStr := strings.TrimSpace(record[cl.columnMap["low"]])
	closeStr := strings.TrimSpace(record[cl.columnMap["close"]])
	volumeStr := strings.TrimSpace(record[cl.columnMap["volume"]])

	// Parse timestamp
	timestamp, err := time.Parse(time.RFC3339, timestampStr)
	if err != nil {
		return nil, fmt.Errorf("row %d: invalid timestamp format: %v", cl.rowNum, err)
	}

	// Parse decimal prices
	open, err := decimal.NewFromString(openStr)
	if err != nil {
		return nil, fmt.Errorf("row %d: invalid open price '%s': %v", cl.rowNum, openStr, err)
	}

	high, err := decimal.NewFromString(highStr)
	if err != nil {
		return nil, fmt.Errorf("row %d: invalid high price '%s': %v", cl.rowNum, highStr, err)
	}

	low, err := decimal.NewFromString(lowStr)
	if err != nil {
		return nil, fmt.Errorf("row %d: invalid low price '%s': %v", cl.rowNum, lowStr, err)
	}

	close, err := decimal.NewFromString(closeStr)
	if err != nil {
		return nil, fmt.Errorf("row %d: invalid close price '%s': %v", cl.rowNum, closeStr, err)
	}

	volume, err := decimal.NewFromString(volumeStr)
	if err != nil {
		return nil, fmt.Errorf("row %d: invalid volume '%s': %v", cl.rowNum, volumeStr, err)
	}

	// Create candle with validation (T013: Validate OHLCV invariants, T018: Validation logic)
	candle := &Candle{
		Symbol:    symbol,
		Timestamp: timestamp,
		Open:      open,
		High:      high,
		Low:       low,
		Close:     close,
		Volume:    volume,
	}

	// Validate OHLCV invariants (T013, T018)
	if err := validateOHLCV(candle, cl.rowNum); err != nil {
		return nil, err
	}

	return candle, nil
}

// validateOHLCV validates OHLC candle invariants
// Rules:
// 1. All prices must be positive (or zero for edge cases)
// 2. High >= Open (or close to it within tolerance)
// 3. High >= Close
// 4. High >= Low
// 5. Low <= Open
// 6. Low <= Close
func validateOHLCV(candle *Candle, rowNum int) error {
	zero := decimal.Zero

	// Rule 1: All prices must be non-negative
	if candle.Open.LessThan(zero) {
		return fmt.Errorf("row %d: validation failed - open price must be positive: %s", rowNum, candle.Open)
	}
	if candle.High.LessThan(zero) {
		return fmt.Errorf("row %d: validation failed - high price must be positive: %s", rowNum, candle.High)
	}
	if candle.Low.LessThan(zero) {
		return fmt.Errorf("row %d: validation failed - low price must be positive: %s", rowNum, candle.Low)
	}
	if candle.Close.LessThan(zero) {
		return fmt.Errorf("row %d: validation failed - close price must be positive: %s", rowNum, candle.Close)
	}
	if candle.Volume.LessThan(zero) {
		return fmt.Errorf("row %d: validation failed - volume must be non-negative: %s", rowNum, candle.Volume)
	}

	// Rule 2: High >= Open
	if candle.High.LessThan(candle.Open) {
		return fmt.Errorf(
			"row %d: validation failed - high (%s) must be >= open (%s)",
			rowNum,
			candle.High,
			candle.Open,
		)
	}

	// Rule 3: High >= Close
	if candle.High.LessThan(candle.Close) {
		return fmt.Errorf(
			"row %d: validation failed - high (%s) must be >= close (%s)",
			rowNum,
			candle.High,
			candle.Close,
		)
	}

	// Rule 4: High >= Low (PRIMARY INVARIANT)
	if candle.High.LessThan(candle.Low) {
		return fmt.Errorf(
			"row %d: validation failed - high (%s) must be >= low (%s)",
			rowNum,
			candle.High,
			candle.Low,
		)
	}

	// Rule 5: Low <= Open
	if candle.Low.GreaterThan(candle.Open) {
		return fmt.Errorf(
			"row %d: validation failed - low (%s) must be <= open (%s)",
			rowNum,
			candle.Low,
			candle.Open,
		)
	}

	// Rule 6: Low <= Close
	if candle.Low.GreaterThan(candle.Close) {
		return fmt.Errorf(
			"row %d: validation failed - low (%s) must be <= close (%s)",
			rowNum,
			candle.Low,
			candle.Close,
		)
	}

	return nil
}
