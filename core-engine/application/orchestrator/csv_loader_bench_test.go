package orchestrator

import (
	"fmt"
	"strings"
	"testing"
)

// T014: Benchmark CSV Loading Performance
// Target: Load 250,000 candles in under 5 seconds (>50,000 candles/sec, ~20µs per candle)

func BenchmarkLoadCandles(b *testing.B) {
	// Generate a CSV with 250,000 candles
	const candleCount = 250000
	csvBuilder := strings.Builder{}
	csvBuilder.WriteString("symbol,timestamp,open,high,low,close,volume\n")

	for i := 0; i < candleCount; i++ {
		// Simulate realistic OHLCV data
		open := 40000.0 + float64(i%1000)*10.0
		high := open + float64(i%1000)
		low := open - float64(i%500)
		close := (open + high) / 2.0
		volume := 1.5 + float64(i%100)*0.01

		csvBuilder.WriteString(fmt.Sprintf(
			"BTC,2024-01-01T%02d:%02d:%02dZ,%.2f,%.2f,%.2f,%.2f,%.2f\n",
			(i / 3600) % 24,
			(i / 60) % 60,
			i % 60,
			open,
			high,
			low,
			close,
			volume,
		))
	}

	csvData := csvBuilder.String()

	// Run benchmark: measure time to load all 250K candles
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		reader := strings.NewReader(csvData)
		loader := NewCSVLoader(reader)
		err := loader.ValidateHeader()
		if err != nil {
			b.Fatalf("header validation failed: %v", err)
		}

		candleCounter := 0
		for {
			candle, err := loader.NextCandle()
			if err != nil {
				b.Fatalf("parsing candle failed: %v", err)
			}
			if candle == nil {
				break
			}
			candleCounter++
		}

		if candleCounter != candleCount {
			b.Fatalf("expected %d candles, got %d", candleCount, candleCounter)
		}
	}

	// Report metrics
	b.ReportAllocs()
	totalOps := b.N * candleCount
	b.ReportMetric(float64(totalOps)/b.Elapsed().Seconds(), "candles/sec")
}

// Additional benchmark for just NextCandle performance
func BenchmarkNextCandle(b *testing.B) {
	// Create a small CSV repeated many times
	baseCsv := `symbol,timestamp,open,high,low,close,volume
BTC,2024-01-01T00:00:00Z,40000,41000,39000,40500,1.5
BTC,2024-01-02T00:00:00Z,40500,41500,40000,41000,2.0
BTC,2024-01-03T00:00:00Z,41000,41500,40500,40800,1.8
BTC,2024-01-04T00:00:00Z,40800,41200,40200,40700,1.9
BTC,2024-01-05T00:00:00Z,40700,41300,40300,41000,2.1
`

	reader := strings.NewReader(baseCsv)
	loader := NewCSVLoader(reader)
	err := loader.ValidateHeader()
	if err != nil {
		b.Fatalf("header validation failed: %v", err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := loader.NextCandle()
		if err != nil {
			b.Fatalf("NextCandle failed: %v", err)
		}
	}
}

// Benchmark header validation
func BenchmarkValidateHeader(b *testing.B) {
	csvData := "symbol,timestamp,open,high,low,close,volume\nBTC,2024-01-01T00:00:00Z,40000,41000,39000,40500,1.5"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		reader := strings.NewReader(csvData)
		loader := NewCSVLoader(reader)
		err := loader.ValidateHeader()
		if err != nil {
			b.Fatalf("header validation failed: %v", err)
		}
	}
}
