package orchestrator

import (
	"time"

	domainconfig "dca-bot/core-engine/domain/config"

	"github.com/shopspring/decimal"
)

// OrchestratorConfig configures the backtest orchestrator.
type OrchestratorConfig struct {
	// PSM configuration (will accept position.Config when available)
	PSMConfigPath string

	// Optional: expected total candles (if known; allows pre-allocation)
	EstimatedCandleCount int

	// Optional: backtest ID (generated if not provided)
	BacktestID string

	// Optional: early exit callback for progress monitoring
	ProgressCallback func(candleIdx int, eventCount int) error

	// OnCandleProcessed is an optional hook called once per candle after PSM processing.
	// Receives the 0-based candle index, the candle's UTC timestamp, and its close price.
	// Used by the CLI progress ticker (cmd/engine) to read current date and price.
	// Safe to leave nil — the orchestrator checks before calling.
	OnCandleProcessed func(idx int, ts time.Time, close decimal.Decimal)

	// OnPositionClosed is an optional hook called when a position closes.
	// Receives the raw profit string exactly as carried in the domain TradeClosedEvent.
	// Used by the CLI progress ticker to update the running realized P&L (display-only).
	// Safe to leave nil.
	OnPositionClosed func(profit string)

	// DomainConfig provides SDD §2.1/§2.2 parameter configuration for computing
	// price and amount sequences. If nil, NewPosition uses empty grids (no orders).
	DomainConfig *domainconfig.Config

	// WideEventOutputDir is the directory where the enricher writes per-run .jsonl files.
	// If empty, wide-event output is disabled and no enricher is created.
	WideEventOutputDir string

	// WideEventCallback is an optional hook called for each wide event.
	// When set, wide events are passed to this callback instead of (or in addition to) the file enricher.
	// Used by batch promotion mode to stream wide events to stdout as NDJSON.
	WideEventCallback func(we WideEvent)
}
