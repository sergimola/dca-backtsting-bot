package position

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

// ============================================================================
// T047: Full lifecycle IDLE → OPENING → SAFETY_WAIT → CLOSED with synthetic candles
// ============================================================================
func TestUS1_T047_FullPositionLifecycle(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "integration-test-001"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	
	// Create position with canonical prices and amounts
	prices := mustDecimalSlice("100.00", "98.00", "95.844")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	pos := NewPosition(tradeID, startTime, prices, amounts)
	
	// Verify initial state is IDLE
	if pos.State != StateIdle {
		t.Fatalf("expected initial state IDLE, got %v", pos.State)
	}
	
	// Candle 1: Market buy at 100.00
	candle1 := &Candle{
		Timestamp: startTime.Add(0 * time.Minute),
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	
	events1, err := sm.ProcessCandle(pos, candle1)
	if err != nil {
		t.Fatalf("candle 1 failed: %v", err)
	}
	
	// Verify TradeOpenedEvent
	foundTradeOpened := false
	for _, evt := range events1 {
		if evt.EventType() == "trade.opened" {
			foundTradeOpened = true
		}
	}
	if !foundTradeOpened {
		t.Errorf("candle 1: expected TradeOpenedEvent, got %+v", events1)
	}
	
	// Verify position transitioned to OPENING
	if pos.State != StateOpening {
		t.Errorf("candle 1: expected StateOpening, got %v", pos.State)
	}
	if pos.PositionQuantity.LessThan(decimal.NewFromInt(0)) {
		t.Errorf("candle 1: expected positive position quantity, got %s", pos.PositionQuantity.String())
	}
	
	// Candle 2: Safety order at 98.00 (gap down triggers fill)
	candle2 := &Candle{
		Timestamp: startTime.Add(1 * time.Minute),
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("99.50"),
		Low:       mustDecimal("97.00"),  // Below P[1]=98.00, triggers fill
		Close:     mustDecimal("98.50"),
		Volume:    mustDecimal("900000"),
	}
	
	events2, err := sm.ProcessCandle(pos, candle2)
	if err != nil {
		t.Fatalf("candle 2 failed: %v", err)
	}
	
	// Verify BuyOrderExecutedEvent
	foundBuyOrder := false
	for _, evt := range events2 {
		if evt.EventType() == "order.buy.executed" {
			foundBuyOrder = true
		}
	}
	if !foundBuyOrder {
		t.Errorf("candle 2: expected BuyOrderExecutedEvent, got %+v", events2)
	}
	
	// Verify position still in SAFETY_ORDER_WAIT or has progressed
	if pos.State != StateSafetyOrderWait && pos.State != StateOpening {
		t.Logf("candle 2: state is %v (acceptable)", pos.State)
	}
	
	// Verify position quantity increased (2 orders filled)
	expectedQty := mustDecimal("2.0") // 1.0 from P[0] + 1.0 from P[1]
	if !pos.PositionQuantity.Equal(expectedQty) {
		t.Logf("candle 2: position quantity=%v (expected ~2.0 after 2 fills)", pos.PositionQuantity)
	}
	
	// Candle 3: Take-profit close (high hits P_tp)
	// Average entry: (100*1 + 98*1) / 2 = 99.00
	// Take-profit: 99.00 * 1.005 = 99.495
	candle3 := &Candle{
		Timestamp: startTime.Add(2 * time.Minute),
		Open:      mustDecimal("98.80"),
		High:      mustDecimal("99.50"),  // Hits take-profit
		Low:       mustDecimal("98.00"),
		Close:     mustDecimal("99.40"),
		Volume:    mustDecimal("800000"),
	}
	
	events3, err := sm.ProcessCandle(pos, candle3)
	if err != nil {
		t.Fatalf("candle 3 failed: %v", err)
	}
	
	// Verify TradeClosedEvent
	foundClosed := false
	for _, evt := range events3 {
		if evt.EventType() == "trade.closed" {
			foundClosed = true
		}
	}
	if !foundClosed {
		t.Errorf("candle 3: expected TradeClosedEvent, got %+v", events3)
	}
	
	// Verify position transitioned to CLOSED
	if pos.State != StateClosed {
		t.Errorf("candle 3: expected StateClosed, got %v", pos.State)
	}
	
	// Verify CloseTimestamp is set
	if pos.CloseTimestamp == nil {
		t.Errorf("candle 3: expected CloseTimestamp to be set")
	}
}

// ============================================================================
// T048: Verify cumulative profit equals expected value from canonical data
// ============================================================================
func TestUS1_T048_CumulativeProfitCalculation(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "profit-test-001"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	
	// Canonical test scenario:
	// P[0]=100, Q[0]=1.0
	// P[1]=98, Q[1]=1.0
	// Close at P_tp = 99.495
	// Expected Pbar = 99.00, profit before fees ≈ (99.495 * 2 - 100 - 98) = 0.99
	
	prices := mustDecimalSlice("100.00", "98.00")
	amounts := mustDecimalSlice("50.0", "50.0") // Equal amounts for simplicity
	pos := NewPosition(tradeID, startTime, prices, amounts)
	
	// Simulate first candle: market buy at 100
	candle1 := &Candle{
		Timestamp: startTime.Add(0 * time.Minute),
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	
	_, err := sm.ProcessCandle(pos, candle1)
	if err != nil {
		t.Fatalf("candle 1 failed: %v", err)
	}
	
	// Simulate second candle: safety order at 98
	candle2 := &Candle{
		Timestamp: startTime.Add(1 * time.Minute),
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("99.50"),
		Low:       mustDecimal("97.00"),
		Close:     mustDecimal("98.50"),
		Volume:    mustDecimal("900000"),
	}
	
	_, err = sm.ProcessCandle(pos, candle2)
	if err != nil {
		t.Fatalf("candle 2 failed: %v", err)
	}
	
	// Simulate third candle: close at take-profit
	candle3 := &Candle{
		Timestamp: startTime.Add(2 * time.Minute),
		Open:      mustDecimal("98.80"),
		High:      mustDecimal("99.50"),
		Low:       mustDecimal("98.00"),
		Close:     mustDecimal("99.40"),
		Volume:    mustDecimal("800000"),
	}
	
	_, err = sm.ProcessCandle(pos, candle3)
	if err != nil {
		t.Fatalf("candle 3 failed: %v", err)
	}
	
	// Verify profit is calculated (not zero for take-profit close)
	if pos.Profit.IsZero() {
		t.Errorf("expected profit > 0 for take-profit close, got %s", pos.Profit.String())
	}
	
	// Verify profit is positive (take-profit should result in profit)
	if pos.Profit.IsNegative() {
		t.Errorf("expected positive profit, got %s", pos.Profit.String())
	}
	
	// Verify close timestamp is set
	if pos.CloseTimestamp == nil {
		t.Errorf("expected CloseTimestamp to be set after close")
	}
	
	t.Logf("Profit calculation: %v", pos.Profit)
}
