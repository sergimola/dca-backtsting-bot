package orchestrator

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"runtime"
	"sync"
	"time"

	"dca-bot/core-engine/domain/config"
	"dca-bot/core-engine/domain/position"

	"github.com/shopspring/decimal"
)

// ─── Batch Execution Types ───────────────────────────────────────────────────

// GroupKey is the deduplication key for candle caching.
// All configs sharing the same (Symbol, StartDate, EndDate) share one LoadAll.
type GroupKey struct {
	Symbol    string
	StartDate string
	EndDate   string
}

// BatchJob represents a single backtest run within a batch.
type BatchJob struct {
	RunID  string
	Config *config.Config
	Key    GroupKey
}

// BatchResult is the output of a single batch run.
type BatchResult struct {
	RunID    string
	Backtest *BacktestRun
	Err      error
}

// CandleLoaderFunc is a function that loads candles for a given group key.
// In production this wraps ClickHouseCandleLoader.LoadAll; in tests it's a mock.
type CandleLoaderFunc func(key GroupKey) ([]Candle, error)

// ─── SliceCandleLoader ──────────────────────────────────────────────────────

// SliceCandleLoader wraps a pre-loaded []Candle slice as a CandleLoader.
// Used by batch mode to pass cached candles to Orchestrator.RunBacktest.
type SliceCandleLoader struct {
	candles []Candle
	pos     int
}

// NewSliceCandleLoader creates a CandleLoader backed by a Candle slice.
// The slice is NOT copied — the caller must ensure it is not mutated concurrently.
func NewSliceCandleLoader(candles []Candle) *SliceCandleLoader {
	return &SliceCandleLoader{candles: candles}
}

func (s *SliceCandleLoader) NextCandle() (*Candle, error) {
	if s.pos >= len(s.candles) {
		return nil, nil
	}
	c := &s.candles[s.pos]
	s.pos++
	return c, nil
}

func (s *SliceCandleLoader) Count() (int64, error) {
	return int64(len(s.candles)), nil
}

func (s *SliceCandleLoader) Close() error { return nil }

// ─── Batch Execution Core ────────────────────────────────────────────────────

// ExecuteBatch groups jobs by (symbol, start, end), loads candles once per group,
// then runs all jobs concurrently via a bounded worker pool.
// workerCount sets the pool size (use runtime.NumCPU() in production).
// loaderFunc is called exactly once per unique groupKey.
//
// Returns one BatchResult per input job (order not guaranteed) plus all results
// serialized as JSON lines (for the caller to write to stdout).
func ExecuteBatch(jobs []BatchJob, loaderFunc CandleLoaderFunc, workerCount int) []json.RawMessage {
	if len(jobs) == 0 {
		slog.Warn("Empty batch: no configs to execute")
		summary, _ := json.Marshal(struct {
			Type       string `json:"type"`
			TotalRuns  int    `json:"total_runs"`
			Successful int    `json:"successful"`
			Failed     int    `json:"failed"`
		}{Type: "batch_summary"})
		return []json.RawMessage{summary}
	}

	if workerCount <= 0 {
		workerCount = runtime.NumCPU()
	}

	// ── Phase 1: Group and load candles ──────────────────────────────────────
	groups := make(map[GroupKey][]Candle)
	for _, job := range jobs {
		if _, loaded := groups[job.Key]; !loaded {
			candles, err := loaderFunc(job.Key)
			if err != nil {
				slog.Error("failed to load candles for group",
					"symbol", job.Key.Symbol,
					"start", job.Key.StartDate,
					"end", job.Key.EndDate,
					"err", err,
				)
				// Mark all jobs in this group as failed
				groups[job.Key] = nil
			} else {
				groups[job.Key] = candles
			}
		}
	}

	// ── Phase 2: Worker pool execution ───────────────────────────────────────
	type indexedResult struct {
		index int
		data  json.RawMessage
		isErr bool
	}

	jobCh := make(chan int, len(jobs))
	resultCh := make(chan indexedResult, len(jobs))

	var wg sync.WaitGroup
	for w := 0; w < workerCount; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range jobCh {
				job := jobs[idx]
				candles := groups[job.Key]
				if candles == nil {
					errResult, _ := json.Marshal(struct {
						RunID string `json:"run_id"`
						Type  string `json:"type"`
						Error string `json:"error"`
					}{RunID: job.RunID, Type: "error", Error: "candle loading failed for group"})
					resultCh <- indexedResult{index: idx, data: errResult, isErr: true}
					continue
				}

				result := runSingleBatchJob(job, candles)
				resultCh <- indexedResult{index: idx, data: result.data, isErr: result.isErr}
			}
		}()
	}

	// Feed jobs to workers.
	for i := range jobs {
		jobCh <- i
	}
	close(jobCh)

	// Wait for all workers, then close result channel.
	go func() {
		wg.Wait()
		close(resultCh)
	}()

	// Collect results.
	var (
		output     []json.RawMessage
		successful int
		failed     int
	)
	for r := range resultCh {
		output = append(output, r.data)
		if r.isErr {
			failed++
		} else {
			successful++
		}
	}

	// Append batch summary.
	summary, _ := json.Marshal(struct {
		Type       string `json:"type"`
		TotalRuns  int    `json:"total_runs"`
		Successful int    `json:"successful"`
		Failed     int    `json:"failed"`
	}{
		Type:       "batch_summary",
		TotalRuns:  len(jobs),
		Successful: successful,
		Failed:     failed,
	})
	output = append(output, summary)

	return output
}

// batchJobResult is the internal result of running a single job.
type batchJobResult struct {
	data  json.RawMessage
	isErr bool
}

// runSingleBatchJob executes a single backtest with a fresh Orchestrator + PSM.
// The candles slice is shared read-only across workers (no mutation).
func runSingleBatchJob(job BatchJob, candles []Candle) batchJobResult {
	start := time.Now()

	cfg := job.Config
	if cfg == nil {
		return makeErrorResult(job.RunID, "nil config")
	}

	// Fresh PSM + Orchestrator per run (total isolation).
	psm := position.NewStateMachine()
	orchCfg := &OrchestratorConfig{
		EstimatedCandleCount: len(candles),
		BacktestID:           job.RunID,
		DomainConfig:         cfg,
	}
	orch, err := NewOrchestrator(psm, orchCfg)
	if err != nil {
		return makeErrorResult(job.RunID, fmt.Sprintf("orchestrator init: %v", err))
	}

	// Use a SliceCandleLoader backed by the shared candle slice.
	loader := NewSliceCandleLoader(candles)
	backtest, err := orch.RunBacktest(loader)
	if err != nil {
		return makeErrorResult(job.RunID, fmt.Sprintf("backtest error: %v", err))
	}

	execMs := time.Since(start).Milliseconds()

	// Build the result payload with aggregated data.
	allEvents := backtest.EventBus.GetAllEvents()
	result := buildBatchResultPayload(job.RunID, allEvents, cfg, execMs, backtest.CandleCount, backtest.EventCount)
	data, _ := json.Marshal(result)
	return batchJobResult{data: data, isErr: false}
}

func makeErrorResult(runID, errMsg string) batchJobResult {
	data, _ := json.Marshal(struct {
		RunID string `json:"run_id"`
		Type  string `json:"type"`
		Error string `json:"error"`
	}{RunID: runID, Type: "error", Error: errMsg})
	return batchJobResult{data: data, isErr: true}
}

// buildBatchResultPayload aggregates events into a result JSON payload.
// This mirrors the single-run aggregation in cmd/engine/aggregator.go
// but returns a minimal result (PnL summary only, no trade events for batch mode).
func buildBatchResultPayload(runID string, events []Event, cfg *config.Config, execMs int64, candleCount, eventCount int) interface{} {
	var (
		entryFees      decimal.Decimal
		tradingFees    decimal.Decimal
		realizedPnl    decimal.Decimal
		totalAdditions decimal.Decimal
		peakEquity     decimal.Decimal
		maxDrawdown    decimal.Decimal
	)

	startBalance := cfg.AccountBalance()

	for _, ev := range events {
		switch ev.Type {
		case EventTypePositionOpened:
			if toe, ok := ev.Data.(*position.TradeOpenedEvent); ok {
				entryFees = entryFees.Add(decStr(toe.EntryFee))
			}

		case EventTypeBuyOrderExecuted:
			if boe, ok := ev.Data.(*position.BuyOrderExecutedEvent); ok {
				tradingFees = tradingFees.Add(decStr(boe.Fee))
			}

		case EventType("SellOrderExecuted"):
			if soe, ok := ev.Data.(*position.SellOrderExecutedEvent); ok {
				tradingFees = tradingFees.Add(decStr(soe.Fee))
			}

		case EventTypePositionClosed:
			if tce, ok := ev.Data.(*position.TradeClosedEvent); ok {
				realizedPnl = realizedPnl.Add(decStr(tce.Profit))

				runningEquity := startBalance.Add(realizedPnl)
				if runningEquity.GreaterThan(peakEquity) {
					peakEquity = runningEquity
				}
				if peakEquity.IsPositive() {
					drawdown := peakEquity.Sub(runningEquity).Div(peakEquity).Mul(decimal.NewFromInt(100))
					if drawdown.GreaterThan(maxDrawdown) {
						maxDrawdown = drawdown
					}
				}
			}

		case EventType("monthly.addition"):
			if mae, ok := ev.Data.(*position.MonthlyAdditionEvent); ok {
				totalAdditions = totalAdditions.Add(decStr(mae.AdditionAmount))
			}
		}
	}

	totalFees := entryFees.Add(tradingFees)
	roiDenominator := startBalance.Add(totalAdditions)
	roi := decimal.Zero
	if roiDenominator.IsPositive() {
		roi = realizedPnl.Div(roiDenominator).Mul(decimal.NewFromInt(100))
	}

	return struct {
		RunID   string  `json:"run_id"`
		Type    string  `json:"type"`
		Summary struct {
			ROI         float64 `json:"roi"`
			MaxDrawdown float64 `json:"maxDrawdown"`
			TotalFees   float64 `json:"totalFees"`
		} `json:"pnlSummary"`
		ExecMs      int64 `json:"executionTimeMs"`
		CandleCount int   `json:"candleCount"`
		EventCount  int   `json:"eventCount"`
	}{
		RunID: runID,
		Type:  "result",
		Summary: struct {
			ROI         float64 `json:"roi"`
			MaxDrawdown float64 `json:"maxDrawdown"`
			TotalFees   float64 `json:"totalFees"`
		}{
			ROI:         roi.InexactFloat64(),
			MaxDrawdown: maxDrawdown.InexactFloat64(),
			TotalFees:   totalFees.InexactFloat64(),
		},
		ExecMs:      execMs,
		CandleCount: candleCount,
		EventCount:  eventCount,
	}
}

func decStr(s string) decimal.Decimal {
	d, err := decimal.NewFromString(s)
	if err != nil {
		return decimal.Zero
	}
	return d
}

// ─── Candle Helpers ──────────────────────────────────────────────────────────

// makeBatchCandles creates n sequential candles for testing.
func makeBatchCandles(symbol string, n int) []Candle {
	base := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	candles := make([]Candle, n)
	for i := range candles {
		candles[i] = Candle{
			Symbol:    symbol,
			Timestamp: base.Add(time.Duration(i) * time.Minute),
			Open:      decimal.NewFromInt(int64(50000 + i)),
			High:      decimal.NewFromInt(int64(50001 + i)),
			Low:       decimal.NewFromInt(int64(49999 + i)),
			Close:     decimal.NewFromInt(int64(50000 + i)),
			Volume:    decimal.NewFromFloat(1.5),
		}
	}
	return candles
}
