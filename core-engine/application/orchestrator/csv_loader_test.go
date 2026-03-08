package orchestrator

import (
	"strings"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// T011: CSV Header Parsing and Validation
func TestCSVLoader_ValidHeader_Parses_Successfully(t *testing.T) {
	// Arrange
	csvData := "symbol,timestamp,open,high,low,close,volume\nBTC,2024-01-01T00:00:00Z,40000,41000,39000,40500,1.5"
	reader := strings.NewReader(csvData)

	// Act
	loader := NewCSVLoader(reader)
	err := loader.ValidateHeader()

	// Assert
	assert.NoError(t, err, "valid header should parse without error")
}

func TestCSVLoader_InvalidHeader_Missing_Close_Returns_Error(t *testing.T) {
	// Arrange - Missing "close" column
	csvData := "symbol,timestamp,open,high,low,volume\nBTC,2024-01-01T00:00:00Z,40000,41000,39000,1.5"
	reader := strings.NewReader(csvData)

	// Act
	loader := NewCSVLoader(reader)
	err := loader.ValidateHeader()

	// Assert
	assert.Error(t, err, "missing CLOSE column should return error")
	assert.Contains(t, err.Error(), "close", "error should mention missing close column")
}

func TestCSVLoader_InvalidHeader_Missing_Multiple_Columns_Returns_Error(t *testing.T) {
	// Arrange - Missing "high" and "low"
	csvData := "symbol,timestamp,open,close,volume\nBTC,2024-01-01T00:00:00Z,40000,40500,1.5"
	reader := strings.NewReader(csvData)

	// Act
	loader := NewCSVLoader(reader)
	err := loader.ValidateHeader()

	// Assert
	assert.Error(t, err, "missing multiple columns should return error")
}

func TestCSVLoader_EmptyCSV_Header_Only_Returns_No_Error(t *testing.T) {
	// Arrange - Only header, no data rows
	csvData := "symbol,timestamp,open,high,low,close,volume\n"
	reader := strings.NewReader(csvData)

	// Act
	loader := NewCSVLoader(reader)
	err := loader.ValidateHeader()

	// Assert
	assert.NoError(t, err, "CSV with header only should parse without error")
}

// T012: CSV Row Parsing into Candle Structs
func TestCSVLoader_Single_Candle_Row_Parses_Correctly(t *testing.T) {
	// Arrange
	csvData := "symbol,timestamp,open,high,low,close,volume\nBTC,2024-01-01T00:00:00Z,40000.50,41000.75,39000.25,40500.00,1.5"
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader(), "header validation should pass")

	// Act
	candle, err := loader.NextCandle()

	// Assert
	assert.NoError(t, err, "parsing single candle should not error")
	assert.NotNil(t, candle, "candle should be returned")
	assert.Equal(t, "BTC", candle.Symbol, "symbol should match")
	assert.Equal(t, mustDecimal("40000.50"), candle.Open, "open price should match")
	assert.Equal(t, mustDecimal("41000.75"), candle.High, "high price should match")
	assert.Equal(t, mustDecimal("39000.25"), candle.Low, "low price should match")
	assert.Equal(t, mustDecimal("40500.00"), candle.Close, "close price should match")
	assert.Equal(t, mustDecimal("1.5"), candle.Volume, "volume should match")
}

func TestCSVLoader_Multiple_Candles_Parse_In_Order(t *testing.T) {
	// Arrange
	csvData := `symbol,timestamp,open,high,low,close,volume
BTC,2024-01-01T00:00:00Z,40000,41000,39000,40500,1.5
BTC,2024-01-02T00:00:00Z,40500,41500,40000,41000,2.0
BTC,2024-01-03T00:00:00Z,41000,41500,40500,40800,1.8`
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act & Assert
	candle1, err1 := loader.NextCandle()
	assert.NoError(t, err1)
	assert.Equal(t, mustDecimal("40000"), candle1.Open)
	assert.Equal(t, "2024-01-01T00:00:00Z", candle1.Timestamp.Format(time.RFC3339), "first candle timestamp should match")

	candle2, err2 := loader.NextCandle()
	assert.NoError(t, err2)
	assert.Equal(t, mustDecimal("40500"), candle2.Open)
	assert.Equal(t, "2024-01-02T00:00:00Z", candle2.Timestamp.Format(time.RFC3339), "second candle timestamp should match")

	candle3, err3 := loader.NextCandle()
	assert.NoError(t, err3)
	assert.Equal(t, mustDecimal("41000"), candle3.Open)
	assert.Equal(t, "2024-01-03T00:00:00Z", candle3.Timestamp.Format(time.RFC3339), "third candle timestamp should match")

	// Should return nil at EOF
	candle4, err4 := loader.NextCandle()
	assert.NoError(t, err4)
	assert.Nil(t, candle4, "should return nil after all rows read")
}

func TestCSVLoader_Malformed_Row_Invalid_Decimal_Returns_Error(t *testing.T) {
	// Arrange - Invalid decimal value in "open" column
	csvData := "symbol,timestamp,open,high,low,close,volume\nBTC,2024-01-01T00:00:00Z,not-a-number,41000,39000,40500,1.5"
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act
	candle, err := loader.NextCandle()

	// Assert
	assert.Error(t, err, "invalid decimal value should return error")
	assert.Nil(t, candle, "candle should be nil on error")
	assert.Contains(t, err.Error(), "row 2", "error should indicate row number")
}

func TestCSVLoader_Malformed_Row_Invalid_Timestamp_Returns_Error(t *testing.T) {
	// Arrange - Invalid timestamp format
	csvData := "symbol,timestamp,open,high,low,close,volume\nBTC,invalid-timestamp,40000,41000,39000,40500,1.5"
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act
	candle, err := loader.NextCandle()

	// Assert
	assert.Error(t, err, "invalid timestamp should return error")
	assert.Nil(t, candle, "candle should be nil on error")
}

func TestCSVLoader_Malformed_Row_Wrong_Column_Count_Returns_Error(t *testing.T) {
	// Arrange - Row with missing column
	csvData := "symbol,timestamp,open,high,low,close,volume\nBTC,2024-01-01T00:00:00Z,40000,41000,39000"
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act
	candle, err := loader.NextCandle()

	// Assert
	assert.Error(t, err, "row with wrong column count should return error")
	assert.Nil(t, candle, "candle should be nil on error")
}

// T013: CSV Data Validation (OHLCV Invariants)
func TestCSVLoader_Validation_High_Greater_Than_Equal_Low(t *testing.T) {
	// Arrange - Violates High >= Low
	csvData := "symbol,timestamp,open,high,low,close,volume\nBTC,2024-01-01T00:00:00Z,40000,39000,41000,40500,1.5"
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act
	candle, err := loader.NextCandle()

	// Assert
	assert.Error(t, err, "high < low should return validation error")
	assert.Nil(t, candle, "candle should be nil on validation error")
	assert.Contains(t, err.Error(), "validation", "error should mention validation failure")
}

func TestCSVLoader_Validation_High_Greater_Than_Equal_Close(t *testing.T) {
	// Arrange - Close > High
	csvData := "symbol,timestamp,open,high,low,close,volume\nBTC,2024-01-01T00:00:00Z,40000,40500,39000,41000,1.5"
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act
	candle, err := loader.NextCandle()

	// Assert
	assert.Error(t, err, "close > high should return validation error")
	assert.Nil(t, candle, "candle should be nil on validation error")
}

func TestCSVLoader_Validation_High_Greater_Than_Equal_Open(t *testing.T) {
	// Arrange - Open > High
	csvData := "symbol,timestamp,open,high,low,close,volume\nBTC,2024-01-01T00:00:00Z,42000,40500,39000,40000,1.5"
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act
	candle, err := loader.NextCandle()

	// Assert
	assert.Error(t, err, "open > high should return validation error")
	assert.Nil(t, candle, "candle should be nil on validation error")
}

func TestCSVLoader_Validation_Low_Less_Than_Equal_Close(t *testing.T) {
	// Arrange - Close < Low
	csvData := "symbol,timestamp,open,high,low,close,volume\nBTC,2024-01-01T00:00:00Z,39500,41000,39000,38500,1.5"
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act
	candle, err := loader.NextCandle()

	// Assert
	assert.Error(t, err, "close < low should return validation error")
	assert.Nil(t, candle, "candle should be nil on validation error")
}

func TestCSVLoader_Validation_All_Prices_Positive(t *testing.T) {
	// Arrange - Negative price
	csvData := "symbol,timestamp,open,high,low,close,volume\nBTC,2024-01-01T00:00:00Z,-40000,41000,39000,40500,1.5"
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act
	candle, err := loader.NextCandle()

	// Assert
	assert.Error(t, err, "negative price should return validation error")
	assert.Nil(t, candle, "candle should be nil on validation error")
	assert.Contains(t, err.Error(), "positive", "error should mention price must be positive")
}

func TestCSVLoader_Validation_Valid_OHLCV_Passes(t *testing.T) {
	// Arrange - Valid OHLCV invariants
	csvData := "symbol,timestamp,open,high,low,close,volume\nBTC,2024-01-01T00:00:00Z,40000,41000,39000,40500,1.5"
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act
	candle, err := loader.NextCandle()

	// Assert
	assert.NoError(t, err, "valid OHLCV should parse without error")
	assert.NotNil(t, candle, "candle should be returned")
	assert.True(t, candle.High.GreaterThanOrEqual(candle.Low), "high >= low")
	assert.True(t, candle.High.GreaterThanOrEqual(candle.Open), "high >= open")
	assert.True(t, candle.High.GreaterThanOrEqual(candle.Close), "high >= close")
	assert.True(t, candle.Close.GreaterThanOrEqual(candle.Low), "close >= low")
}

// T015: Empty and Edge-Case CSV Files
func TestCSVLoader_Empty_CSV_Header_Only_Returns_Nil_On_First_Next(t *testing.T) {
	// Arrange - Only header, no data rows
	csvData := "symbol,timestamp,open,high,low,close,volume\n"
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act
	candle, err := loader.NextCandle()

	// Assert
	assert.NoError(t, err, "reading empty CSV should not error")
	assert.Nil(t, candle, "should return nil for empty CSV")
}

func TestCSVLoader_Single_Row_CSV_Parses_Correctly(t *testing.T) {
	// Arrange - Only one data row
	csvData := "symbol,timestamp,open,high,low,close,volume\nBTC,2024-01-01T00:00:00Z,40000,41000,39000,40500,1.5"
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act
	candle, err := loader.NextCandle()

	// Assert
	assert.NoError(t, err)
	assert.NotNil(t, candle)
	assert.Equal(t, "BTC", candle.Symbol)

	// Next call should return nil
	secondCandle, err := loader.NextCandle()
	assert.NoError(t, err)
	assert.Nil(t, secondCandle)
}

func TestCSVLoader_Very_Large_Decimal_Values_Parse_Correctly(t *testing.T) {
	// Arrange - Very large decimal values
	csvData := "symbol,timestamp,open,high,low,close,volume\nBTC,2024-01-01T00:00:00Z,999999999.99,1000000000.99,999999998.99,999999999.50,1000000.5"
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act
	candle, err := loader.NextCandle()

	// Assert
	assert.NoError(t, err)
	assert.NotNil(t, candle)
	assert.Equal(t, mustDecimal("999999999.99"), candle.Open)
	assert.Equal(t, mustDecimal("1000000000.99"), candle.High)
}

func TestCSVLoader_Very_Small_Decimal_Values_Parse_Correctly(t *testing.T) {
	// Arrange - Very small decimal values
	csvData := "symbol,timestamp,open,high,low,close,volume\nBTC,2024-01-01T00:00:00Z,0.00001,0.00002,0.000005,0.000015,0.1"
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act
	candle, err := loader.NextCandle()

	// Assert
	assert.NoError(t, err)
	assert.NotNil(t, candle)
	assert.Equal(t, mustDecimal("0.00001"), candle.Open)
	assert.Equal(t, mustDecimal("0.00002"), candle.High)
}

func TestCSVLoader_Whitespace_Handling_Trims_Values(t *testing.T) {
	// Arrange - Values with leading/trailing whitespace
	csvData := "symbol,timestamp,open,high,low,close,volume\n BTC , 2024-01-01T00:00:00Z , 40000 , 41000 , 39000 , 40500 , 1.5 "
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act
	candle, err := loader.NextCandle()

	// Assert
	assert.NoError(t, err)
	assert.NotNil(t, candle)
	assert.Equal(t, "BTC", candle.Symbol, "whitespace should be trimmed from symbol")
	assert.Equal(t, mustDecimal("40000"), candle.Open, "whitespace should be trimmed from numeric values")
}

func TestCSVLoader_Different_Symbols_Parse_Correctly(t *testing.T) {
	// Arrange - Multiple symbols in CSV
	csvData := `symbol,timestamp,open,high,low,close,volume
BTC,2024-01-01T00:00:00Z,40000,41000,39000,40500,1.5
ETH,2024-01-01T00:00:00Z,2000,2100,1900,2050,10.0
SOL,2024-01-01T00:00:00Z,100,110,90,105,100.0`
	reader := strings.NewReader(csvData)
	loader := NewCSVLoader(reader)
	require.NoError(t, loader.ValidateHeader())

	// Act & Assert
	candle1, _ := loader.NextCandle()
	assert.Equal(t, "BTC", candle1.Symbol)

	candle2, _ := loader.NextCandle()
	assert.Equal(t, "ETH", candle2.Symbol)

	candle3, _ := loader.NextCandle()
	assert.Equal(t, "SOL", candle3.Symbol)
}

// Helper function to convert string to Decimal, panicking on error
// (safe for tests where invalid input is a test failure)
func mustDecimal(s string) decimal.Decimal {
	d, err := decimal.NewFromString(s)
	if err != nil {
		panic(err)
	}
	return d
}
