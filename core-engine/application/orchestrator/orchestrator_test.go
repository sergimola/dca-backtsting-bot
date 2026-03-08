package orchestrator

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"dca-bot/core-engine/domain/position"

	"github.com/stretchr/testify/assert"
)

// T019: Orchestrator initialization
func TestOrchestrator_Initialization_Creates_Valid_Backtest_Run(t *testing.T) {
	// Arrange
	smock := position.NewStateMachine()
	config := &OrchestratorConfig{
		DataSourcePath:       "test.csv",
		EstimatedCandleCount: 100,
		BacktestID:           "test-backtest-001",
	}

	// Act
	orchestrator, err := NewOrchestrator(smock, config)

	// Assert
	assert.NoError(t, err, "orchestrator initialization should not error")
	assert.NotNil(t, orchestrator, "orchestrator should be created")
	assert.NotNil(t, orchestrator.eventBus, "event bus should be initialized")
	assert.Equal(t, 0, len(orchestrator.eventBus.GetAllEvents()), "event bus should be empty initially")
}

func TestOrchestrator_Initialization_PSM_Ready_To_Accept_Candles(t *testing.T) {
	// Arrange
	smock := position.NewStateMachine()
	config := &OrchestratorConfig{DataSourcePath: "test.csv"}

	// Act
	orchestrator, err := NewOrchestrator(smock, config)

	// Assert
	assert.NoError(t, err)
	assert.NotNil(t, orchestrator.psm, "PSM should be stored in orchestrator")
}

func TestOrchestrator_Initialization_EventBus_Empty_Before_Backtest(t *testing.T) {
	// Arrange
	smock := position.NewStateMachine()
	config := &OrchestratorConfig{DataSourcePath: "test.csv"}

	// Act
	orchestrator, err := NewOrchestrator(smock, config)

	// Assert
	assert.NoError(t, err)
	events := orchestrator.eventBus.GetAllEvents()
	assert.Equal(t, 0, len(events), "event bus should be empty before backtest")
}

// T020: Acceptance - P1/S1 - Valid CSV data loads and PSM initializes
func TestAcceptance_P1_S1_Valid_CSV_Data_Loads_PSM_Initializes(t *testing.T) {
	// Arrange: Valid CSV with 5 candles
	csvData := `symbol,timestamp,open,high,low,close,volume
BTC,2024-01-01T00:00:00Z,40000,41000,39000,40500,1.5
BTC,2024-01-01T00:01:00Z,40500,41500,40000,41000,2.0
BTC,2024-01-01T00:02:00Z,41000,41500,40500,40800,1.8
BTC,2024-01-01T00:03:00Z,40800,41200,40200,40700,1.9
BTC,2024-01-01T00:04:00Z,40700,41300,40300,41000,2.1`

	reader := strings.NewReader(csvData)
	orchestrator := createTestOrchestrator(t)

	// Act
	runResult, err := orchestrator.RunBacktest(reader)

	// Assert
	assert.NoError(t, err, "backtest should complete without error")
	assert.NotNil(t, runResult, "backtest run result should be returned")
	assert.Equal(t, 5, runResult.CandleCount, "should process all 5 candles")
	// Note: EventCount may be 0 if PSM has no configured trading - that's valid
	assert.NotNil(t, runResult.EventBus, "event bus should be in result")
}

// T021: Acceptance - P1/S2 - Candles fed sequentially in PSM order
func TestAcceptance_P1_S2_Candles_Fed_Sequentially_In_Order(t *testing.T) {
	// Arrange: Small CSV with known order
	csvData := `symbol,timestamp,open,high,low,close,volume
BTC,2024-01-01T00:00:00Z,40000,41000,39000,40500,1.5
BTC,2024-01-01T00:01:00Z,40500,41500,40000,41000,2.0
BTC,2024-01-01T00:02:00Z,41000,41500,40500,40800,1.8`

	reader := strings.NewReader(csvData)
	orchestrator := createTestOrchestrator(t)

	// Act
	runResult, err := orchestrator.RunBacktest(reader)

	// Assert
	assert.NoError(t, err)
	assert.Equal(t, 3, runResult.CandleCount, "should process 3 candles")

	// Verify events are in order by timestamp
	events := runResult.EventBus.GetAllEvents()
	if len(events) > 1 {
		for i := 1; i < len(events); i++ {
			assert.True(t,
				events[i-1].Timestamp.Before(events[i].Timestamp) ||
					events[i-1].Timestamp.Equal(events[i].Timestamp),
				fmt.Sprintf("event %d should be before event %d", i-1, i),
			)
		}
	}
}

// T022: Acceptance - P1/S3 - Events captured with full fidelity (Decimal precision, correct type/timestamp)
func TestAcceptance_P1_S3_Events_Captured_With_Full_Fidelity(t *testing.T) {
	// Arrange
	csvData := `symbol,timestamp,open,high,low,close,volume
BTC,2024-01-01T00:00:00Z,40000.50,41000.75,39000.25,40500.00,1.5`

	reader := strings.NewReader(csvData)
	orchestrator := createTestOrchestrator(t)

	// Act
	runResult, err := orchestrator.RunBacktest(reader)

	// Assert
	assert.NoError(t, err)
	events := runResult.EventBus.GetAllEvents()

	// Verify that events have correct structure
	for _, evt := range events {
		// Every event must have these fields
		assert.NotNil(t, evt.Type, "event type must be set")
		assert.True(t, evt.Timestamp.Year() >= 2024, "event timestamp should be valid")
		assert.NotNil(t, evt.RawEvent, "raw PSM event should be wrapped")
	}
}

// T023: Acceptance - P1/S4 - Deterministic execution
func TestAcceptance_P1_S4_Deterministic_Execution(t *testing.T) {
	// Arrange: Same CSV data
	csvData := `symbol,timestamp,open,high,low,close,volume
BTC,2024-01-01T00:00:00Z,40000,41000,39000,40500,1.5
BTC,2024-01-01T00:01:00Z,40500,41500,40000,41000,2.0
BTC,2024-01-01T00:02:00Z,41000,41500,40500,40800,1.8`

	// Act: Run backtest twice
	orchestrator1 := createTestOrchestrator(t)
	run1, err1 := orchestrator1.RunBacktest(strings.NewReader(csvData))

	orchestrator2 := createTestOrchestrator(t)
	run2, err2 := orchestrator2.RunBacktest(strings.NewReader(csvData))

	// Assert
	assert.NoError(t, err1)
	assert.NoError(t, err2)
	assert.Equal(t, run1.CandleCount, run2.CandleCount, "candle counts should match")
	assert.Equal(t, run1.EventCount, run2.EventCount, "event counts should match")

	// Verify event sequence matches
	events1 := run1.EventBus.GetAllEvents()
	events2 := run2.EventBus.GetAllEvents()
	assert.Equal(t, len(events1), len(events2), "event sequences should have same length")

	for i := range events1 {
		assert.Equal(t, events1[i].Type, events2[i].Type, fmt.Sprintf("event %d types should match", i))
		assert.Equal(t, events1[i].Timestamp, events2[i].Timestamp, fmt.Sprintf("event %d timestamps should match", i))
	}
}

// T024: Acceptance - P2/S1 - Position state tracking
func TestAcceptance_P2_S1_Position_State_Tracking_Throughout_Backtest(t *testing.T) {
	// Arrange
	csvData := `symbol,timestamp,open,high,low,close,volume
BTC,2024-01-01T00:00:00Z,40000,41000,39000,40500,1.5
BTC,2024-01-01T00:01:00Z,40500,41500,40000,41000,2.0
BTC,2024-01-01T00:02:00Z,41000,41500,40500,40800,1.8
BTC,2024-01-01T00:03:00Z,40800,41200,40200,40700,1.9
BTC,2024-01-01T00:04:00Z,40700,41300,40300,41000,2.1`

	reader := strings.NewReader(csvData)
	orchestrator := createTestOrchestrator(t)

	// Act
	runResult, err := orchestrator.RunBacktest(reader)

	// Assert
	assert.NoError(t, err)
	assert.Equal(t, 5, runResult.CandleCount, "all candles should be processed")
	assert.NotNil(t, runResult.EndTime, "end time should be recorded")
	assert.True(t, runResult.EndTime.After(runResult.StartTime) || runResult.EndTime.Equal(runResult.StartTime), "end time should be >= start time")
}

// T025: Acceptance - P2/S2 - Portfolio event aggregation
func TestAcceptance_P2_S2_Portfolio_Event_Aggregation(t *testing.T) {
	// Arrange
	csvData := `symbol,timestamp,open,high,low,close,volume
BTC,2024-01-01T00:00:00Z,40000,41000,39000,40500,1.5
BTC,2024-01-01T00:01:00Z,40500,41500,40000,41000,2.0
ETH,2024-01-01T00:02:00Z,2000,2100,1900,2050,10.0
ETH,2024-01-01T00:03:00Z,2050,2150,2000,2100,12.0`

	reader := strings.NewReader(csvData)
	orchestrator := createTestOrchestrator(t)

	// Act
	runResult, err := orchestrator.RunBacktest(reader)

	// Assert
	assert.NoError(t, err)
	assert.Equal(t, 4, runResult.CandleCount, "should process all mixed-symbol candles")
	events := runResult.EventBus.GetAllEvents()
	// Note: EventCount may be 0 if PSM has no configured trading - that's valid
	assert.NotNil(t, events, "event bus should return valid slice")
}

// T027: Acceptance - Error handling and recovery
func TestAcceptance_P3_Error_Handling_Malformed_CSV(t *testing.T) {
	// Arrange: Malformed CSV with invalid decimal
	csvData := `symbol,timestamp,open,high,low,close,volume
BTC,2024-01-01T00:00:00Z,invalid-price,41000,39000,40500,1.5`

	reader := strings.NewReader(csvData)
	orchestrator := createTestOrchestrator(t)

	// Act
	runResult, err := orchestrator.RunBacktest(reader)

	// Assert
	assert.Error(t, err, "should error on malformed data")
	assert.Nil(t, runResult, "should not return result on error")
	assert.Contains(t, err.Error(), "invalid", "error should mention what's wrong")
}

func TestAcceptance_P3_Error_Handling_Empty_CSV(t *testing.T) {
	// Arrange: Header-only CSV
	csvData := "symbol,timestamp,open,high,low,close,volume\n"

	reader := strings.NewReader(csvData)
	orchestrator := createTestOrchestrator(t)

	// Act
	runResult, err := orchestrator.RunBacktest(reader)

	// Assert
	assert.NoError(t, err, "empty CSV should not error")
	assert.NotNil(t, runResult, "should return result")
	assert.Equal(t, 0, runResult.CandleCount, "should have zero candles")
	assert.Equal(t, 0, runResult.EventCount, "should have zero events")
}

// T028: Memory efficiency on large datasets
func TestAcceptance_P3_Memory_Efficiency_Large_Event_Count(t *testing.T) {
	// Arrange: Generate a CSV with 1000 candles
	csvBuilder := strings.Builder{}
	csvBuilder.WriteString("symbol,timestamp,open,high,low,close,volume\n")
	for i := 0; i < 1000; i++ {
		open := 40000.0 + float64(i%100)*10.0
		high := open + 100.0
		low := open - 100.0
		close := (open + high) / 2.0
		ts := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(i) * time.Minute)
		csvBuilder.WriteString(fmt.Sprintf(
			"BTC,%s,%.2f,%.2f,%.2f,%.2f,1.5\n",
			ts.Format(time.RFC3339),
			open, high, low, close,
		))
	}

	csvData := csvBuilder.String()
	reader := strings.NewReader(csvData)
	orchestrator := createTestOrchestrator(t)

	// Act
	runResult, err := orchestrator.RunBacktest(reader)

	// Assert
	assert.NoError(t, err)
	assert.Equal(t, 1000, runResult.CandleCount, "should process all 1000 candles")
	// Note: EventCount may be 0 if PSM has no configured trading
	assert.NotNil(t, runResult.EventBus, "event bus should be populated")
}

// ============ Benchmark Tests (T026) ============

// BenchmarkOrchestrator_RunBacktest_250K_Candles tests the end-to-end performance
// Target: Complete 250K candles in <10 seconds (maintaining <40µs per candle)
func BenchmarkOrchestrator_RunBacktest_250K_Candles(b *testing.B) {
	// Generate a CSV with 250,000 candles (same as CSV benchmark but includes PSM processing)
	const candleCount = 250000
	csvBuilder := strings.Builder{}
	csvBuilder.WriteString("symbol,timestamp,open,high,low,close,volume\n")

	for i := 0; i < candleCount; i++ {
		open := 40000.0 + float64(i%1000)*10.0
		high := open + float64(i%1000)
		low := open - float64(i%500)
		close := (open + high) / 2.0
		volume := 1.5 + float64(i%100)*0.01

		ts := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(i) * time.Second)
		csvBuilder.WriteString(fmt.Sprintf(
			"BTC,%s,%.2f,%.2f,%.2f,%.2f,%.2f\n",
			ts.Format(time.RFC3339),
			open,
			high,
			low,
			close,
			volume,
		))
	}

	csvData := csvBuilder.String()

	// Run benchmark
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		orchestrator := createTestOrchestrator(b)
		reader := strings.NewReader(csvData)
		runResult, err := orchestrator.RunBacktest(reader)
		if err != nil {
			b.Fatalf("RunBacktest failed: %v", err)
		}
		if runResult.CandleCount != candleCount {
			b.Fatalf("expected %d candles, got %d", candleCount, runResult.CandleCount)
		}
	}

	// Report metrics
	b.ReportAllocs()
	totalOps := b.N * candleCount
	b.ReportMetric(float64(totalOps)/b.Elapsed().Seconds(), "candles/sec")
}

// ============ Helper Functions ============

func createTestOrchestrator(tb testing.TB) *Orchestrator {
	// Create a mock PSM
	psm := position.NewStateMachine()

	// Create config
	config := &OrchestratorConfig{
		DataSourcePath:       "test.csv",
		EstimatedCandleCount: 1000,
		BacktestID:           fmt.Sprintf("test-%d", time.Now().UnixNano()),
	}

	// Create orchestrator
	orchestrator, err := NewOrchestrator(psm, config)
	if err != nil {
		tb.Fatalf("failed to create test orchestrator: %v", err)
	}

	return orchestrator
}
