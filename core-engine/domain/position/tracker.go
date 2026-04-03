package position

// KpiTracker accumulates Time-in-Market KPIs across all positions in a single run.
// Zero-value struct is the correct initial state (both fields default to 0).
type KpiTracker struct {
	LongestTradeDurationMs int64
	MaxSafetyOrdersUsed    int
}

// OnPositionClose records a closed position's duration and safety order depth.
// openedAtMs: entry candle timestamp in epoch milliseconds.
// closedAtMs: close candle timestamp in epoch milliseconds.
// safetyOrdersFilled: count of safety orders triggered for this position.
func (k *KpiTracker) OnPositionClose(openedAtMs, closedAtMs int64, safetyOrdersFilled int) {
	durationMs := closedAtMs - openedAtMs
	if durationMs > k.LongestTradeDurationMs {
		k.LongestTradeDurationMs = durationMs
	}
	if safetyOrdersFilled > k.MaxSafetyOrdersUsed {
		k.MaxSafetyOrdersUsed = safetyOrdersFilled
	}
}

// OnBacktestEnd handles positions still open when the backtest finishes.
// lastCandleMs: timestamp of the last candle processed by the engine.
func (k *KpiTracker) OnBacktestEnd(openedAtMs, lastCandleMs int64, safetyOrdersFilled int) {
	k.OnPositionClose(openedAtMs, lastCandleMs, safetyOrdersFilled)
}
