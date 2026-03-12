package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"dca-bot/core-engine/application/orchestrator"
	"dca-bot/core-engine/domain/config"
	"dca-bot/core-engine/domain/position"

	"github.com/shopspring/decimal"
)

// BacktestRequest matches the Node.js API input schema
type BacktestRequest struct {
	EntryPrice           string   `json:"entry_price"`           // Decimal string (e.g., "100.50")
	Amounts              []string `json:"amounts"`               // Array of decimal strings
	Sequences            []int    `json:"sequences"`             // Array of safety order indices
	Leverage             string   `json:"leverage"`              // Decimal string (e.g., "2.00")
	MarginRatio          string   `json:"margin_ratio"`          // Decimal string (e.g., "0.50")
	MarketDataCSVPath    string   `json:"market_data_csv_path"`  // Path to CSV file
	IdempotencyKey       string   `json:"idempotency_key"`       // Optional UUID
}

// BacktestOutput matches the Node.js API output schema
type BacktestOutput struct {
	Events           []map[string]interface{} `json:"events"`            // Array of events
	ExecutionTimeMs  int64                    `json:"execution_time_ms"` // Milliseconds
	CandleCount      int                      `json:"candle_count"`
	EventCount       int                      `json:"event_count"`
	FinalPosition    interface{}              `json:"final_position"` // Position state at end
}

func main() {
	// Recover from panics and log to stderr
	defer func() {
		if r := recover(); r != nil {
			fmt.Fprintf(os.Stderr, "Fatal panic: %v\n", r)
			os.Exit(1)
		}
	}()

	// Read JSON request from stdin
	var request BacktestRequest
	decoder := json.NewDecoder(os.Stdin)
	if err := decoder.Decode(&request); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse JSON input: %v\n", err)
		os.Exit(1)
	}

	// Validate required fields
	if request.EntryPrice == "" || request.MarketDataCSVPath == "" {
		fmt.Fprintf(os.Stderr, "Missing required fields: entry_price and market_data_csv_path are required\n")
		os.Exit(1)
	}

	// Build Config from BacktestRequest
	cfg, err := buildConfigFromRequest(&request)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to build config: %v\n", err)
		os.Exit(1)
	}

	// Create Position State Machine
	psm := position.NewStateMachine()

	// Create orchestrator config
	orchConfig := &orchestrator.OrchestratorConfig{
		DataSourcePath:       request.MarketDataCSVPath,
		EstimatedCandleCount: 10000, // Reasonable estimate for backtest
		BacktestID:           request.IdempotencyKey,
	}

	// Create orchestrator
	orch, err := orchestrator.NewOrchestrator(psm, orchConfig)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create orchestrator: %v\n", err)
		os.Exit(1)
	}

	// Open CSV file for backtest
	csvFile, err := os.Open(request.MarketDataCSVPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to open CSV file: %v\n", err)
		os.Exit(1)
	}
	defer csvFile.Close()

	// Run backtest
	backtest, err := orch.RunBacktest(csvFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Backtest execution failed: %v\n", err)
		os.Exit(1)
	}

	// Convert results to output format
	output := convertBacktestToOutput(backtest, cfg)

	// Marshal and write to stdout
	outputJSON, err := json.Marshal(output)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to marshal output JSON: %v\n", err)
		os.Exit(1)
	}

	// Write to stdout
	if _, err := io.WriteString(os.Stdout, string(outputJSON)+"\n"); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to write output: %v\n", err)
		os.Exit(1)
	}
}

// buildConfigFromRequest creates a domain config from the BacktestRequest
// Uses the incoming parameters and sensible defaults for fields not in the API request
func buildConfigFromRequest(req *BacktestRequest) (*config.Config, error) {
	// Parse decimal values
	entryPrice, err := decimal.NewFromString(req.EntryPrice)
	if err != nil {
		return nil, fmt.Errorf("invalid entry_price: %w", err)
	}

	leverage, err := decimal.NewFromString(req.Leverage)
	if err != nil {
		return nil, fmt.Errorf("invalid leverage: %w", err)
	}

	// Calculate amountPerTrade from first amount if available
	var amountPerTrade decimal.Decimal
	if len(req.Amounts) > 0 {
		amountPerTrade, err = decimal.NewFromString(req.Amounts[0])
		if err != nil {
			return nil, fmt.Errorf("invalid amounts[0]: %w", err)
		}
	} else {
		amountPerTrade = config.DefaultAmountPerTrade
	}

	// Build config with provided values and defaults
	cfg, err := config.NewConfig(
		config.WithPriceEntry(entryPrice),
		config.WithAmountPerTrade(amountPerTrade),
		config.WithMultiplier(leverage),
		config.WithNumberOfOrders(len(req.Sequences)),
		// Use defaults for fields not in API request:
		// - TradingPair: DefaultTradingPair
		// - StartDate/EndDate: Defaults (will be overridden by CSV headers in practice)
		// - PriceScale, AmountScale: Defaults
		// - MarginType: Cross margin (default)
		// - TakeProfitDistancePercent: Default
		// - AccountBalance: Default
		// - MonthlyAddition: Default
		// - ExitOnLastOrder: Default
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create config: %w", err)
	}

	return cfg, nil
}

// convertBacktestToOutput transforms orchestrator results into API output format
func convertBacktestToOutput(backtest *orchestrator.BacktestRun, cfg *config.Config) *BacktestOutput {
	// Convert orchestrator events to output format
	events := make([]map[string]interface{}, 0, backtest.EventCount)
	
	if backtest.EventBus != nil {
		// Get all events from the event bus
		allEvents := backtest.EventBus.GetAllEvents()
		for _, event := range allEvents {
			// Convert event to JSON-serializable map
			eventMap := map[string]interface{}{
				"timestamp": event.Timestamp.Format("2006-01-02T15:04:05.000Z"),
				"type":      string(event.Type),
				"data":      event.Data, // Raw PSM event data
			}
			events = append(events, eventMap)
		}
	}

	// Calculate execution time in milliseconds
	executionTimeMs := backtest.EndTime.Sub(backtest.StartTime).Milliseconds()

	return &BacktestOutput{
		Events:          events,
		ExecutionTimeMs: executionTimeMs,
		CandleCount:     backtest.CandleCount,
		EventCount:      backtest.EventCount,
		FinalPosition: map[string]interface{}{
			"trading_pair":       cfg.TradingPair(),
			"entry_price":        cfg.PriceEntry().String(),
			"leverage":           cfg.Multiplier().String(),
			"margin_type":        cfg.MarginType(),
			"number_of_orders":   cfg.NumberOfOrders(),
			"amount_per_trade":   cfg.AmountPerTrade().String(),
			"account_balance":    cfg.AccountBalance().String(),
		},
	}
}
