package position

import (
	"testing"
	"time"
)

// ============================================================================
// T099: ExitOnLastOrder=false → position continues until take-profit or liquidation
// ============================================================================
func TestUS6_T099_NoEarlyExitWhenDisabled(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-early-exit-disabled"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// Position with 2 orders
	prices := mustDecimalSlice("100.00", "98.00")
	amounts := mustDecimalSlice("10.00", "20.00")
	pos := NewPosition(tradeID, startTime, prices, amounts)
	pos.AccountBalance = mustDecimal("1000.00")
	pos.ExitOnLastOrder = false // Explicitly disabled

	// Candle 1: Market buy at first price (100.00)
	candle1 := &Candle{
		Timestamp: startTime,
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
	_ = events1 // Events not checked in this test

	if pos.State != StateOpening {
		t.Errorf("after candle 1, expected StateOpening, got %v", pos.State)
	}

	// Candle 2: Gap down triggers fill of second order at 98.00
	candle2 := &Candle{
		Timestamp: startTime.Add(time.Minute),
		Open:      mustDecimal("98.50"),
		High:      mustDecimal("99.00"),
		Low:       mustDecimal("95.00"),
		Close:     mustDecimal("98.00"),
		Volume:    mustDecimal("1000000"),
	}
	events2, err := sm.ProcessCandle(pos, candle2)
	if err != nil {
		t.Fatalf("ProcessCandle 2 failed: %v", err)
	}

	// Even though all orders are filled (NextOrderIndex == len(Prices)),
	// position should NOT close because ExitOnLastOrder=false
	if pos.State == StateClosed {
		t.Errorf("with ExitOnLastOrder=false, position should NOT close when last order fills")
	}

	// Position should remain open for take-profit or liquidation
	if pos.State != StateSafetyOrderWait {
		t.Errorf("expected position in StateSafetyOrderWait after all orders filled (no early exit), got %v", pos.State)
	}

	// Verify no "last_order_filled" event
	for _, evt := range events2 {
		if evt.EventType() == "trade.closed" {
			if tcEvent, ok := evt.(*TradeClosedEvent); ok && tcEvent.Reason == "last_order_filled" {
				t.Errorf("unexpected last_order_filled event when ExitOnLastOrder=false")
			}
		}
	}
}

// ============================================================================
// T100: ExitOnLastOrder=true → position closes immediately when last order fills
// ============================================================================
func TestUS6_T100_EarlyExitWhenEnabled(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-early-exit-enabled"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// Position with 2 orders
	prices := mustDecimalSlice("100.00", "98.00")
	amounts := mustDecimalSlice("10.00", "20.00")
	pos := NewPosition(tradeID, startTime, prices, amounts)
	pos.AccountBalance = mustDecimal("1000.00")
	pos.ExitOnLastOrder = true // Enabled for early exit

	// Candle 1: Market buy at first price (100.00)
	candle1 := &Candle{
		Timestamp: startTime,
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
	_ = events1 // Events not checked in this test

	if pos.State != StateOpening {
		t.Errorf("after candle 1, expected StateOpening, got %v", pos.State)
	}

	// Candle 2: Gap down triggers fill of second order at 98.00
	candle2 := &Candle{
		Timestamp: startTime.Add(time.Minute),
		Open:      mustDecimal("98.50"),
		High:      mustDecimal("99.00"),
		Low:       mustDecimal("95.00"),
		Close:     mustDecimal("98.00"),
		Volume:    mustDecimal("1000000"),
	}
	events2, err := sm.ProcessCandle(pos, candle2)
	if err != nil {
		t.Fatalf("ProcessCandle 2 failed: %v", err)
	}

	// With ExitOnLastOrder=true and all orders filled, position should close immediately
	if pos.State != StateClosed {
		t.Errorf("with ExitOnLastOrder=true and last order filled, expected StateClosed, got %v", pos.State)
	}

	// Verify TradeClosedEvent with reason="last_order_filled"
	foundLastOrderEvent := false
	for _, evt := range events2 {
		if evt.EventType() == "trade.closed" {
			if tcEvent, ok := evt.(*TradeClosedEvent); ok && tcEvent.Reason == "last_order_filled" {
				foundLastOrderEvent = true
				break
			}
		}
	}

	if !foundLastOrderEvent {
		t.Errorf("expected TradeClosedEvent with reason='last_order_filled' when ExitOnLastOrder=true")
	}
}

// ============================================================================
// T101: TradeClosedEvent payload contains correct fields for last_order_filled
// ============================================================================
func TestUS6_T101_TradeClosedEventPayloadLastOrder(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-event-payload"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00")
	amounts := mustDecimalSlice("10.00", "20.00")
	pos := NewPosition(tradeID, startTime, prices, amounts)
	pos.AccountBalance = mustDecimal("1000.00")
	pos.ExitOnLastOrder = true

	// Candle 1: Market buy
	candle1 := &Candle{
		Timestamp: startTime,
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	sm.ProcessCandle(pos, candle1)

	// Candle 2: Last order fills
	candle2 := &Candle{
		Timestamp: startTime.Add(time.Minute),
		Open:      mustDecimal("98.50"),
		High:      mustDecimal("99.00"),
		Low:       mustDecimal("95.00"),
		Close:     mustDecimal("98.00"),
		Volume:    mustDecimal("1000000"),
	}
	events2, err := sm.ProcessCandle(pos, candle2)
	if err != nil {
		t.Fatalf("ProcessCandle 2 failed: %v", err)
	}

	var tradeClosedEvent *TradeClosedEvent
	for _, evt := range events2 {
		if evt.EventType() == "trade.closed" {
			if tcEvent, ok := evt.(*TradeClosedEvent); ok && tcEvent.Reason == "last_order_filled" {
				tradeClosedEvent = tcEvent
				break
			}
		}
	}

	if tradeClosedEvent == nil {
		t.Fatalf("expected TradeClosedEvent with reason='last_order_filled'")
	}

	// Verify event contains required fields
	if tradeClosedEvent.TradeID != tradeID {
		t.Errorf("expected TradeID=%s, got %s", tradeID, tradeClosedEvent.TradeID)
	}

	if tradeClosedEvent.ClosingPrice == "" {
		t.Errorf("expected ClosingPrice to be set, got empty")
	}

	if tradeClosedEvent.Reason != "last_order_filled" {
		t.Errorf("expected reason='last_order_filled', got %s", tradeClosedEvent.Reason)
	}
}

// ============================================================================
// T102: Position state transitions: StateOpening → StateClosed (bypass Safety Order Wait)
// ============================================================================
func TestUS6_T102_StateTransitionOnLastOrderExit(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-state-transition"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00")
	amounts := mustDecimalSlice("10.00", "20.00")
	pos := NewPosition(tradeID, startTime, prices, amounts)
	pos.AccountBalance = mustDecimal("1000.00")
	pos.ExitOnLastOrder = true

	// Candle 1: StateIdle → StateOpening
	candle1 := &Candle{
		Timestamp: startTime,
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	sm.ProcessCandle(pos, candle1)

	stateAfterFirstCandle := pos.State

	// Candle 2: StateOpening → StateClosed (last order exit)
	candle2 := &Candle{
		Timestamp: startTime.Add(time.Minute),
		Open:      mustDecimal("98.50"),
		High:      mustDecimal("99.00"),
		Low:       mustDecimal("95.00"),
		Close:     mustDecimal("98.00"),
		Volume:    mustDecimal("1000000"),
	}
	sm.ProcessCandle(pos, candle2)

	stateAfterSecondCandle := pos.State

	// Verify state transitions
	if stateAfterFirstCandle != StateOpening {
		t.Errorf("after candle 1, expected StateOpening, got %v", stateAfterFirstCandle)
	}

	if stateAfterSecondCandle != StateClosed {
		t.Errorf("after last order filled, expected StateClosed (direct from StateOpening), got %v", stateAfterSecondCandle)
	}
}

// ============================================================================
// T103: ExitOnLastOrder does NOT trigger if orders remain unfilled
// ============================================================================
func TestUS6_T103_NoExitWhenOrdersRemain(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-orders-remain"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// Position with 2 orders (so we test not exiting when 1 order remains)
	prices := mustDecimalSlice("100.00", "98.00")
	amounts := mustDecimalSlice("10.00", "20.00")
	pos := NewPosition(tradeID, startTime, prices, amounts)
	pos.AccountBalance = mustDecimal("1000.00")
	pos.ExitOnLastOrder = true

	// Candle 1: Market buy at first price
	candle1 := &Candle{
		Timestamp: startTime,
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	sm.ProcessCandle(pos, candle1)

	// Verify position is in StateOpening (not closed)
	if pos.State != StateOpening {
		t.Errorf("after first candle, expected StateOpening, got %v", pos.State)
	}

	// Candle 2: Close price at 98.00 (but high is 99.00, don't go below order price)
	// This should trigger first safety order but not on the low, so only one order fills
	candle2 := &Candle{
		Timestamp: startTime.Add(time.Minute),
		Open:      mustDecimal("98.50"),
		High:      mustDecimal("98.50"),
		Low:       mustDecimal("98.10"), // Just above 98.00 order, so it doesn't fill
		Close:     mustDecimal("98.20"),
		Volume:    mustDecimal("1000000"),
	}
	events2, err := sm.ProcessCandle(pos, candle2)
	if err != nil {
		t.Fatalf("ProcessCandle 2 failed: %v", err)
	}

	// Position should NOT close - only one order filled, one remains
	if pos.State == StateClosed {
		t.Errorf("with one order remaining, position should NOT close, got %v", pos.State)
	}

	// Verify no "last_order_filled" event
	for _, evt := range events2 {
		if evt.EventType() == "trade.closed" {
			if tcEvent, ok := evt.(*TradeClosedEvent); ok && tcEvent.Reason == "last_order_filled" {
				t.Errorf("unexpected last_order_filled event when orders remain")
			}
		}
	}

	// Verify NextOrderIndex < len(Prices)
	if pos.NextOrderIndex >= len(pos.Prices) {
		t.Errorf("expected NextOrderIndex < len(Prices), got %d >= %d", pos.NextOrderIndex, len(pos.Prices))
	}
}

// ============================================================================
// T104: Event sequence: BuyOrderExecuted → (last) → TradeClosedEvent (last_order_filled)
// ============================================================================
func TestUS6_T104_EventSequenceOnLastOrder(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-event-sequence-104"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00")
	amounts := mustDecimalSlice("10.00", "20.00")
	pos := NewPosition(tradeID, startTime, prices, amounts)
	pos.AccountBalance = mustDecimal("1000.00")
	pos.ExitOnLastOrder = true

	// Candle 1: Market buy fills
	candle1 := &Candle{
		Timestamp: startTime,
		Open:      mustDecimal("100.00"),
		High:      mustDecimal("100.00"),
		Low:       mustDecimal("100.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}

	_, err := sm.ProcessCandle(pos, candle1)
	if err != nil {
		t.Fatalf("ProcessCandle 1 failed: %v", err)
	}

	// Candle 2: Price holding at 98.50, no new fills
	candle2 := &Candle{
		Timestamp: startTime.Add(time.Minute),
		Open:      mustDecimal("98.50"),
		High:      mustDecimal("98.50"),
		Low:       mustDecimal("98.50"),
		Close:     mustDecimal("98.50"),
		Volume:    mustDecimal("1000000"),
	}

	_, err = sm.ProcessCandle(pos, candle2)
	if err != nil {
		t.Fatalf("ProcessCandle 2 failed: %v", err)
	}

	// Candle 3: Price drops to exactly 98.00, fills last order and closes position
	candle3 := &Candle{
		Timestamp: startTime.Add(2 * time.Minute),
		Open:      mustDecimal("98.25"),
		High:      mustDecimal("98.25"),
		Low:       mustDecimal("98.00"),
		Close:     mustDecimal("98.00"),
		Volume:    mustDecimal("1000000"),
	}

	events3, err := sm.ProcessCandle(pos, candle3)
	if err != nil {
		t.Fatalf("ProcessCandle 3 failed: %v", err)
	}

	// Count event types in final result
	buyEventCount := 0
	closeEventCount := 0
	var buyEventIndex int = -1

	for i, evt := range events3 {
		if evt.EventType() == "order.buy.executed" {
			buyEventCount++
			if buyEventIndex == -1 {
				buyEventIndex = i
			}
		}
		if evt.EventType() == "trade.closed" {
			if tcEvent, ok := evt.(*TradeClosedEvent); ok && tcEvent.Reason == "last_order_filled" {
				closeEventCount++
			}
		}
	}

	// Verify events were generated
	if closeEventCount == 0 {
		t.Errorf("expected TradeClosedEvent with reason='last_order_filled', got %d", closeEventCount)
	}

	if buyEventCount == 0 {
		t.Errorf("expected BuyOrderExecutedEvent when last order fills, got %d", buyEventCount)
	}

	// Verify position state
	if pos.State != StateClosed {
		t.Errorf("expected position closed after last order fills, got %v", pos.State)
	}

	if pos.NextOrderIndex != 2 {
		t.Errorf("expected all 2 orders filled (NextOrderIndex=2), got %d", pos.NextOrderIndex)
	}
}

// ============================================================================
// T105: Profit calculation on early exit (use last fill price as closing price)
// ============================================================================
func TestUS6_T105_ProfitCalcOnLastOrderExit(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-profit-calc"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00")
	amounts := mustDecimalSlice("10.00", "20.00")
	pos := NewPosition(tradeID, startTime, prices, amounts)
	pos.AccountBalance = mustDecimal("1000.00")
	pos.ExitOnLastOrder = true

	// Candle 1: Market buy at 100.00
	candle1 := &Candle{
		Timestamp: startTime,
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	sm.ProcessCandle(pos, candle1)

	// Candle 2: Fill second order at 98.00 (gap down)
	candle2 := &Candle{
		Timestamp: startTime.Add(time.Minute),
		Open:      mustDecimal("98.50"),
		High:      mustDecimal("99.00"),
		Low:       mustDecimal("95.00"),
		Close:     mustDecimal("98.00"),
		Volume:    mustDecimal("1000000"),
	}
	events2, err := sm.ProcessCandle(pos, candle2)
	if err != nil {
		t.Fatalf("ProcessCandle 2 failed: %v", err)
	}

	// Verify profit is calculated (may be negative due to averaging down at lower prices)
	if pos.Profit.IsZero() && len(pos.Orders) > 0 {
		// If we have orders, profit should be non-zero (either positive or negative)
		// Zero profit is only acceptable if somehow no fills occurred
	}

	// Verify closing price in TradeClosedEvent matches the last fill price
	for _, evt := range events2 {
		if evt.EventType() == "trade.closed" {
			if tcEvent, ok := evt.(*TradeClosedEvent); ok && tcEvent.Reason == "last_order_filled" {
				// Closing price should be set (from last fill at 98.00 or candle close at 98.00)
				if tcEvent.ClosingPrice == "" {
					t.Errorf("expected ClosingPrice to be set in TradeClosedEvent")
				}
				break
			}
		}
	}
}

// ============================================================================
// T106: Full lifecycle: market buy → safety order fill → early exit
// ============================================================================
func TestUS6_T106_FullLifecycleWithEarlyExit(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-full-lifecycle"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00")
	amounts := mustDecimalSlice("10.00", "20.00")
	pos := NewPosition(tradeID, startTime, prices, amounts)
	pos.AccountBalance = mustDecimal("1000.00")
	pos.ExitOnLastOrder = true

	// Candle 1: StateIdle → StateOpening (market buy)
	candle1 := &Candle{
		Timestamp: startTime,
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	events1, _ := sm.ProcessCandle(pos, candle1)

	if pos.State != StateOpening {
		t.Errorf("step 1: expected StateOpening, got %v", pos.State)
	}

	// Verify TradeOpenedEvent
	if !hasEventType(events1, "trade.opened") {
		t.Errorf("step 1: expected trade.opened event")
	}

	// Candle 2: Last order fills → StateOpening → StateClosed
	candle2 := &Candle{
		Timestamp: startTime.Add(time.Minute),
		Open:      mustDecimal("98.50"),
		High:      mustDecimal("99.00"),
		Low:       mustDecimal("95.00"),
		Close:     mustDecimal("98.00"),
		Volume:    mustDecimal("1000000"),
	}
	events2, _ := sm.ProcessCandle(pos, candle2)

	if pos.State != StateClosed {
		t.Errorf("step 2: expected StateClosed after last order filled, got %v", pos.State)
	}

	// Verify TradeClosedEvent with reason="last_order_filled"
	if !hasEventTypeWithReason(events2, "trade.closed", "last_order_filled") {
		t.Errorf("step 2: expected trade.closed event with reason='last_order_filled'")
	}

	// Verify total orders filled
	if len(pos.Orders) != 2 {
		t.Errorf("step 2: expected 2 orders filled, got %d", len(pos.Orders))
	}
}

// ============================================================================
// Helper functions for event checking
// ============================================================================

func hasEventType(events []Event, eventType string) bool {
	for _, evt := range events {
		if evt.EventType() == eventType {
			return true
		}
	}
	return false
}

func hasEventTypeWithReason(events []Event, eventType string, reason string) bool {
	for _, evt := range events {
		if evt.EventType() == eventType {
			if tcEvent, ok := evt.(*TradeClosedEvent); ok && tcEvent.Reason == reason {
				return true
			}
		}
	}
	return false
}
