package orchestrator

import (
	domainconfig "dca-bot/core-engine/domain/config"
)

// OrchestratorConfig configures the backtest orchestrator.
type OrchestratorConfig struct {
	// PSM configuration (will accept position.Config when available)
	PSMConfigPath string

	// CSV input file path (or reader interface for testability)
	DataSourcePath string

	// Optional: expected total candles (if known; allows pre-allocation)
	EstimatedCandleCount int

	// Optional: backtest ID (generated if not provided)
	BacktestID string

	// Optional: early exit callback for progress monitoring
	ProgressCallback func(candleIdx int, eventCount int) error

	// DomainConfig provides SDD §2.1/§2.2 parameter configuration for computing
	// price and amount sequences. If nil, NewPosition uses empty grids (no orders).
	DomainConfig *domainconfig.Config
}
