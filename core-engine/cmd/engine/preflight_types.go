package main

// preflight_types.go — Batch-level types for the optimizer engine modes.
// PreFlightResult and PreFlightLadderEntry live in domain/config/preflight.go
// to avoid circular imports (domain types must stay in the domain layer).

// BatchJobConfig is a single config entry in a --batch-config JSON file.
// It embeds all EngineRequest fields plus a unique run_id for result tagging.
type BatchJobConfig struct {
	RunID string `json:"run_id"`
	EngineRequest
}

// BatchResultPayload is the NDJSON line emitted for each completed batch run.
type BatchResultPayload struct {
	RunID            string               `json:"run_id"`
	Type             string               `json:"type"` // "result" or "error"
	Error            string               `json:"error,omitempty"`
	PnlSummary       *PnlSummaryOutput    `json:"pnlSummary,omitempty"`
	TradeEvents      []TradeEventOutput    `json:"tradeEvents,omitempty"`
	SafetyOrderUsage []SafetyOrderUsageEntry `json:"safetyOrderUsage,omitempty"`
	ExecutionTimeMs  int64                 `json:"executionTimeMs,omitempty"`
	CandleCount      int                   `json:"candleCount,omitempty"`
	EventCount       int                   `json:"eventCount,omitempty"`
}

// BatchSummary is the final line emitted after all batch runs complete.
type BatchSummary struct {
	Type       string `json:"type"`       // always "batch_summary"
	TotalRuns  int    `json:"total_runs"`
	Successful int    `json:"successful"`
	Failed     int    `json:"failed"`
}
