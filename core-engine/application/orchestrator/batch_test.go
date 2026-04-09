package orchestrator

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"dca-bot/core-engine/domain/config"
	"dca-bot/core-engine/domain/position"

	"github.com/shopspring/decimal"
)

// ─── Mock Candle Loader Factory ──────────────────────────────────────────────

type mockBatchLoaderFactory struct {
	candlesByKey map[string][]Candle
	loadCounts   map[string]int
}

func newMockBatchLoaderFactory(data map[string][]Candle) *mockBatchLoaderFactory {
	return &mockBatchLoaderFactory{
		candlesByKey: data,
		loadCounts:   make(map[string]int),
	}
}

func (f *mockBatchLoaderFactory) load(key GroupKey) ([]Candle, error) {
	k := key.Symbol + "|" + key.StartDate + "|" + key.EndDate
	f.loadCounts[k]++
	if candles, ok := f.candlesByKey[k]; ok {
		return candles, nil
	}
	return nil, nil
}

// ─── Config Helper ───────────────────────────────────────────────────────────

func minimalConfig(t *testing.T) *config.Config {
	t.Helper()
	cfg, err := config.NewConfig(
		config.WithNumberOfOrders(3),
		config.WithPriceEntry(decimal.RequireFromString("2.0")),
		config.WithPriceScale(decimal.RequireFromString("1.1")),
		config.WithAmountPerTrade(decimal.RequireFromString("1000")),
		config.WithAmountScale(decimal.RequireFromString("2.0")),
		config.WithMultiplier(decimal.NewFromInt(1)),
		config.WithAccountBalance(decimal.RequireFromString("10000")),
		config.WithTakeProfitDistancePercent(decimal.RequireFromString("0.5")),
	)
	if err != nil {
		t.Fatalf("minimalConfig: %v", err)
	}
	return cfg
}

func makeBatchJob(runID, symbol, start, end string, cfg *config.Config) BatchJob {
	return BatchJob{
		RunID:  runID,
		Config: cfg,
		Key:    GroupKey{Symbol: symbol, StartDate: start, EndDate: end},
	}
}

// ─── Test: Grouping logic ────────────────────────────────────────────────────
// 5 configs with 2 distinct (symbol, start, end) groups → exactly 2 load calls.

func TestBatch_GroupingTwoGroups(t *testing.T) {
	cfg := minimalConfig(t)
	jobs := []BatchJob{
		makeBatchJob("r1", "BTCUSDT", "2025-01-01T00:00:00Z", "2025-01-31T00:00:00Z", cfg),
		makeBatchJob("r2", "BTCUSDT", "2025-01-01T00:00:00Z", "2025-01-31T00:00:00Z", cfg),
		makeBatchJob("r3", "ETHUSDT", "2025-01-01T00:00:00Z", "2025-01-31T00:00:00Z", cfg),
		makeBatchJob("r4", "BTCUSDT", "2025-01-01T00:00:00Z", "2025-01-31T00:00:00Z", cfg),
		makeBatchJob("r5", "ETHUSDT", "2025-01-01T00:00:00Z", "2025-01-31T00:00:00Z", cfg),
	}

	factory := newMockBatchLoaderFactory(map[string][]Candle{
		"BTCUSDT|2025-01-01T00:00:00Z|2025-01-31T00:00:00Z": makeBatchCandles("BTCUSDT", 5),
		"ETHUSDT|2025-01-01T00:00:00Z|2025-01-31T00:00:00Z": makeBatchCandles("ETHUSDT", 5),
	})

	results := ExecuteBatch(jobs, factory.load, 2)

	if len(factory.loadCounts) != 2 {
		t.Errorf("expected 2 distinct load calls, got %d: %v", len(factory.loadCounts), factory.loadCounts)
	}
	for key, count := range factory.loadCounts {
		if count != 1 {
			t.Errorf("key %q loaded %d times, want 1", key, count)
		}
	}

	resultCount := 0
	var summary *batchSummaryProbe
	for _, line := range results {
		if isBatchSummary(line) {
			var s batchSummaryProbe
			json.Unmarshal(line, &s)
			summary = &s
		} else {
			resultCount++
		}
	}
	if resultCount != 5 {
		t.Errorf("expected 5 result lines, got %d", resultCount)
	}
	if summary == nil {
		t.Fatal("missing batch_summary line")
	}
	if summary.TotalRuns != 5 {
		t.Errorf("summary.TotalRuns = %d, want 5", summary.TotalRuns)
	}
}

// ─── Test: Concurrent execution ──────────────────────────────────────────────
// 10 configs → all 10 results arrive with distinct run_ids.

func TestBatch_ConcurrentExecution10Configs(t *testing.T) {
	cfg := minimalConfig(t)
	jobs := make([]BatchJob, 10)
	for i := range jobs {
		jobs[i] = makeBatchJob(
			"run-"+string(rune('a'+i)),
			"BTCUSDT", "2025-01-01T00:00:00Z", "2025-01-31T00:00:00Z", cfg,
		)
	}

	factory := newMockBatchLoaderFactory(map[string][]Candle{
		"BTCUSDT|2025-01-01T00:00:00Z|2025-01-31T00:00:00Z": makeBatchCandles("BTCUSDT", 5),
	})

	results := ExecuteBatch(jobs, factory.load, 4)

	seen := make(map[string]bool)
	for _, line := range results {
		if isBatchSummary(line) {
			continue
		}
		var r runIDProbe
		json.Unmarshal(line, &r)
		if seen[r.RunID] {
			t.Errorf("duplicate run_id %q", r.RunID)
		}
		seen[r.RunID] = true
	}
	if len(seen) != 10 {
		t.Errorf("expected 10 distinct run_ids, got %d", len(seen))
	}
}

// ─── Test: Cross-contamination ───────────────────────────────────────────────
// 2 configs with different amount_per_trade → each result has distinct run_id.

func TestBatch_CrossContamination(t *testing.T) {
	cfg500, _ := config.NewConfig(
		config.WithNumberOfOrders(3),
		config.WithPriceEntry(decimal.RequireFromString("2.0")),
		config.WithPriceScale(decimal.RequireFromString("1.1")),
		config.WithAmountPerTrade(decimal.RequireFromString("500")),
		config.WithAmountScale(decimal.RequireFromString("2.0")),
		config.WithMultiplier(decimal.NewFromInt(1)),
		config.WithAccountBalance(decimal.RequireFromString("10000")),
		config.WithTakeProfitDistancePercent(decimal.RequireFromString("0.5")),
	)
	cfg1000, _ := config.NewConfig(
		config.WithNumberOfOrders(3),
		config.WithPriceEntry(decimal.RequireFromString("2.0")),
		config.WithPriceScale(decimal.RequireFromString("1.1")),
		config.WithAmountPerTrade(decimal.RequireFromString("1000")),
		config.WithAmountScale(decimal.RequireFromString("2.0")),
		config.WithMultiplier(decimal.NewFromInt(1)),
		config.WithAccountBalance(decimal.RequireFromString("10000")),
		config.WithTakeProfitDistancePercent(decimal.RequireFromString("0.5")),
	)

	jobs := []BatchJob{
		makeBatchJob("config-500", "BTCUSDT", "2025-01-01T00:00:00Z", "2025-01-31T00:00:00Z", cfg500),
		makeBatchJob("config-1000", "BTCUSDT", "2025-01-01T00:00:00Z", "2025-01-31T00:00:00Z", cfg1000),
	}

	factory := newMockBatchLoaderFactory(map[string][]Candle{
		"BTCUSDT|2025-01-01T00:00:00Z|2025-01-31T00:00:00Z": makeBatchCandles("BTCUSDT", 5),
	})

	results := ExecuteBatch(jobs, factory.load, 2)

	resultMap := make(map[string]bool)
	for _, line := range results {
		if isBatchSummary(line) {
			continue
		}
		var r runIDProbe
		json.Unmarshal(line, &r)
		resultMap[r.RunID] = true
	}
	if !resultMap["config-500"] {
		t.Error("missing result for config-500")
	}
	if !resultMap["config-1000"] {
		t.Error("missing result for config-1000")
	}
}

// ─── Test: Error isolation ───────────────────────────────────────────────────
// 1 job with nil Config among 3 → error emitted for that run, other 2 complete.

func TestBatch_ErrorIsolation(t *testing.T) {
	goodCfg := minimalConfig(t)

	jobs := []BatchJob{
		makeBatchJob("good-1", "BTCUSDT", "2025-01-01T00:00:00Z", "2025-01-31T00:00:00Z", goodCfg),
		{RunID: "bad-1", Config: nil, Key: GroupKey{Symbol: "BTCUSDT", StartDate: "2025-01-01T00:00:00Z", EndDate: "2025-01-31T00:00:00Z"}},
		makeBatchJob("good-2", "BTCUSDT", "2025-01-01T00:00:00Z", "2025-01-31T00:00:00Z", goodCfg),
	}

	factory := newMockBatchLoaderFactory(map[string][]Candle{
		"BTCUSDT|2025-01-01T00:00:00Z|2025-01-31T00:00:00Z": makeBatchCandles("BTCUSDT", 5),
	})

	results := ExecuteBatch(jobs, factory.load, 2)

	var errCount, okCount int
	var summary *batchSummaryProbe
	for _, line := range results {
		if isBatchSummary(line) {
			var s batchSummaryProbe
			json.Unmarshal(line, &s)
			summary = &s
			continue
		}
		var r runIDProbe
		json.Unmarshal(line, &r)
		if r.Type == "error" {
			errCount++
		} else {
			okCount++
		}
	}
	if errCount != 1 {
		t.Errorf("expected 1 error result, got %d", errCount)
	}
	if okCount != 2 {
		t.Errorf("expected 2 success results, got %d", okCount)
	}
	if summary == nil {
		t.Fatal("missing batch_summary")
	}
	if summary.Failed != 1 || summary.Successful != 2 {
		t.Errorf("summary: want successful=2 failed=1, got successful=%d failed=%d",
			summary.Successful, summary.Failed)
	}
}

// ─── Test: Duplicate configs ─────────────────────────────────────────────────

func TestBatch_DuplicateConfigs(t *testing.T) {
	cfg := minimalConfig(t)
	jobs := []BatchJob{
		makeBatchJob("dup-1", "BTCUSDT", "2025-01-01T00:00:00Z", "2025-01-31T00:00:00Z", cfg),
		makeBatchJob("dup-2", "BTCUSDT", "2025-01-01T00:00:00Z", "2025-01-31T00:00:00Z", cfg),
	}

	factory := newMockBatchLoaderFactory(map[string][]Candle{
		"BTCUSDT|2025-01-01T00:00:00Z|2025-01-31T00:00:00Z": makeBatchCandles("BTCUSDT", 5),
	})

	results := ExecuteBatch(jobs, factory.load, 2)

	seen := make(map[string]bool)
	for _, line := range results {
		if isBatchSummary(line) {
			continue
		}
		var r runIDProbe
		json.Unmarshal(line, &r)
		seen[r.RunID] = true
	}
	if !seen["dup-1"] || !seen["dup-2"] {
		t.Errorf("expected both dup-1 and dup-2, got %v", seen)
	}
}

// ─── Test: Empty batch ───────────────────────────────────────────────────────

func TestBatch_EmptyBatch(t *testing.T) {
	factory := newMockBatchLoaderFactory(nil)
	results := ExecuteBatch(nil, factory.load, 2)

	if len(results) != 1 {
		t.Fatalf("expected 1 line (summary only), got %d", len(results))
	}
	var s batchSummaryProbe
	json.Unmarshal(results[0], &s)
	if s.Type != "batch_summary" || s.TotalRuns != 0 {
		t.Errorf("expected empty summary, got %+v", s)
	}
}

// ─── JSON probes ─────────────────────────────────────────────────────────────

type batchSummaryProbe struct {
	Type       string `json:"type"`
	TotalRuns  int    `json:"total_runs"`
	Successful int    `json:"successful"`
	Failed     int    `json:"failed"`
}

type runIDProbe struct {
	RunID string `json:"run_id"`
	Type  string `json:"type"`
}

func isBatchSummary(data json.RawMessage) bool {
	var probe struct {
		Type string `json:"type"`
	}
	json.Unmarshal(data, &probe)
	return probe.Type == "batch_summary"
}

// ─── Test: T016 — ExecuteBatchToWriter streams results before batch_summary ──
// Verifies non-buffered streaming: first result line written before batch_summary,
// total lines = N results + 1 batch_summary.

func TestBatchToWriter_StreamsBeforeSummary(t *testing.T) {
	cfg := minimalConfig(t)
	const numJobs = 5
	jobs := make([]BatchJob, numJobs)
	for i := range jobs {
		jobs[i] = makeBatchJob(
			"stream-"+string(rune('a'+i)),
			"BTCUSDT", "2025-01-01T00:00:00Z", "2025-01-31T00:00:00Z", cfg,
		)
	}
	factory := newMockBatchLoaderFactory(map[string][]Candle{
		"BTCUSDT|2025-01-01T00:00:00Z|2025-01-31T00:00:00Z": makeBatchCandles("BTCUSDT", 5),
	})

	var buf bytes.Buffer
	ExecuteBatchToWriter(jobs, factory.load, 2, &buf)

	lines := splitNDJSON(&buf)
	// last line must be batch_summary
	if len(lines) < 2 {
		t.Fatalf("expected at least 2 lines, got %d", len(lines))
	}
	lastLine := lines[len(lines)-1]
	var lastProbe struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal([]byte(lastLine), &lastProbe); err != nil || lastProbe.Type != "batch_summary" {
		t.Errorf("last line should be batch_summary, got: %s", lastLine)
	}

	// all lines before summary must be results
	resultLines := lines[:len(lines)-1]
	if len(resultLines) != numJobs {
		t.Errorf("expected %d result lines before summary, got %d", numJobs, len(resultLines))
	}
	for _, rl := range resultLines {
		var r runIDProbe
		if err := json.Unmarshal([]byte(rl), &r); err != nil {
			t.Errorf("failed to parse result line: %s", rl)
		}
		if r.Type != "result" && r.Type != "error" {
			t.Errorf("expected result/error type, got %q in line: %s", r.Type, rl)
		}
	}
}

// ─── Test: T020 — Win rate tracking ──────────────────────────────────────────

func TestBatch_WinRate_ThreeTPOneLiquidation(t *testing.T) {
	// FR-014: winRate = TPs / (TPs + SLs). Liquidation is excluded from denominator.
	// 3 TPs + 1 SL → winRate = 0.75
	cfg := minimalConfig(t)
	events := []Event{
		makeClosedEvent("take_profit"),
		makeClosedEvent("take_profit"),
		makeClosedEvent("take_profit"),
		makeClosedEvent("stop_loss"),
	}
	result := buildBatchResultPayload("wr-test", events, cfg, 10, 5, 4, nil, decimal.Zero)
	data, _ := json.Marshal(result)
	var probe winRateProbe
	if err := json.Unmarshal(data, &probe); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if probe.WinRate == nil {
		t.Fatal("winRate is nil, expected 0.75")
	}
	const want = 0.75
	const eps = 0.0001
	if *probe.WinRate < want-eps || *probe.WinRate > want+eps {
		t.Errorf("winRate = %v, want %v", *probe.WinRate, want)
	}
	if probe.TotalPositionsClosed != 4 {
		t.Errorf("totalPositionsClosed = %d, want 4", probe.TotalPositionsClosed)
	}
}

func TestBatch_WinRate_ZeroCloses_NilNotPanic(t *testing.T) {
	// Verify win rate is nil (not 0) when zero positions closed — no divide-by-zero
	cfg := minimalConfig(t)
	events := []Event{} // no PositionClosed events
	result := buildBatchResultPayload("wr-nil-test", events, cfg, 10, 5, 0, nil, decimal.Zero)
	data, _ := json.Marshal(result)
	var probe winRateProbe
	json.Unmarshal(data, &probe)
	if probe.WinRate != nil {
		t.Errorf("expected winRate nil for 0 closes, got %v", *probe.WinRate)
	}
	if probe.TotalPositionsClosed != 0 {
		t.Errorf("totalPositionsClosed = %d, want 0", probe.TotalPositionsClosed)
	}
}

func TestBatch_WinRate_AllTP_One(t *testing.T) {
	// Verify win rate = 1.0 when all 5 closes are take_profit
	cfg := minimalConfig(t)
	events := []Event{
		makeClosedEvent("take_profit"),
		makeClosedEvent("take_profit"),
		makeClosedEvent("take_profit"),
		makeClosedEvent("take_profit"),
		makeClosedEvent("take_profit"),
	}
	result := buildBatchResultPayload("wr-full-test", events, cfg, 10, 5, 5, nil, decimal.Zero)
	data, _ := json.Marshal(result)
	var probe winRateProbe
	json.Unmarshal(data, &probe)
	if probe.WinRate == nil {
		t.Fatal("winRate is nil, expected 1.0")
	}
	const eps = 0.0001
	if *probe.WinRate < 1.0-eps || *probe.WinRate > 1.0+eps {
		t.Errorf("winRate = %v, want 1.0", *probe.WinRate)
	}
}

// ─── Helpers for new tests ────────────────────────────────────────────────────

type winRateProbe struct {
	WinRate              *float64 `json:"winRate"`
	TotalPositionsClosed int      `json:"totalPositionsClosed"`
}

func makeClosedEvent(reason string) Event {
	return Event{
		Type: EventTypePositionClosed,
		Data: &position.TradeClosedEvent{
			Profit: "0",
			Reason: reason,
		},
	}
}

func makeClosedEventWithProfit(reason, profit string) Event {
	return Event{
		Type: EventTypePositionClosed,
		Data: &position.TradeClosedEvent{
			Profit: profit,
			Reason: reason,
		},
	}
}

// ─── Test: T_ROI — Stop-loss P&L must reduce ROI ─────────────────────────────

func TestBatch_ROI_StopLossReducesROI(t *testing.T) {
	// 1 TP (+10) + 1 SL (-5) on $10000 start balance → ROI = 5/10000*100 = 0.05%
	cfg := minimalConfig(t)
	events := []Event{
		makeClosedEventWithProfit("take_profit", "10"),
		makeClosedEventWithProfit("stop_loss", "-5"),
	}
	result := buildBatchResultPayload("roi-sl-test", events, cfg, 10, 5, 2, nil, decimal.Zero)
	data, _ := json.Marshal(result)

	var probe struct {
		PnlSummary struct {
			ROI         float64 `json:"roi"`
			MaxDrawdown float64 `json:"maxDrawdown"`
		} `json:"pnlSummary"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// With SL loss counted: realizedPnl = 10 - 5 = 5; ROI = 5/10000*100 = 0.05
	// If bug (SL excluded): realizedPnl = 10; ROI = 10/10000*100 = 0.10
	const wantROI = 0.05
	const eps = 0.001
	got := probe.PnlSummary.ROI
	if got < wantROI-eps || got > wantROI+eps {
		t.Errorf("ROI = %v, want %v — stop-loss P&L not counted in realizedPnl", got, wantROI)
	}
	// MaxDrawdown must be > 0 because equity dips after the SL loss
	if probe.PnlSummary.MaxDrawdown <= 0 {
		t.Errorf("MaxDrawdown = %v, want > 0 — SL loss should cause a drawdown from the TP peak", probe.PnlSummary.MaxDrawdown)
	}
}

func TestBatch_ROI_OnlyStopLosses_NegativeROI(t *testing.T) {
	// 3 SLs of -$100 each on $10000 start balance → ROI = -300/10000*100 = -3%
	cfg := minimalConfig(t)
	events := []Event{
		makeClosedEventWithProfit("stop_loss", "-100"),
		makeClosedEventWithProfit("stop_loss", "-100"),
		makeClosedEventWithProfit("stop_loss", "-100"),
	}
	result := buildBatchResultPayload("roi-sl-only-test", events, cfg, 10, 5, 3, nil, decimal.Zero)
	data, _ := json.Marshal(result)

	var probe struct {
		PnlSummary struct {
			ROI float64 `json:"roi"`
		} `json:"pnlSummary"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	const wantROI = -3.0
	const eps = 0.001
	got := probe.PnlSummary.ROI
	if got < wantROI-eps || got > wantROI+eps {
		t.Errorf("ROI = %v, want %v — stop-loss-only P&L should give negative ROI", got, wantROI)
	}
}

func splitNDJSON(buf interface{ String() string }) []string {
	raw := buf.String()
	var lines []string
	for _, l := range strings.Split(raw, "\n") {
		if strings.TrimSpace(l) != "" {
			lines = append(lines, l)
		}
	}
	return lines
}
