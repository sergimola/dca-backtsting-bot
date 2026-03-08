# Quickstart: Backtest Orchestrator

**Platform**: Go 1.21+  
**Package**: `core-engine/application/orchestrator`  
**Performance**: 730,000+ candles/sec, 250K candles in ~3.4 seconds

## 5-Minute Setup

### 1. Import the Orchestrator

```go
import (
    "os"
    "dca-bot/core-engine/application/orchestrator"
    "dca-bot/core-engine/domain/position"
    "github.com/shopspring/decimal"
)
```

### 2. Create Position State Machine

```go
// Create the Position State Machine that will process each candle
psm := position.NewStateMachine()
```

### 3. Configure Orchestrator

```go
cfg := &orchestrator.OrchestratorConfig{
    DataSourcePath:       "backtest_data.csv",  // Your OHLCV CSV file
    EstimatedCandleCount: 250000,               // Optional: enables pre-allocation for performance
    BacktestID:           "backtest_2026_03_08",
}
```

### 4. Create and Run Orchestrator

```go
// Create the orchestrator
orch, err := orchestrator.NewOrchestrator(psm, cfg)
if err != nil {
    log.Fatal("Failed to create orchestrator:", err)
}

// Open CSV file
file, err := os.Open(cfg.DataSourcePath)
if err != nil {
    log.Fatal("Failed to open CSV:", err)
}
defer file.Close()

// Run the backtest
run, err := orch.RunBacktest(file)
if err != nil {
    log.Fatal("Backtest failed:", err)
}

// Results
log.Printf("Backtest Results:\n")
log.Printf("  ID: %s\n", run.ID)
log.Printf("  Candles: %d\n", run.CandleCount)
log.Printf("  Events: %d\n", run.EventCount)
log.Printf("  Duration: %v\n", run.EndTime.Sub(run.StartTime))
```

### 5. Analyze Events

```go
// Get all events in chronological order
events := run.EventBus.GetAllEvents()

// Iterate through events
for i, event := range events {
    log.Printf("[%d] %s @ %s\n", 
        i, event.Type, event.Timestamp.Format(time.RFC3339))
}

// Filter events by type
buyEvents := run.EventBus.GetEventsByType(orchestrator.EventTypeBuyOrderExecuted)
log.Printf("Buy orders executed: %d\n", len(buyEvents))

// Query events within a time range
timeStart := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
timeEnd := time.Date(2024, 1, 31, 23, 59, 59, 0, time.UTC)
janEvents := run.EventBus.GetEventsByTimeRange(timeStart, timeEnd)
log.Printf("Events in January 2024: %d\n", len(janEvents))
```

## Input CSV Format

Your CSV file must have these columns (header row required):

```
symbol,timestamp,open,high,low,close,volume
BTCUSDT,2024-01-01T00:00:00Z,42000.50,42500.00,41800.00,42200.00,1500.50
BTCUSDT,2024-01-01T01:00:00Z,42200.00,42800.00,42100.00,42700.00,2000.25
...
```

**Column Details**:
- `symbol`: Trading pair (e.g., "BTCUSDT")
- `timestamp`: UTC time in ISO 8601 format (e.g., "2024-01-01T00:00:00Z")
- `open`, `high`, `low`, `close`: Prices as decimal strings (not floats)
- `volume`: Trading volume as decimal string

## Output: Event Log

After `RunBacktest()`, the Event Bus contains all captured trading events in chronological order:

### Example Events

**PositionOpened Event**:
```
Timestamp: 2024-01-01T12:30:00Z
Type: PositionOpened
Data: {
  EntryPrice: 42150.00,
  InitialQuantity: 0.002,
  MarginUsed: 100.50,
}
```

**BuyOrderExecuted Event**:
```
Timestamp: 2024-01-05T14:15:00Z
Type: BuyOrderExecuted
Data: {
  Price: 41950.00,
  Quantity: 0.001,
  TotalCost: 41.95,
  Reason: "DCA Buy at Price Level 2",
}
```

**TakeProfitHit Event**:
```
Timestamp: 2024-02-01T10:45:00Z
Type: TakeProfitHit
Data: {
  ExitPrice: 44357.60,
  ExitQuantity: 0.002,
  GainBTC: 0.002,
  GainUSDT: 88.71,
  ROI: 0.0885,
}
```

**Liquidation Event**:
```
Timestamp: 2024-01-20T09:30:00Z
Type: Liquidation
Data: {
  LiquidationPrice: 40701.50,
  LiquidatedQuantity: 0.002,
  LiquidationCost: 81.40,
  LossUSDT: 18.60,
  ROI: -0.1850,
}
```

## Architecture Overview

```
CSV File (Data Adapter)
       ↓ [high-perf streaming]
   CSVLoader (Orchestrator Internal)
       ↓ [Iterator Pattern]
   Candle
       ↓ [feed to PSM]
   PSM.ProcessCandle(candle)
       ↓ [emit events]
   []Event
       ↓ [capture fidelity]
   EventBus (in-memory log)
```

### Key Design Principles

1. **One-Way Dependency**: Orchestrator depends on PSM; PSM knows nothing about Orchestrator
2. **Pure Bridge**: Orchestrator performs no calculations; it is a data orchestrator only
3. **Streaming Performance**: CSV data is streamed (not buffered) to achieve <10s target for 250K candles
4. **Deterministic Execution**: Same CSV + Config = identical event sequence, every time
5. **Decimal Precision**: All prices and quantities preserved as Decimal from PSM; no float conversions

## Error Handling

```go
run, err := orch.RunBacktest(ctx)
if err != nil {
    // Possible errors:
    // - ErrMalformedCSV: CSV parsing failed (missing columns, invalid number format)
    // - ErrInvalidCandle: Candle validation failed (High < Low, etc.)
    // - ErrPSMProcessing: PSM returned an error during ProcessCandle()
    // - context.DeadlineExceeded: Context timeout during backtest
    
    log.Printf("Backtest failed: %v\n", err)
    
    // Events captured up to the error are still available
    events := orch.GetEventBus().GetAllEvents()
    log.Printf("Partial results: %d events captured before failure\n", len(events))
}
```

## Testing

### Unit Test Example

```go
func TestRunBacktest_SingleCandle(t *testing.T) {
    // Setup
    config := position.Config{ /* ... */ }
    
    orch, _ := orchestrator.New(context.Background(), orchestrator.OrchestratorConfig{
        PSMConfig:      config,
        DataSourcePath: "testdata/single_candle.csv",
        BacktestID:     "test_single_candle",
    })
    
    // Act
    run, err := orch.RunBacktest(context.Background())
    
    // Assert
    assert.NoError(t, err)
    assert.Equal(t, 1, run.CandleCount)
    assert.Greater(t, run.EventCount, 0)
    
    events := orch.GetEventBus().GetAllEvents()
    assert.Equal(t, run.EventCount, len(events))
    
    // Verify events are chronological
    for i := 1; i < len(events); i++ {
        assert.True(t, events[i-1].Timestamp.Before(events[i].Timestamp) ||
                       events[i-1].Timestamp.Equal(events[i].Timestamp))
    }
}
```

### Benchmark Example

```go
func BenchmarkRunBacktest_250KCandles(b *testing.B) {
    config := position.Config{ /* ... */ }
    orch, _ := orchestrator.New(context.Background(), orchestrator.OrchestratorConfig{
        PSMConfig:             config,
        DataSourcePath:        "testdata/250k_candles.csv",
        EstimatedCandleCount:  250000,
    })
    
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _, err := orch.RunBacktest(context.Background())
        assert.NoError(b, err)
    }
    
    // Target: <10 seconds for full backtest
    // Expected per-candle: <40µs (10s ÷ 250k)
}
```

## Performance Targets

- **CSV Parsing**: ~100µs per row (buffered reader, pre-allocated buffers)
- **Per-Candle Processing**: <40µs (includes PSM call + event capture)
- **Total Runtime**: <10 seconds for 250,000 candles
- **Memory**: Event count × ~100 bytes/event = ~25 MB for typical backtests

## Next Steps

1. Implement CSV loader with high-performance buffering
2. Define Event types matching PSM output
3. Build EventBus with optional indexing for range queries
4. Write acceptance tests for all 3 user stories (P1, P2, P3)
5. Profile and optimize hot path (candle loop)
