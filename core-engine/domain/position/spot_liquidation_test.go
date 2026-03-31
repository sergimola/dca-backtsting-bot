package position

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

// ============================================================================
// TS014_US1: Spot Survival — position with Multiplier=1 must survive a
// catastrophic price drop without liquidating.
// Spec: spec.md US1, Canonical Test Data rows 1–2
// ============================================================================
func TestTS014_US1_SpotSurvivesCatastrophicDrop(t *testing.T) {
	sm := NewStateMachine()
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	pos := NewPosition("ts014-us1-001", startTime, prices, amounts)
	pos.Multiplier = decimal.NewFromInt(1)
	pos.TakeProfitDistance = decimal.NewFromFloat(0.5)

	// Candle 1: market open at $100.00 (entry candle — same timestamp as OpenTimestamp)
	candle1 := &Candle{
		Timestamp: startTime,
		Open:      mustDecimal("100.00"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	_, err := sm.ProcessCandle(pos, candle1)
	if err != nil {
		t.Fatalf("candle 1 failed: %v", err)
	}
	if pos.State != StateOpening {
		t.Fatalf("expected StateOpening after market buy, got %v", pos.State)
	}

	// Candle 2: catastrophic 99% drop — low=$1.00, high=$1.50 (well below TP target ~$100.50)
	// Without the fix, the half-formula sets LiquidationPrice≈$50 after an SO fill and Step 3c fires.
	// With the fix, LiquidationPrice stays $0 for Multiplier=1 and no liquidation occurs.
	candle2 := &Candle{
		Timestamp: startTime.Add(1 * time.Minute),
		Open:      mustDecimal("2.00"),
		High:      mustDecimal("1.50"),
		Low:       mustDecimal("1.00"),
		Close:     mustDecimal("1.20"),
		Volume:    mustDecimal("500000"),
	}
	events2, err := sm.ProcessCandle(pos, candle2)
	if err != nil {
		t.Fatalf("candle 2 failed: %v", err)
	}

	// Assert: position must NOT be closed
	if pos.State == StateClosed {
		t.Errorf("US1: position was incorrectly liquidated on candle 2; state = StateClosed")
	}

	// Assert: no trade.closed event emitted
	for _, evt := range events2 {
		if evt.EventType() == "trade.closed" {
			if tc, ok := evt.(*TradeClosedEvent); ok {
				t.Errorf("US1: unexpected trade.closed event on candle 2, reason=%q", tc.Reason)
			} else {
				t.Errorf("US1: unexpected trade.closed event on candle 2")
			}
		}
	}

	// Assert: LiquidationPrice is exactly 0 (FR-001, FR-002, Canonical Test Data row 2)
	if !pos.LiquidationPrice.Equal(decimal.Zero) {
		t.Errorf("US1: LiquidationPrice must be 0 for Multiplier=1, got %s", pos.LiquidationPrice.String())
	}

	// Assert: Multiplier field reads back correctly
	if !pos.Multiplier.Equal(decimal.NewFromInt(1)) {
		t.Errorf("US1: pos.Multiplier should be 1, got %s", pos.Multiplier.String())
	}
}

// ============================================================================
// TS014_US2: Futures Non-Regression — position with Multiplier=2 must still
// liquidate correctly when candle low breaches LiquidationPrice.
// Spec: spec.md US2, Canonical Test Data rows 4–5
// ============================================================================
func TestTS014_US2_FuturesLiquidatesCorrectly(t *testing.T) {
	sm := NewStateMachine()
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	pos := NewPosition("ts014-us2-001", startTime, prices, amounts)
	pos.Multiplier = decimal.NewFromInt(2) // futures
	pos.TakeProfitDistance = decimal.NewFromFloat(0.5)

	// Candle 1: market open at $100.00
	candle1 := &Candle{
		Timestamp: startTime,
		Open:      mustDecimal("100.00"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	if _, err := sm.ProcessCandle(pos, candle1); err != nil {
		t.Fatalf("candle 1 failed: %v", err)
	}

	// Candle 2: low=$97.00 triggers safety order fill at $98.00
	// After fill: avg entry recalculates; LiquidationPrice (half-formula) ≈ avg/2 ≈ $49.xx
	// The candle low $97.00 is well above $49.xx, so NO liquidation on this candle.
	candle2 := &Candle{
		Timestamp: startTime.Add(1 * time.Minute),
		Open:      mustDecimal("99.00"),
		High:      mustDecimal("98.50"),
		Low:       mustDecimal("97.00"), // < P[1]=98.00 → safety order fills
		Close:     mustDecimal("97.50"),
		Volume:    mustDecimal("900000"),
	}
	if _, err := sm.ProcessCandle(pos, candle2); err != nil {
		t.Fatalf("candle 2 failed: %v", err)
	}
	// After candle 2, safety order should have filled; LiquidationPrice should be non-zero
	if pos.LiquidationPrice.IsZero() {
		t.Fatalf("US2: expected non-zero LiquidationPrice after SO fill for Multiplier=2, got 0")
	}
	if pos.State == StateClosed {
		t.Fatalf("US2: position should not be closed after candle 2 (low=$97, liq≈$49)")
	}

	// Candle 3: catastrophic drop — low=$20.00, well below LiquidationPrice≈$49.xx
	candle3 := &Candle{
		Timestamp: startTime.Add(2 * time.Minute),
		Open:      mustDecimal("50.00"),
		High:      mustDecimal("40.00"),
		Low:       mustDecimal("20.00"),
		Close:     mustDecimal("25.00"),
		Volume:    mustDecimal("800000"),
	}
	events3, err := sm.ProcessCandle(pos, candle3)
	if err != nil {
		t.Fatalf("candle 3 failed: %v", err)
	}

	// Assert: position must be closed via liquidation
	if pos.State != StateClosed {
		t.Errorf("US2: expected StateClosed after liquidation candle, got %v", pos.State)
	}

	// Assert: TradeClosedEvent with reason="liquidation"
	foundLiquidation := false
	for _, evt := range events3 {
		if tc, ok := evt.(*TradeClosedEvent); ok {
			if tc.Reason == "liquidation" {
				foundLiquidation = true
			} else {
				t.Errorf("US2: TradeClosedEvent reason=%q, want 'liquidation'", tc.Reason)
			}
		}
	}
	if !foundLiquidation {
		t.Errorf("US2: expected TradeClosedEvent with reason='liquidation', none found in %d events", len(events3))
	}

	// Assert: loss is negative (full loss)
	if !pos.Profit.IsNegative() {
		t.Errorf("US2: expected negative profit on liquidation, got %s", pos.Profit.String())
	}
}

// ============================================================================
// TS014_US3: Spot Closes via Take Profit — a spot position that survives a dip
// must still be able to close via Take Profit when price recovers.
// Spec: spec.md US3, Canonical Test Data row 6
// ============================================================================
func TestTS014_US3_SpotClosesViaTakeProfit(t *testing.T) {
	sm := NewStateMachine()
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	pos := NewPosition("ts014-us3-001", startTime, prices, amounts)
	pos.Multiplier = decimal.NewFromInt(1) // spot
	pos.TakeProfitDistance = decimal.NewFromFloat(0.5)

	// Candle 1: market open at $100.00; TP target will be set to ≈$100.50
	candle1 := &Candle{
		Timestamp: startTime,
		Open:      mustDecimal("100.00"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	if _, err := sm.ProcessCandle(pos, candle1); err != nil {
		t.Fatalf("candle 1 failed: %v", err)
	}

	// Candle 2: catastrophic drop to $50.00 — must NOT liquidate (Multiplier=1)
	// Without the fix, the half-formula after SO fill would set LiquidationPrice≈$49
	// and this exact $50 low would trigger it. With the fix, LiquidationPrice stays $0.
	candle2 := &Candle{
		Timestamp: startTime.Add(1 * time.Minute),
		Open:      mustDecimal("99.00"),
		High:      mustDecimal("60.00"),
		Low:       mustDecimal("50.00"), // < P[1]=98.00 → SO fills; without fix, liquidates
		Close:     mustDecimal("55.00"),
		Volume:    mustDecimal("800000"),
	}
	events2, err := sm.ProcessCandle(pos, candle2)
	if err != nil {
		t.Fatalf("candle 2 failed: %v", err)
	}
	// Candle 2 must NOT close the position — that would mean liquidation fired
	if pos.State == StateClosed {
		for _, evt := range events2 {
			if tc, ok := evt.(*TradeClosedEvent); ok {
				t.Fatalf("US3: position prematurely closed on candle 2, reason=%q (liquidation fix not working)", tc.Reason)
			}
		}
		t.Fatalf("US3: position closed on candle 2 (should have survived the dip)")
	}

	// Candle 3: recovery — high=$101.00 exceeds TP target ≈$100.50
	candle3 := &Candle{
		Timestamp: startTime.Add(2 * time.Minute),
		Open:      mustDecimal("100.00"),
		High:      mustDecimal("101.00"), // > TP target ≈$100.50
		Low:       mustDecimal("99.50"),
		Close:     mustDecimal("100.80"),
		Volume:    mustDecimal("700000"),
	}
	events3, err := sm.ProcessCandle(pos, candle3)
	if err != nil {
		t.Fatalf("candle 3 failed: %v", err)
	}

	// Assert: position closes via take profit
	if pos.State != StateClosed {
		t.Errorf("US3: expected StateClosed after TP candle, got %v", pos.State)
	}

	// Assert: TradeClosedEvent with reason="take_profit"
	foundTP := false
	for _, evt := range events3 {
		if tc, ok := evt.(*TradeClosedEvent); ok {
			if tc.Reason == "take_profit" {
				foundTP = true
			} else {
				t.Errorf("US3: TradeClosedEvent reason=%q, want 'take_profit'", tc.Reason)
			}
		}
	}
	if !foundTP {
		t.Errorf("US3: expected TradeClosedEvent with reason='take_profit', none found in %d events", len(events3))
	}

	// Assert: profit is positive
	if !pos.Profit.IsPositive() {
		t.Errorf("US3: expected positive profit on take_profit close, got %s", pos.Profit.String())
	}
}
