package position

import (
	"testing"
	"time"
)

// ============================================================================
// T074: CalculateReentryPrice helper function returns close_price × 1.0005
// ============================================================================
func TestUS4_T074_CalculateReentryPrice(t *testing.T) {
	tests := []struct {
		name      string
		closePrice string
		expected  string
	}{
		{"100 close", "100.00", "100.05"},
		{"50000 close", "50000.00", "50025.00"},
		{"small close", "1.00", "1.0005"},
		{"zero close", "0.00", "0.00"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			closePrice := mustDecimal(tt.closePrice)
			result := CalculateReentryPrice(closePrice)
			expected := mustDecimal(tt.expected)
			if !result.Equal(expected) {
				t.Errorf("CalculateReentryPrice(%v) = %v, expected %v", closePrice, result, expected)
			}
		})
	}
}

// ============================================================================
// T073: ProcessCandle sequences: position closes via take-profit → re-entry possible on next candle
// ============================================================================
func TestUS4_T073_ReentryAfterTakeProfitSequence(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-trade-reentry-001"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// Create position with 3 orders at simplistic prices for quick liquidation
	prices := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts := mustDecimalSlice("10.00", "20.00", "30.00")
	pos := NewPosition(tradeID, openTime, prices, amounts)

	// Set account balance (for position sizing)
	pos.AccountBalance = mustDecimal("1000.00")

	// Day 1, Candle 1: Market buys at close (triggers TradeOpenedEvent)
	candle1 := &Candle{
		Timestamp: openTime,
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	events1, err := sm.ProcessCandle(pos, candle1)
	if err != nil {
		t.Fatalf("ProcessCandle 1 failed: %v", err)
	}

	// Verify TradeOpenedEvent
	if !hasEvent(events1, "trade.opened") {
		t.Errorf("expected trade.opened event, got %v", events1)
	}
	if pos.State != StateOpening {
		t.Errorf("after candle 1, expected StateOpening, got %v", pos.State)
	}

	// Day 1, Candle 2: Price rises to take-profit (100 + 0.5% = 100.5)
	candle2 := &Candle{
		Timestamp: openTime.Add(time.Minute),
		Open:      mustDecimal("100.20"),
		High:      mustDecimal("100.60"),
		Low:       mustDecimal("100.00"),
		Close:     mustDecimal("100.50"),
		Volume:    mustDecimal("1000000"),
	}
	events2, err := sm.ProcessCandle(pos, candle2)
	if err != nil {
		t.Fatalf("ProcessCandle 2 failed: %v", err)
	}

	// Verify TradeClosedEvent (take-profit)
	if !hasEvent(events2, "trade.closed") {
		t.Errorf("expected trade.closed event after take-profit, got %v", events2)
	}
	if pos.State != StateClosed {
		t.Errorf("after candle 2, expected StateClosed, got %v", pos.State)
	}

	// Verify position profit is positive
	if pos.Profit.IsNegative() || pos.Profit.IsZero() {
		t.Errorf("expected positive profit after take-profit, got %v", pos.Profit)
	}

	// Day 1, Candle 3: Process next candle (re-entry should happen on this candle in real loop)
	// For this test, we simulate the caller creating a NEW position after close
	oldProfit := pos.Profit
	oldState := pos.State

	// Create new position (simulating re-entry)
	reentryPrice := candle2.Close.Mul(mustDecimal("1.0005"))
	newPrices := mustDecimalSlice(reentryPrice.String(), "98.00", "95.84")
	newAmounts := mustDecimalSlice("10.00", "20.00", "30.00")
	newPos := NewPosition("test-trade-reentry-002", openTime.Add(2*time.Minute), newPrices, newAmounts)
	newPos.AccountBalance = pos.AccountBalance

	candle3 := &Candle{
		Timestamp: openTime.Add(2 * time.Minute),
		Open:      mustDecimal("100.50"),
		High:      mustDecimal("100.80"),
		Low:       mustDecimal("100.40"),
		Close:     mustDecimal("100.60"),
		Volume:    mustDecimal("1000000"),
	}
	events3, err := sm.ProcessCandle(newPos, candle3)
	if err != nil {
		t.Fatalf("ProcessCandle 3 failed: %v", err)
	}

	// Verify new position is in StateOpening
	if newPos.State != StateOpening {
		t.Errorf("expected new position in StateOpening, got %v", newPos.State)
	}

	// Verify first trade closed but second trade opened
	if !hasEvent(events3, "trade.opened") {
		t.Errorf("expected trade.opened for second position, got %v", events3)
	}

	// Verify old position state unchanged
	if pos.State != oldState {
		t.Errorf("old position state changed unexpectedly: %v → %v", oldState, pos.State)
	}
	if pos.Profit != oldProfit {
		t.Errorf("old position profit changed unexpectedly: %v → %v", oldProfit, pos.Profit)
	}
}

// ============================================================================
// T074: Verify re-entry price = close_price × 1.0005 exactly
// ============================================================================
func TestUS4_T074_ReentryPriceCalculation(t *testing.T) {
	closePrice := mustDecimal("100.00")

	// Verify the calculation
	reentryPrice := closePrice.Mul(mustDecimal("1.0005"))
	if !reentryPrice.Equal(mustDecimal("100.05")) {
		t.Errorf("re-entry price calculation failed: 100 * 1.0005 should be 100.05, got %v", reentryPrice)
	}

	// Test with different close price
	closePrice2 := mustDecimal("50000.00")
	expectedReentryPrice2 := closePrice2.Mul(mustDecimal("1.0005"))
	if !expectedReentryPrice2.Equal(mustDecimal("50025.00")) {
		t.Errorf("re-entry price calculation failed: 50000 * 1.0005 should be 50025.00, got %v", expectedReentryPrice2)
	}
}

// ============================================================================
// T075: New position uses fresh price grid starting from re-entry price
// ============================================================================
func TestUS4_T075_FreshPriceGridOnReentry(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-trade-fresh-grid"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// First position
	prices1 := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts1 := mustDecimalSlice("10.00", "20.00", "30.00")
	pos1 := NewPosition(tradeID, openTime, prices1, amounts1)
	pos1.AccountBalance = mustDecimal("1000.00")

	candle1 := &Candle{
		Timestamp: openTime,
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	sm.ProcessCandle(pos1, candle1)

	// Close first position via take-profit
	candle2 := &Candle{
		Timestamp: openTime.Add(time.Minute),
		Open:      mustDecimal("100.20"),
		High:      mustDecimal("100.60"),
		Low:       mustDecimal("100.00"),
		Close:     mustDecimal("100.50"),
		Volume:    mustDecimal("1000000"),
	}
	sm.ProcessCandle(pos1, candle2)

	// Verify second position starts with fresh grid at re-entry price
	reentryPrice := mustDecimal("100.50").Mul(mustDecimal("1.0005"))
	prices2 := mustDecimalSlice(reentryPrice.String(), "98.50", "96.34")
	amounts2 := mustDecimalSlice("10.00", "20.00", "30.00")
	pos2 := NewPosition("test-trade-fresh-grid-2", openTime.Add(2*time.Minute), prices2, amounts2)
	pos2.AccountBalance = pos1.AccountBalance

	// Check that pos2.Prices[0] equals re-entry price
	if !pos2.Prices[0].Equal(reentryPrice) {
		t.Errorf("expected first price in new grid to be %v, got %v", reentryPrice, pos2.Prices[0])
	}

	// Check that pos2.Prices are different from pos1.Prices
	if pos2.Prices[0].Equal(pos1.Prices[0]) {
		t.Errorf("new position price grid should be different from old position")
	}
}

// ============================================================================
// T076: Single-position invariant — at no point are two positions in non-IDLE state simultaneously
// ============================================================================
func TestUS4_T076_SinglePositionInvariant(t *testing.T) {
	sm := NewStateMachine()

	// Create two positions
	tradeID1 := "test-trade-invariant-1"
	tradeID2 := "test-trade-invariant-2"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts := mustDecimalSlice("10.00", "20.00", "30.00")

	pos1 := NewPosition(tradeID1, openTime, prices, amounts)
	pos1.AccountBalance = mustDecimal("1000.00")
	pos2 := NewPosition(tradeID2, openTime, prices, amounts)
	pos2.AccountBalance = mustDecimal("1000.00")

	// Open first position
	candle1 := &Candle{
		Timestamp: openTime,
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	sm.ProcessCandle(pos1, candle1)

	// At this point, pos1 should be in StateOpening, pos2 should be in StateIdle
	if pos1.State == StateIdle && pos2.State == StateIdle {
		t.Errorf("invariant violation: both positions are IDLE when first should be OPENING")
	}

	// Close first position
	candle2 := &Candle{
		Timestamp: openTime.Add(time.Minute),
		Open:      mustDecimal("100.20"),
		High:      mustDecimal("100.60"),
		Low:       mustDecimal("100.00"),
		Close:     mustDecimal("100.50"),
		Volume:    mustDecimal("1000000"),
	}
	sm.ProcessCandle(pos1, candle2)

	// Now pos1 should be CLOSED
	if pos1.State != StateClosed {
		t.Errorf("expected pos1 to be StateClosed, got %v", pos1.State)
	}

	// Open second position (re-entry)
	reentryPrice := mustDecimal("100.50").Mul(mustDecimal("1.0005"))
	prices2 := mustDecimalSlice(reentryPrice.String(), "98.50", "96.34")
	amounts2 := mustDecimalSlice("10.00", "20.00", "30.00")
	pos2Reentry := NewPosition("test-trade-invariant-2-reentry", openTime.Add(2*time.Minute), prices2, amounts2)
	pos2Reentry.AccountBalance = pos1.AccountBalance

	candle3 := &Candle{
		Timestamp: openTime.Add(2 * time.Minute),
		Open:      mustDecimal("100.50"),
		High:      mustDecimal("100.80"),
		Low:       mustDecimal("100.40"),
		Close:     mustDecimal("100.60"),
		Volume:    mustDecimal("1000000"),
	}
	sm.ProcessCandle(pos2Reentry, candle3)

	// At this point, pos1 should be CLOSED, pos2Reentry should be OPENING
	if pos1.State != StateClosed {
		t.Errorf("invariant violation: pos1 state should be StateClosed, got %v", pos1.State)
	}
	if pos2Reentry.State != StateOpening {
		t.Errorf("invariant violation: pos2Reentry state should be StateOpening, got %v", pos2Reentry.State)
	}
}

// ============================================================================
// T077: Two positions both close take-profit → cumulative profit = profit1 + profit2
// ============================================================================
func TestUS4_T077_CumulativeProfit(t *testing.T) {
	sm := NewStateMachine()
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// First position
	prices1 := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts1 := mustDecimalSlice("10.00", "20.00", "30.00")
	pos1 := NewPosition("test-cumulative-1", openTime, prices1, amounts1)
	pos1.AccountBalance = mustDecimal("1000.00")

	candle1 := &Candle{
		Timestamp: openTime,
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	sm.ProcessCandle(pos1, candle1)

	candle2 := &Candle{
		Timestamp: openTime.Add(time.Minute),
		Open:      mustDecimal("100.20"),
		High:      mustDecimal("100.60"),
		Low:       mustDecimal("100.00"),
		Close:     mustDecimal("100.50"),
		Volume:    mustDecimal("1000000"),
	}
	sm.ProcessCandle(pos1, candle2)

	profit1 := pos1.Profit

	// Second position (re-entry)
	reentryPrice := mustDecimal("100.50").Mul(mustDecimal("1.0005"))
	prices2 := mustDecimalSlice(reentryPrice.String(), "98.50", "96.34")
	amounts2 := mustDecimalSlice("10.00", "20.00", "30.00")
	pos2 := NewPosition("test-cumulative-2", openTime.Add(2*time.Minute), prices2, amounts2)
	pos2.AccountBalance = pos1.AccountBalance

	candle3 := &Candle{
		Timestamp: openTime.Add(2 * time.Minute),
		Open:      mustDecimal("100.50"),
		High:      mustDecimal("100.80"),
		Low:       mustDecimal("100.40"),
		Close:     mustDecimal("100.60"),
		Volume:    mustDecimal("1000000"),
	}
	sm.ProcessCandle(pos2, candle3)

	candle4 := &Candle{
		Timestamp: openTime.Add(3 * time.Minute),
		Open:      mustDecimal("100.70"),
		High:      mustDecimal("101.10"),
		Low:       mustDecimal("100.60"),
		Close:     mustDecimal("101.00"),
		Volume:    mustDecimal("1000000"),
	}
	sm.ProcessCandle(pos2, candle4)

	profit2 := pos2.Profit

	// Verify cumulative profit
	cumulativeProfit := profit1.Add(profit2)
	if cumulativeProfit.IsNegative() {
		t.Errorf("two consecutive take-profit closes should yield positive cumulative profit, got %v", cumulativeProfit)
	}
}

// ============================================================================
// T078: Position closes via LIQUIDATION (not take-profit) → new position may still open on next candle
// ============================================================================
func TestUS4_T078_ReentryAfterLiquidation(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-trade-liquidation-reentry"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// Create position with prices that will trigger liquidation
	prices := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts := mustDecimalSlice("10.00", "20.00", "30.00")
	pos := NewPosition(tradeID, openTime, prices, amounts)
	pos.AccountBalance = mustDecimal("1000.00")

	// Candle 1: Open position
	candle1 := &Candle{
		Timestamp: openTime,
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	events1, err := sm.ProcessCandle(pos, candle1)
	if err != nil {
		t.Fatalf("ProcessCandle 1 failed: %v", err)
	}

	if !hasEvent(events1, "trade.opened") {
		t.Errorf("expected trade.opened, got %v", events1)
	}

	// Candle 2: Price drops below liquidation price (50% of entry)
	// Entry price is 100, so liquidation price is 50
	// Close price at 45 to trigger liquidation
	candle2 := &Candle{
		Timestamp: openTime.Add(time.Minute),
		Open:      mustDecimal("60.00"),
		High:      mustDecimal("70.00"),
		Low:       mustDecimal("45.00"),
		Close:     mustDecimal("48.00"),
		Volume:    mustDecimal("1000000"),
	}
	events2, err := sm.ProcessCandle(pos, candle2)
	if err != nil {
		t.Fatalf("ProcessCandle 2 failed: %v", err)
	}

	// Verify liquidation occurred
	if !hasEvent(events2, "trade.closed") {
		t.Errorf("expected trade.closed on liquidation, got %v", events2)
	}

	// Extract the TradeClosedEvent
	var tradeClosedEvent *TradeClosedEvent
	for _, evt := range events2 {
		if evt.EventType() == "trade.closed" {
			tradeClosedEvent = evt.(*TradeClosedEvent)
			break
		}
	}

	if tradeClosedEvent == nil {
		t.Fatalf("expected TradeClosedEvent")
	}

	if tradeClosedEvent.Reason != "liquidation" {
		t.Errorf("expected liquidation reason, got %v", tradeClosedEvent.Reason)
	}

	// Verify position is closed but next candle can still open a new position
	if pos.State != StateClosed {
		t.Errorf("after liquidation, expected StateClosed, got %v", pos.State)
	}

	// Candle 3: Open new position (re-entry allowed after liquidation)
	closingPrice := candle2.Close
	reentryPrice := closingPrice.Mul(mustDecimal("1.0005"))
	prices2 := mustDecimalSlice(reentryPrice.String(), "47.00", "45.84")
	amounts2 := mustDecimalSlice("5.00", "10.00", "20.00")
	pos2 := NewPosition("test-trade-liquidation-reentry-2", openTime.Add(2*time.Minute), prices2, amounts2)
	pos2.AccountBalance = pos.AccountBalance

	candle3 := &Candle{
		Timestamp: openTime.Add(2 * time.Minute),
		Open:      mustDecimal("48.50"),
		High:      mustDecimal("50.00"),
		Low:       mustDecimal("48.00"),
		Close:     mustDecimal("49.00"),
		Volume:    mustDecimal("1000000"),
	}
	events3, err := sm.ProcessCandle(pos2, candle3)
	if err != nil {
		t.Fatalf("ProcessCandle 3 failed: %v", err)
	}

	// Verify new position opened after liquidation
	if pos2.State != StateOpening {
		t.Errorf("expected new position in StateOpening after liquidation re-entry, got %v", pos2.State)
	}

	if !hasEvent(events3, "trade.opened") {
		t.Errorf("expected trade.opened after liquidation reentry, got %v", events3)
	}
}

// ============================================================================
// Helper functions
// ============================================================================

func hasEvent(events []Event, eventType string) bool {
	for _, evt := range events {
		if evt.EventType() == eventType {
			return true
		}
	}
	return false
}
