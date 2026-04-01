// Package config — Pre-Flight DCA ladder estimation.
//
// ComputePreFlight calculates the safety-order ladder for a given Config
// without any historical data or ClickHouse I/O.  It is a static, deterministic
// analysis of capital requirements and drawdown coverage.
//
// The trigger price percentages use an additive cumulative model:
//
//	step_k   = δ × s_p^{k-1}
//	cumul_k  = Σ step_j  for j=1..k
//	trigger% = -cumul_k
//
// This matches the spec §Canonical Test Data binding vectors.
//
// Order sizes are derived from the existing ComputeAmountSequence which
// distributes the total volume V across N orders using a geometric series.
package config

import (
	"github.com/shopspring/decimal"
)

// PreFlightLadderEntry represents one rung of the DCA safety-order ladder.
type PreFlightLadderEntry struct {
	Level           int             `json:"level"`
	TriggerPricePct decimal.Decimal `json:"trigger_price_pct"`
	TriggerPrice    decimal.Decimal `json:"trigger_price"`
	OrderSize       decimal.Decimal `json:"order_size"`
	CumulativeCost  decimal.Decimal `json:"cumulative_cost"`
}

// PreFlightResult is the output of ComputePreFlight.
type PreFlightResult struct {
	RunID                string               `json:"run_id,omitempty"`
	MaxDrawdownCoveredPct decimal.Decimal      `json:"max_drawdown_covered_pct"`
	TotalCapitalRequired  decimal.Decimal      `json:"total_capital_required"`
	Ladder               []PreFlightLadderEntry `json:"ladder"`
}

// ComputePreFlight calculates the DCA ladder for the given Config.
//
// It uses a normalized $100 entry price for trigger_price computation,
// the additive cumulative deviation model for trigger_price_pct, and
// ComputeAmountSequence for order sizing.
//
// When numberOfOrders == 1 (base only, zero safety orders), the result
// contains an empty ladder, zero drawdown, and total capital = base order size.
func ComputePreFlight(cfg *Config) (*PreFlightResult, error) {
	N := cfg.NumberOfOrders()

	// Compute amount sequence — order sizes for all N orders (base + safety).
	// dynamicBalance = accountBalance for percentage-mode amountPerTrade.
	amounts, err := cfg.ComputeAmountSequence(cfg.AccountBalance())
	if err != nil {
		return nil, err
	}

	totalCapital := amounts.Sum()

	// Base-only case: no safety orders.
	if N <= 1 {
		return &PreFlightResult{
			MaxDrawdownCoveredPct: decimal.Zero,
			TotalCapitalRequired:  totalCapital.Round(precision),
			Ladder:               nil,
		}, nil
	}

	normalizedEntry := decimal.NewFromInt(100)
	delta := cfg.PriceEntry()  // δ — base deviation percentage
	sp := cfg.PriceScale()     // s_p — geometric scale factor

	ladder := make([]PreFlightLadderEntry, 0, N-1)
	cumulativePct := decimal.Zero
	cumulativeCost := amounts[0] // start with base order (D_0)

	for i := 1; i < N; i++ {
		// Additive step: δ × s_p^{i-1}
		exp := decimal.NewFromInt(int64(i - 1))
		step := delta.Mul(sp.Pow(exp))
		cumulativePct = cumulativePct.Add(step)

		triggerPricePct := cumulativePct.Neg().Round(precision)
		triggerPrice := normalizedEntry.Mul(
			decimal.NewFromInt(1).Sub(cumulativePct.Div(hundred)),
		).Round(precision)

		cumulativeCost = cumulativeCost.Add(amounts[i])

		ladder = append(ladder, PreFlightLadderEntry{
			Level:           i,
			TriggerPricePct: triggerPricePct,
			TriggerPrice:    triggerPrice,
			OrderSize:       amounts[i],
			CumulativeCost:  cumulativeCost.Round(precision),
		})
	}

	maxDrawdown := decimal.Zero
	if len(ladder) > 0 {
		maxDrawdown = ladder[len(ladder)-1].TriggerPricePct
	}

	return &PreFlightResult{
		MaxDrawdownCoveredPct: maxDrawdown,
		TotalCapitalRequired:  totalCapital.Round(precision),
		Ladder:               ladder,
	}, nil
}
