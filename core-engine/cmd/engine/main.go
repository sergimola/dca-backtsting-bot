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

// EngineRequest matches the new API input schema with all 13 SDD §4.1 parameters
type EngineRequest struct {
	TradingPair                   string `json:"trading_pair"`                    // e.g., "BTC/USDT"
	StartDate                     string `json:"start_date"`                      // RFC 3339 format: YYYY-MM-DDTHH:MM:SSZ
	EndDate                       string `json:"end_date"`                        // RFC 3339 format: YYYY-MM-DDTHH:MM:SSZ
	PriceEntry                    string `json:"price_entry"`                     // Decimal string > 0
	PriceScale                    string `json:"price_scale"`                     // Decimal string > 0 (SDD §2.1 recurrence base, e.g., "1.1")
	AmountScale                   string `json:"amount_scale"`                    // Decimal string > 0 (SDD §2.2 recurrence base, e.g., "2.0")
	NumberOfOrders                int    `json:"number_of_orders"`                // Integer >= 1 (number of safety orders)
	AmountPerTrade                string `json:"amount_per_trade"`                // Decimal string in (0, 1] (fraction of equity)
	MarginType                    string `json:"margin_type"`                     // "cross" or "isolated"
	Multiplier                    int    `json:"multiplier"`                      // Integer >= 1 (leverage, 1=spot)
	TakeProfitDistancePercent     string `json:"take_profit_distance_percent"`    // Decimal string > 0
	AccountBalance                string `json:"account_balance"`                 // Decimal string > 0 (total capital in USDT)
	ExitOnLastOrder               bool   `json:"exit_on_last_order"`              // Boolean: end simulation when last order fills
	MarketDataCSVPath             string `json:"market_data_csv_path"`             // Path to CSV file (derived/resolved by API)
	IdempotencyKey                string `json:"idempotency_key"`                 // Optional UUID
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
	var request EngineRequest
	decoder := json.NewDecoder(os.Stdin)
	if err := decoder.Decode(&request); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse JSON input: %v\n", err)
		os.Exit(1)
	}

	// Validate required fields
	if request.PriceEntry == "" || request.MarketDataCSVPath == "" || request.TradingPair == "" {
		fmt.Fprintf(os.Stderr, "Missing required fields: price_entry, market_data_csv_path, and trading_pair are required\n")
		os.Exit(1)
	}

	// Build Config from EngineRequest
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
		DomainConfig:         cfg,
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

// buildConfigFromRequest creates a domain config from the EngineRequest
// Maps all 13 SDD §4.1 parameters to their corresponding With* options
func buildConfigFromRequest(req *EngineRequest) (*config.Config, error) {
	// [ENGINE-DEBUG] Log every raw parameter received from the API before parsing
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] buildConfigFromRequest called\n")
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   TradingPair                = %q\n", req.TradingPair)
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   StartDate                  = %q\n", req.StartDate)
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   EndDate                    = %q\n", req.EndDate)
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   PriceEntry                 = %q\n", req.PriceEntry)
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   PriceScale                 = %q\n", req.PriceScale)
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   AmountScale                = %q\n", req.AmountScale)
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   NumberOfOrders (SO_Count)  = %d\n", req.NumberOfOrders)
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   AmountPerTrade             = %q\n", req.AmountPerTrade)
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   MarginType                 = %q\n", req.MarginType)
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   Multiplier                 = %d\n", req.Multiplier)
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   TakeProfitDistancePercent  = %q\n", req.TakeProfitDistancePercent)
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   AccountBalance             = %q\n", req.AccountBalance)
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   ExitOnLastOrder            = %v\n", req.ExitOnLastOrder)
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   MarketDataCSVPath          = %q\n", req.MarketDataCSVPath)
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   IdempotencyKey             = %q\n", req.IdempotencyKey)

	// Parse all decimal values using shopspring/decimal for precision
	priceEntry, err := decimal.NewFromString(req.PriceEntry)
	if err != nil {
		return nil, fmt.Errorf("invalid price_entry: %w", err)
	}

	amountPerTrade, err := decimal.NewFromString(req.AmountPerTrade)
	if err != nil {
		return nil, fmt.Errorf("invalid amount_per_trade: %w", err)
	}

	takeProfitDistancePercent, err := decimal.NewFromString(req.TakeProfitDistancePercent)
	if err != nil {
		return nil, fmt.Errorf("invalid take_profit_distance_percent: %w", err)
	}

	accountBalance, err := decimal.NewFromString(req.AccountBalance)
	if err != nil {
		return nil, fmt.Errorf("invalid account_balance: %w", err)
	}

	// Parse decimal scales and multiplier
	priceScale, err := decimal.NewFromString(req.PriceScale)
	if err != nil {
		return nil, fmt.Errorf("invalid price_scale: %w", err)
	}

	amountScale, err := decimal.NewFromString(req.AmountScale)
	if err != nil {
		return nil, fmt.Errorf("invalid amount_scale: %w", err)
	}

	multiplier := decimal.NewFromInt(int64(req.Multiplier))

	// [ENGINE-DEBUG] Log parsed decimal values to confirm conversion succeeded
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] Parsed decimals OK: priceEntry=%s priceScale=%s amountScale=%s amountPerTrade=%s takeProfitPct=%s accountBalance=%s multiplier=%s\n",
		priceEntry, priceScale, amountScale, amountPerTrade, takeProfitDistancePercent, accountBalance, multiplier)

	// Build config wiring all 13 SDD §4.1 parameters via With* options
	cfg, err := config.NewConfig(
		config.WithTradingPair(req.TradingPair),
		config.WithStartDate(req.StartDate),
		config.WithEndDate(req.EndDate),
		config.WithPriceEntry(priceEntry),
		config.WithPriceScale(priceScale),
		config.WithAmountScale(amountScale),
		config.WithNumberOfOrders(req.NumberOfOrders),
		config.WithAmountPerTrade(amountPerTrade),
		config.WithMarginType(req.MarginType),
		config.WithMultiplier(multiplier),
		config.WithTakeProfitDistancePercent(takeProfitDistancePercent),
		config.WithAccountBalance(accountBalance),
		config.WithExitOnLastOrder(req.ExitOnLastOrder),
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

	// Build final_position with both config params and live position state.
	// Live state (average_entry_price, position_quantity, etc.) allows the UI
	// to compute unrealized PnL even if no trade has closed yet.
	finalPosition := map[string]interface{}{
		// Reference config params
		"trading_pair":                 cfg.TradingPair(),
		"start_date":                   cfg.StartDate(),
		"end_date":                     cfg.EndDate(),
		"price_entry":                  cfg.PriceEntry().String(),
		"number_of_orders":             cfg.NumberOfOrders(),
		"account_balance":              cfg.AccountBalance().String(),
		"take_profit_distance_percent": cfg.TakeProfitDistancePercent().String(),
		"exit_on_last_order":           cfg.ExitOnLastOrder(),
	}
	if fp := backtest.FinalPosition; fp != nil {
		finalPosition["state"]               = fp.State.String()
		finalPosition["average_entry_price"] = fp.AverageEntryPrice.String()
		finalPosition["position_quantity"]   = fp.PositionQuantity.String()
		finalPosition["take_profit_target"]  = fp.TakeProfitTarget.String()
		finalPosition["liquidation_price"]   = fp.LiquidationPrice.String()
		finalPosition["fees_accumulated"]    = fp.FeesAccumulated.String()
		finalPosition["realized_profit"]     = fp.Profit.String()
		finalPosition["orders_filled"]       = len(fp.Orders)
		finalPosition["next_order_index"]    = fp.NextOrderIndex
	}

	// Calculate execution time in milliseconds
	executionTimeMs := backtest.EndTime.Sub(backtest.StartTime).Milliseconds()

	return &BacktestOutput{
		Events:          events,
		ExecutionTimeMs: executionTimeMs,
		CandleCount:     backtest.CandleCount,
		EventCount:      backtest.EventCount,
		FinalPosition:   finalPosition,
	}
}
