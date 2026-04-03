package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

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
	MonthlyAddition               string `json:"monthly_addition,omitempty"`     // Optional: capital injected each calendar month (decimal string >= 0)
	ExitOnLastOrder               bool   `json:"exit_on_last_order"`              // Boolean: end simulation when last order fills
	ClickhouseAddr                string `json:"clickhouse_addr"`                 // ClickHouse native TCP address, e.g. "localhost:9000"
	ClickhouseDb                  string `json:"clickhouse_db"`                   // ClickHouse database, e.g. "dca_bot"
	ClickhouseUser                string `json:"clickhouse_user"`                 // ClickHouse username
	ClickhousePassword            string `json:"clickhouse_password"`             // ClickHouse password
	IdempotencyKey                string `json:"idempotency_key"`                 // Optional UUID
	EnableWideEvents              *bool  `json:"enable_wide_events,omitempty"`    // Optional: override env-var OR logic
	WideEventsToStdout            *bool  `json:"wide_events_to_stdout,omitempty"` // Emit wide events as NDJSON to stdout (batch promotion mode)
}

// ProgressPayload is emitted to stdout every --progress-interval-ms milliseconds.
// JSON field names are snake_case to match the TypeScript ProgressLine interface.
type ProgressPayload struct {
	Type             string  `json:"type"`               // always "progress"
	Percent          float64 `json:"percent"`            // 0–99 (capped; 100 only on final result)
	CurrentDate      string  `json:"current_date"`       // RFC3339 UTC of last processed candle
	ProcessedCandles int64   `json:"processed_candles"`  // candles consumed so far
	TotalCandles     int64   `json:"total_candles"`      // from pre-flight COUNT; 0 if unknown
	CurrentPrice     float64 `json:"current_price"`      // last candle close (InexactFloat64)
	RealizedPnl      float64 `json:"realized_pnl"`       // cumulative PositionClosed.profit
	CandlesPerSecond int64   `json:"candles_per_second"` // candles in last tick window / elapsed s
}

// PnlSummaryOutput is the aggregate financial summary.
// JSON tags MUST match StoredPnlSummary in orchestrator/api/src/types/index.ts exactly.
type PnlSummaryOutput struct {
	Roi         float64 `json:"roi"`         // (realizedPnl / accountBalance) * 100
	MaxDrawdown float64 `json:"maxDrawdown"` // peak-to-trough equity drawdown as percent
	TotalFees   float64 `json:"totalFees"`   // entryFees + tradingFees + sellFees
}

// TradeEventOutput is a single frontend-ready trade event.
// JSON tags MUST match StoredTradeEvent in orchestrator/api/src/types/index.ts exactly.
// NOTE: TradeID uses snake_case json tag "trade_id" — this matches the TS interface.
type TradeEventOutput struct {
	Timestamp    string  `json:"timestamp"`    // localized display string
	RawTimestamp string  `json:"rawTimestamp"` // RFC3339 UTC
	EventType    string  `json:"eventType"`    // "ENTRY" | "SAFETY_ORDER" | "EXIT"
	Price        float64 `json:"price"`
	Quantity     float64 `json:"quantity"`
	Balance      float64 `json:"balance"`  // cost for ENTRY/SAFETY_ORDER; profit for EXIT
	TradeID      string  `json:"trade_id"` // NOTE: snake_case — matches TS StoredTradeEvent
	Fee          float64 `json:"fee"`
}

// SafetyOrderUsageEntry is a histogram bucket for safety order depth usage.
// JSON tags match the TypeScript { level: string; count: number } shape.
type SafetyOrderUsageEntry struct {
	Level string `json:"level"` // "1", "2", ... (1-indexed string)
	Count int    `json:"count"`
}

// EngineResultPayload is the single JSON line emitted to stdout at simulation end.
// JSON tags MUST match the TypeScript EngineResultLine interface in contracts/.
type EngineResultPayload struct {
	Type                     string                  `json:"type"`                                  // always "result"
	PnlSummary               PnlSummaryOutput        `json:"pnlSummary"`
	TradeEvents              []TradeEventOutput      `json:"tradeEvents"`
	SafetyOrderUsage         []SafetyOrderUsageEntry `json:"safetyOrderUsage"`
	ExecutionTimeMs          int64                   `json:"executionTimeMs"`
	CandleCount              int                     `json:"candleCount"`
	EventCount               int                     `json:"eventCount"`
	WideEventFile            string                  `json:"wide_event_file,omitempty"`             // path to .jsonl; absent when enricher disabled
	WideEventStallDurationMs int64                   `json:"wide_event_stall_duration_ms,omitempty"` // PSM stall ms; absent when 0
}

// progressState holds the shared state between the hot loop and the progress ticker goroutine.
// Fields updated at candle frequency (processedCandles, currentDateNano, currentPriceBits) use
// lock-free atomic operations. The CAS loop in OnPositionClosed handles the infrequent float64
// accumulation for realizedPnl without requiring a mutex.
type progressState struct {
	processedCandles atomic.Int64  // incremented once per candle via OnCandleProcessed
	lastTickCandles  atomic.Int64  // snapshot for cps calculation (ticker goroutine only)
	totalCandles     int64         // immutable after initialisation
	currentDateNano  atomic.Int64  // unix nanoseconds of last processed candle timestamp
	currentPriceBits atomic.Uint64 // float64 value of last candle close (math.Float64bits)
	realizedPnlBits  atomic.Uint64 // cumulative realized P&L, display-only (float64 bits)
}

// startProgressTicker launches a goroutine that emits ProgressPayload NDJSON lines to out
// every intervalMs milliseconds. Returns a cancel function that stops the goroutine cleanly.
// The caller MUST call cancel() before writing the final result line to stdout.
func startProgressTicker(ctx context.Context, state *progressState, intervalMs int, out *os.File) func() {
	tickCtx, cancel := context.WithCancel(ctx)
	enc := json.NewEncoder(out)
	go func() {
		ticker := time.NewTicker(time.Duration(intervalMs) * time.Millisecond)
		defer ticker.Stop()
		lastTickTime := time.Now()
		for {
			select {
			case t := <-ticker.C:
				elapsed := t.Sub(lastTickTime).Seconds()
				processed := state.processedCandles.Load()
				lastProcessed := state.lastTickCandles.Swap(processed)
				cps := int64(0)
				if elapsed > 0 {
					cps = int64(float64(processed-lastProcessed) / elapsed)
				}
				pct := 0.0
				if state.totalCandles > 0 {
					pct = math.Min(99.0, float64(processed)/float64(state.totalCandles)*100.0)
				}
				dateNano := state.currentDateNano.Load()
				currentDate := ""
				if dateNano > 0 {
					currentDate = time.Unix(0, dateNano).UTC().Format(time.RFC3339)
				}
				currentPrice := math.Float64frombits(state.currentPriceBits.Load())
				realizedPnl := math.Float64frombits(state.realizedPnlBits.Load())
				lastTickTime = t
				_ = enc.Encode(ProgressPayload{
					Type:             "progress",
					Percent:          pct,
					CurrentDate:      currentDate,
					ProcessedCandles: processed,
					TotalCandles:     state.totalCandles,
					CurrentPrice:     currentPrice,
					RealizedPnl:      realizedPnl,
					CandlesPerSecond: cps,
				}) // json.Encoder.Encode appends \n; errors are best-effort
			case <-tickCtx.Done():
				return
			}
		}
	}()
	return cancel
}

// configureSlog initialises the default slog handler with the requested level.
// All slog output goes to stderr only; stdout is reserved for NDJSON progress/result lines.
func configureSlog(levelStr string) {
	var level slog.Level
	switch strings.ToUpper(strings.TrimSpace(levelStr)) {
	case "DEBUG":
		level = slog.LevelDebug
	case "WARN":
		level = slog.LevelWarn
	case "ERROR":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}
	slog.SetDefault(slog.New(
		slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}),
	))
}

func main() {
	// CLI flags — must be parsed before stdin decode and slog initialisation.
	logLevel := flag.String("log-level", "INFO", "Log level: DEBUG, INFO, WARN, ERROR")
	progressIntervalMs := flag.Int("progress-interval-ms", 250, "Progress tick interval in milliseconds")
	wideEventDir := flag.String("wide-event-dir", "", "Directory for wide-event .jsonl output (empty = disabled)")
	preflightMode := flag.Bool("preflight", false, "Pre-Flight mode: read single config from stdin, emit DCA ladder JSON to stdout, exit (no ClickHouse)")
	batchPreflightPath := flag.String("batch-preflight", "", "Batch Pre-Flight mode: read JSON array of configs from file, emit JSON array of ladder results to stdout, exit (no ClickHouse)")
	batchConfigPath := flag.String("batch-config", "", "Batch execution mode: read JSON array of configs from file, run all concurrently, stream tagged results to stdout")
	flag.Parse()

	// Configure structured logging immediately after flag parsing.
	// All slog output goes to stderr; stdout carries only NDJSON lines.
	configureSlog(*logLevel)

	// Recover from panics and log to stderr
	defer func() {
		if r := recover(); r != nil {
			fmt.Fprintf(os.Stderr, "Fatal panic: %v\n", r)
			os.Exit(1)
		}
	}()

	// ── Dispatch: Pre-Flight modes (no ClickHouse I/O) ───────────────────────
	if *preflightMode {
		runSinglePreflight()
		return
	}
	if *batchPreflightPath != "" {
		runBatchPreflight(*batchPreflightPath)
		return
	}
	// ── Dispatch: Batch execution mode ───────────────────────────────────────
	if *batchConfigPath != "" {
		runBatchBacktest(*batchConfigPath, *logLevel, *wideEventDir)
		return
	}

	// ── Default: single-run backtest (reads from stdin) ──────────────────────
	if *progressIntervalMs <= 0 {
		slog.Warn("--progress-interval-ms must be >0; using default 250")
		*progressIntervalMs = 250
	}

	// Read JSON request from stdin
	var request EngineRequest
	decoder := json.NewDecoder(os.Stdin)
	if err := decoder.Decode(&request); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse JSON input: %v\n", err)
		os.Exit(1)
	}

	slog.Debug("request decoded",
		"trading_pair", request.TradingPair,
		"price_entry", request.PriceEntry,
		"clickhouse_addr", request.ClickhouseAddr,
		"clickhouse_db", request.ClickhouseDb,
	)

	// Validate required fields
	if request.PriceEntry == "" || request.ClickhouseAddr == "" || request.TradingPair == "" {
		fmt.Fprintf(os.Stderr, "Missing required fields: price_entry, clickhouse_addr, and trading_pair are required\n")
		os.Exit(1)
	}
	if request.ClickhouseDb == "" {
		fmt.Fprintf(os.Stderr, "Missing required field: clickhouse_db is required\n")
		os.Exit(1)
	}

	// FR-026: enable_wide_events OR logic — env var OR config payload flag.
	// Config-level flag takes precedence over environment defaults (spec §FR-023).
	envWideEvents := os.Getenv("ENABLE_WIDE_EVENTS") == "true"
	reqWideEvents := request.EnableWideEvents != nil && *request.EnableWideEvents
	if (envWideEvents || reqWideEvents) && *wideEventDir == "" {
		*wideEventDir = filepath.Join(os.TempDir(), "dca-wide-events", request.IdempotencyKey)
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
		EstimatedCandleCount: 10000, // Reasonable estimate; ClickHouse streams rows lazily
		BacktestID:           request.IdempotencyKey,
		DomainConfig:         cfg,
		WideEventOutputDir:   *wideEventDir,
	}

	// Create orchestrator
	orch, err := orchestrator.NewOrchestrator(psm, orchConfig)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create orchestrator: %v\n", err)
		os.Exit(1)
	}

	// Build ClickHouse config from request fields
	chCfg := orchestrator.ClickHouseConfig{
		Addr:     request.ClickhouseAddr,
		Database: request.ClickhouseDb,
		User:     request.ClickhouseUser,
		Password: request.ClickhousePassword,
	}

	// Normalise symbol: "BTC/USDT" → "BTCUSDT"
	symbol := strings.ReplaceAll(request.TradingPair, "/", "")

	// Create ClickHouse candle loader
	loader, err := orchestrator.NewClickHouseCandleLoader(chCfg, symbol, request.StartDate, request.EndDate)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to open ClickHouse candle loader: %v\n", err)
		os.Exit(1)
	}

	// Pre-flight candle COUNT for accurate progress percentages (FR-012).
	totalCandles, countErr := loader.Count()
	if countErr != nil {
		slog.Warn("could not determine candle count; progress percent will be approximate",
			"err", countErr,
		)
		totalCandles = int64(orchConfig.EstimatedCandleCount)
	}
	slog.Debug("pre-flight candle count", "total_candles", totalCandles)

	// Initialise progress state (lock-free; shared between hot loop callback goroutine and ticker).
	state := &progressState{totalCandles: totalCandles}

	// Wire the hot-loop callbacks into the orchestrator config.
	// These closures capture state and are called from within RunBacktest.
	orchConfig.OnCandleProcessed = func(idx int, ts time.Time, close decimal.Decimal) {
		state.processedCandles.Store(int64(idx + 1))
		state.currentDateNano.Store(ts.UnixNano())
		state.currentPriceBits.Store(math.Float64bits(close.InexactFloat64()))
	}
	orchConfig.OnPositionClosed = func(profit string) {
		d, pErr := decimal.NewFromString(profit)
		if pErr != nil {
			return
		}
		delta := d.InexactFloat64()
		// Atomic float64 accumulation via CAS loop.
		for {
			old := state.realizedPnlBits.Load()
			newVal := math.Float64bits(math.Float64frombits(old) + delta)
			if state.realizedPnlBits.CompareAndSwap(old, newVal) {
				break
			}
		}
	}

	// Start progress ticker goroutine; cancel it before writing the result line.
	cancelTicker := startProgressTicker(context.Background(), state, *progressIntervalMs, os.Stdout)

	// Run backtest
	backtest, err := orch.RunBacktest(loader)
	if err != nil {
		cancelTicker()
		fmt.Fprintf(os.Stderr, "Backtest execution failed: %v\n", err)
		os.Exit(1)
	}

	// Stop progress ticker and drain any in-flight tick before emitting the result line.
	// This guarantees that progress lines are always followed by the result line — never interleaved.
	cancelTicker()
	time.Sleep(time.Duration(*progressIntervalMs+50) * time.Millisecond)

	// Aggregate results in-process (ports ResultAggregator.aggregateGoEvents + processGoEventsForFrontend).
	allEvents := backtest.EventBus.GetAllEvents()
	aggResult := aggregateBacktestEvents(allEvents, cfg.AccountBalance())
	tradeEvents := buildTradeEvents(allEvents)
	soUsage := buildSafetyOrderUsage(aggResult.SafetyOrderCounts)

	execTimeMs := backtest.EndTime.Sub(backtest.StartTime).Milliseconds()

	// Emit the single result line to stdout (NDJSON — json.Encoder appends \n).
	if err := json.NewEncoder(os.Stdout).Encode(EngineResultPayload{
		Type:                     "result",
		PnlSummary:               aggResult.PnlSummary,
		TradeEvents:              tradeEvents,
		SafetyOrderUsage:         soUsage,
		ExecutionTimeMs:          execTimeMs,
		CandleCount:              backtest.CandleCount,
		EventCount:               backtest.EventCount,
		WideEventFile:            backtest.WideEventFilePath,
		WideEventStallDurationMs: backtest.WideEventStallDuration.Milliseconds(),
	}); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to write result: %v\n", err)
		os.Exit(1)
	}
}

// buildConfigFromRequest creates a domain config from the EngineRequest
// Maps all 13 SDD §4.1 parameters to their corresponding With* options
func buildConfigFromRequest(req *EngineRequest) (*config.Config, error) {
	slog.Debug("buildConfigFromRequest called",
		"trading_pair", req.TradingPair,
		"start_date", req.StartDate,
		"end_date", req.EndDate,
		"price_entry", req.PriceEntry,
		"price_scale", req.PriceScale,
		"amount_scale", req.AmountScale,
		"number_of_orders", req.NumberOfOrders,
		"amount_per_trade", req.AmountPerTrade,
		"margin_type", req.MarginType,
		"multiplier", req.Multiplier,
		"take_profit_pct", req.TakeProfitDistancePercent,
		"account_balance", req.AccountBalance,
		"exit_on_last_order", req.ExitOnLastOrder,
	)

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

	slog.Debug("decimals parsed ok",
		"price_entry", priceEntry,
		"price_scale", priceScale,
		"amount_scale", amountScale,
		"amount_per_trade", amountPerTrade,
		"take_profit_pct", takeProfitDistancePercent,
		"account_balance", accountBalance,
		"multiplier", multiplier,
	)

	// Build config wiring all 13 SDD §4.1 parameters via With* options
	// Parse optional monthly addition (defaults to 0 when absent or empty)
	monthlyAddition := config.DefaultMonthlyAddition
	if req.MonthlyAddition != "" {
		parsed, parseErr := decimal.NewFromString(req.MonthlyAddition)
		if parseErr != nil {
			return nil, fmt.Errorf("invalid monthly_addition: %w", parseErr)
		}
		monthlyAddition = parsed
	}

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
		config.WithMonthlyAddition(monthlyAddition),
		config.WithExitOnLastOrder(req.ExitOnLastOrder),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create config: %w", err)
	}

	slog.Debug("config built ok",
		"trading_pair", cfg.TradingPair(),
		"number_of_orders", cfg.NumberOfOrders(),
	)

	return cfg, nil
}

// ── Pre-Flight Handlers ──────────────────────────────────────────────────────

// runSinglePreflight reads a single EngineRequest from stdin, computes the
// DCA Pre-Flight ladder, and emits a single JSON object to stdout.
// No ClickHouse connection is opened.
func runSinglePreflight() {
	var request EngineRequest
	if err := json.NewDecoder(os.Stdin).Decode(&request); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse JSON input: %v\n", err)
		os.Exit(1)
	}

	cfg, err := buildConfigFromRequest(&request)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to build config: %v\n", err)
		os.Exit(1)
	}

	result, err := config.ComputePreFlight(cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Pre-Flight computation failed: %v\n", err)
		os.Exit(1)
	}

	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to write Pre-Flight result: %v\n", err)
		os.Exit(1)
	}
}

// runBatchPreflight reads a JSON array of EngineRequest objects from a file,
// computes the DCA Pre-Flight ladder for each, and emits one JSON object per
// line (NDJSON) to stdout.  No ClickHouse connection is opened.
// Streaming NDJSON means the caller never has to buffer the full output in
// memory — it can parse results line-by-line as they arrive.
func runBatchPreflight(filePath string) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to read batch-preflight file %q: %v\n", filePath, err)
		os.Exit(1)
	}

	var requests []EngineRequest
	if err := json.Unmarshal(data, &requests); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse batch-preflight JSON: %v\n", err)
		os.Exit(1)
	}

	enc := json.NewEncoder(os.Stdout)
	for i, req := range requests {
		cfg, err := buildConfigFromRequest(&req)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Config error for request[%d]: %v\n", i, err)
			os.Exit(1)
		}

		result, err := config.ComputePreFlight(cfg)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Pre-Flight error for request[%d]: %v\n", i, err)
			os.Exit(1)
		}

		if req.IdempotencyKey != "" {
			result.RunID = req.IdempotencyKey
		}

		if err := enc.Encode(result); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to write Pre-Flight result[%d]: %v\n", i, err)
			os.Exit(1)
		}
	}
}

// ── Batch Execution Handler ──────────────────────────────────────────────────

// runBatchBacktest reads a JSON array of BatchJobConfig from a file,
// groups by (symbol, start_date, end_date), loads candles once per group,
// and runs all configs concurrently via a worker pool.
func runBatchBacktest(filePath, logLevel, wideEventDir string) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to read batch-config file %q: %v\n", filePath, err)
		os.Exit(1)
	}

	var batchConfigs []BatchJobConfig
	if err := json.Unmarshal(data, &batchConfigs); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse batch-config JSON: %v\n", err)
		os.Exit(1)
	}

	// Convert BatchJobConfig → orchestrator.BatchJob (parse EngineRequest → Config).
	jobs := make([]orchestrator.BatchJob, 0, len(batchConfigs))
	for i, bc := range batchConfigs {
		cfg, err := buildConfigFromRequest(&bc.EngineRequest)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Config error for batch[%d] run_id=%q: %v\n", i, bc.RunID, err)
			os.Exit(1)
		}
		symbol := strings.ReplaceAll(bc.TradingPair, "/", "")
		wideToStdout := bc.WideEventsToStdout != nil && *bc.WideEventsToStdout
		jobs = append(jobs, orchestrator.BatchJob{
			RunID:              bc.RunID,
			Config:             cfg,
			Key: orchestrator.GroupKey{
				Symbol:    symbol,
				StartDate: bc.StartDate,
				EndDate:   bc.EndDate,
			},
			WideEventsToStdout: wideToStdout,
		})
	}

	// Candle loader function: creates a real ClickHouse connection per group.
	loaderFunc := func(key orchestrator.GroupKey) ([]orchestrator.Candle, error) {
		// Build ClickHouse config from the first batch config (all share the same CH settings).
		chCfg := orchestrator.ClickHouseConfig{
			Addr:     batchConfigs[0].ClickhouseAddr,
			Database: batchConfigs[0].ClickhouseDb,
			User:     batchConfigs[0].ClickhouseUser,
			Password: batchConfigs[0].ClickhousePassword,
		}
		loader, err := orchestrator.NewClickHouseCandleLoader(chCfg, key.Symbol, key.StartDate, key.EndDate)
		if err != nil {
			return nil, err
		}
		defer loader.Close()
		return loader.LoadAll()
	}

	// Execute batch with streaming writer — each result is written to stdout
	// immediately as workers complete (T015 / FR-017 non-blocking streaming).
	orchestrator.ExecuteBatchToWriter(jobs, loaderFunc, 0, os.Stdout)
}