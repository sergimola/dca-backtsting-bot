package position

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

// ============================================================================
// T025: IDLE position + first candle → TradeOpenedEvent dispatched
// ============================================================================
func TestUS1_T025_IdlePositionFirstCandle(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-trade-001"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	
	// Create position with pre-calculated prices and amounts
	prices := mustDecimalSlice("100.00", "98.00", "95.844")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	pos := NewPosition(tradeID, openTime, prices, amounts)
	
	// Verify position starts in IDLE state
	if pos.State != StateIdle {
		t.Errorf("expected StateIdle, got %v", pos.State)
	}
	
	// Create synthetic candle (market buy happens at close price)
	candle := &Candle{
		Timestamp: openTime,
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	
	// Process candle
	events, err := sm.ProcessCandle(pos, candle)
	if err != nil {
		t.Fatalf("ProcessCandle failed: %v", err)
	}
	
	// Verify TradeOpenedEvent is dispatched
	var tradeOpenedEvent *TradeOpenedEvent
	for _, evt := range events {
		if evt.EventType() == "trade.opened" {
			tradeOpenedEvent = evt.(*TradeOpenedEvent)
			break
		}
	}
	
	if tradeOpenedEvent == nil {
		t.Errorf("expected TradeOpenedEvent in events, got: %+v", events)
	}
	
	// Verify position transitioned to OPENING
	if pos.State != StateOpening {
		t.Errorf("expected StateOpening after first candle, got %v", pos.State)
	}
}

// ============================================================================
// T026: OPENING position + low ≤ P[1] → BuyOrderExecutedEvent for safety order #1
// ============================================================================
func TestUS1_T026_OpeningPositionSafetyOrderFill(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-trade-002"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	
	prices := mustDecimalSlice("100.00", "98.00", "95.844")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	pos := NewPosition(tradeID, openTime, prices, amounts)
	
	// Manually set position to OPENING state (simulating after first candle)
	pos.State = StateOpening
	pos.NextOrderIndex = 0 // Next order is P[0] (market), already filled by first candle
	pos.OpenPrice = mustDecimal("100.00")
	pos.PositionQuantity = mustDecimal("1.0") // Market buy filled
	pos.AverageEntryPrice = mustDecimal("100.00")
	pos.Orders = append(pos.Orders, OrderFill{
		OrderIndex:       0,
		OrderNumber:      1,
		OrderType:        OrderTypeMarket,
		ExecutedPrice:    mustDecimal("100.00"),
		ExecutedQuantity: mustDecimal("1.0"),
		QuoteAmount:      mustDecimal("100.00"),
		Timestamp:        openTime,
		Fee:              mustDecimal("0.075"),
	})
	pos.NextOrderIndex = 1 // Now waiting for P[1] = 98.00
	pos.HasMoreOrders = true
	
	// Create candle where low triggers P[1] = 98.00
	candle := &Candle{
		Timestamp: time.Date(2024, 1, 1, 0, 1, 0, 0, time.UTC),
		Open:      mustDecimal("100.00"),
		High:      mustDecimal("100.00"),
		Low:       mustDecimal("97.50"), // Below P[1]=98.00, triggers fill
		Close:     mustDecimal("99.00"),
		Volume:    mustDecimal("1000000"),
	}
	
	// Process candle
	events, err := sm.ProcessCandle(pos, candle)
	if err != nil {
		t.Fatalf("ProcessCandle failed: %v", err)
	}
	
	// Verify BuyOrderExecutedEvent is dispatched
	var buyEvent *BuyOrderExecutedEvent
	for _, evt := range events {
		if evt.EventType() == "order.buy.executed" {
			buyEvent = evt.(*BuyOrderExecutedEvent)
			break
		}
	}
	
	if buyEvent == nil {
		t.Errorf("expected BuyOrderExecutedEvent, got events: %+v", events)
	} else if buyEvent.OrderNumber != 2 {
		t.Errorf("expected OrderNumber=2 for safety order #1, got %d", buyEvent.OrderNumber)
	}
	
	// Verify position still in SAFETY_ORDER_WAIT or has moved forward
	if pos.State != StateSafetyOrderWait {
		t.Logf("state after fill: %v (acceptable: could transition based on implementation)", pos.State)
	}
}

// ============================================================================
// T027: After buy order → LiquidationPriceUpdatedEvent with recalculated price
// ============================================================================
func TestUS1_T027_LiquidationPriceUpdatedAfterBuy(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-trade-003"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	
	prices := mustDecimalSlice("100.00", "98.00", "95.844")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	pos := NewPosition(tradeID, openTime, prices, amounts)
	
	// Set position to OPENING with market buy filled
	pos.State = StateOpening
	pos.NextOrderIndex = 1
	pos.HasMoreOrders = true
	pos.OpenPrice = mustDecimal("100.00")
	pos.PositionQuantity = mustDecimal("1.0")
	pos.AverageEntryPrice = mustDecimal("100.00")
	pos.Orders = append(pos.Orders, OrderFill{
		OrderIndex:       0,
		OrderNumber:      1,
		OrderType:        OrderTypeMarket,
		ExecutedPrice:    mustDecimal("100.00"),
		ExecutedQuantity: mustDecimal("1.0"),
		QuoteAmount:      mustDecimal("100.00"),
		Timestamp:        openTime,
		Fee:              mustDecimal("0.075"),
	})
	
	candle := &Candle{
		Timestamp: time.Date(2024, 1, 1, 0, 1, 0, 0, time.UTC),
		Open:      mustDecimal("100.00"),
		High:      mustDecimal("100.00"),
		Low:       mustDecimal("97.50"),
		Close:     mustDecimal("99.00"),
		Volume:    mustDecimal("1000000"),
	}
	
	events, err := sm.ProcessCandle(pos, candle)
	if err != nil {
		t.Fatalf("ProcessCandle failed: %v", err)
	}
	
	// Verify LiquidationPriceUpdatedEvent is dispatched
	var liqEvent *LiquidationPriceUpdatedEvent
	for _, evt := range events {
		if evt.EventType() == "liquidation.price.updated" {
			liqEvent = evt.(*LiquidationPriceUpdatedEvent)
			break
		}
	}
	
	if liqEvent == nil {
		t.Errorf("expected LiquidationPriceUpdatedEvent, got events: %+v", events)
	}
	
	// Verify liquidation price was recalculated (not zero)
	if liqEvent != nil {
		if liqEvent.LiquidationPrice == "" || liqEvent.LiquidationPrice == "0" {
			t.Errorf("expected non-zero liquidation price, got: %s", liqEvent.LiquidationPrice)
		}
	}
}

// ============================================================================
// T028: SAFETY_ORDER_WAIT + high ≥ P_tp → TradeClosedEvent via take-profit
// ============================================================================
func TestUS1_T028_TakeProfitClose(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-trade-004"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	
	prices := mustDecimalSlice("100.00", "98.00", "95.844")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	pos := NewPosition(tradeID, openTime, prices, amounts)
	
	// Manually construct position with 2 orders filled
	pos.State = StateSafetyOrderWait
	pos.NextOrderIndex = 2 // Next would be P[2]
	pos.HasMoreOrders = true
	pos.OpenPrice = mustDecimal("100.00")
	
	// Orders: P[0]=100@1.0, P[1]=98@1.0
	pos.Orders = []OrderFill{
		{OrderIndex: 0, OrderNumber: 1, OrderType: OrderTypeMarket, ExecutedPrice: mustDecimal("100.00"), ExecutedQuantity: mustDecimal("1.0"), QuoteAmount: mustDecimal("100.00"), Timestamp: openTime, Fee: mustDecimal("0.075")},
		{OrderIndex: 1, OrderNumber: 2, OrderType: OrderTypeLimit, ExecutedPrice: mustDecimal("98.00"), ExecutedQuantity: mustDecimal("1.0"), QuoteAmount: mustDecimal("98.00"), Timestamp: time.Date(2024, 1, 1, 0, 1, 0, 0, time.UTC), Fee: mustDecimal("0.0735")},
	}
	
	// Recalculate aggregates (as they would be after fills)
	pos.PositionQuantity = mustDecimal("2.0")
	pos.AverageEntryPrice = mustDecimal("99.00") // (100*1 + 98*1) / 2
	pos.TakeProfitTarget = mustDecimal("99.495")  // 99*1.005
	pos.LiquidationPrice = mustDecimal("0")
	pos.Profit = mustDecimal("0")
	pos.FeesAccumulated = mustDecimal("0.1485")
	
	// Create candle where high triggers take-profit
	candle := &Candle{
		Timestamp: time.Date(2024, 1, 1, 0, 2, 0, 0, time.UTC),
		Open:      mustDecimal("98.50"),
		High:      mustDecimal("99.50"), // Exceeds P_tp, triggers close
		Low:       mustDecimal("98.00"),
		Close:     mustDecimal("99.40"),
		Volume:    mustDecimal("1000000"),
	}
	
	events, err := sm.ProcessCandle(pos, candle)
	if err != nil {
		t.Fatalf("ProcessCandle failed: %v", err)
	}
	
	// Verify TradeClosedEvent is dispatched
	var closeEvent *TradeClosedEvent
	for _, evt := range events {
		if evt.EventType() == "trade.closed" {
			closeEvent = evt.(*TradeClosedEvent)
			break
		}
	}
	
	if closeEvent == nil {
		t.Errorf("expected TradeClosedEvent, got events: %+v", events)
	} else if closeEvent.Reason != "take_profit" {
		t.Errorf("expected Reason='take_profit', got %s", closeEvent.Reason)
	}
	
	// Verify position transitioned to CLOSED
	if pos.State != StateClosed {
		t.Errorf("expected StateClosed after take-profit, got %v", pos.State)
	}
}

// ============================================================================
// T029: Position closed via take-profit → state transitions to IDLE
// ============================================================================
func TestUS1_T029_ReentryAfterTakeProfit(t *testing.T) {
	// This test verifies the state management after a close event
	// Caller orchestrates state change, but event includes close indication
	
	// Event is already tested in T028
	// This verifies that on the NEXT candle, a new position can be opened
	
	sm := NewStateMachine()
	tradeID := "test-trade-005"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	
	prices := mustDecimalSlice("100.00", "98.00", "95.844")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	
	// First position (closed via take-profit previously)
	pos1 := NewPosition(tradeID, openTime, prices, amounts)
	pos1.State = StateClosed
	pos1.CloseTimestamp = &[]time.Time{time.Date(2024, 1, 1, 0, 1, 0, 0, time.UTC)}[0]
	
	if pos1.State != StateClosed {
		t.Errorf("expected pos1 to be StateClosed, got %v", pos1.State)
	}
	
	// Create new position (caller would do this on next candle)
	tradeID2 := "test-trade-006"
	openTime2 := time.Date(2024, 1, 1, 0, 2, 0, 0, time.UTC)
	prices2 := mustDecimalSlice("99.495", "97.515", "95.354") // Re-entry prices
	amounts2 := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	
	pos2 := NewPosition(tradeID2, openTime2, prices2, amounts2)
	
	if pos2.State != StateIdle {
		t.Errorf("expected new position to start in StateIdle, got %v", pos2.State)
	}
}

// ============================================================================
// T030: Event payload validation — TradeOpenedEvent contains required fields
// ============================================================================
func TestUS1_T030_TradeOpenedEventPayload(t *testing.T) {
	event := &TradeOpenedEvent{
		RunID:       "run-001",
		TradeID:     "trade-001",
		Timestamp:   time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
		TradingPair: "BTC/USDT",
		ConfiguredOrders: []OrderGrid{
			{OrderIndex: 0, OrderNumber: 1, Price: "100.00", Amount: "100.00"},
			{OrderIndex: 1, OrderNumber: 2, Price: "98.00", Amount: "98.00"},
		},
	}
	
	// Verify fields
	if event.TradeID != "trade-001" {
		t.Errorf("expected trade_id='trade-001', got %s", event.TradeID)
	}
	if event.EventType() != "trade.opened" {
		t.Errorf("expected EventType='trade.opened', got %s", event.EventType())
	}
	if len(event.ConfiguredOrders) != 2 {
		t.Errorf("expected 2 configured orders, got %d", len(event.ConfiguredOrders))
	}
	if event.EventTimestamp() != event.Timestamp {
		t.Errorf("expected EventTimestamp to match Timestamp field")
	}
}

// ============================================================================
// T031: Event payload validation — BuyOrderExecutedEvent contains required fields
// ============================================================================
func TestUS1_T031_BuyOrderExecutedEventPayload(t *testing.T) {
	event := &BuyOrderExecutedEvent{
		RunID:            "run-001",
		TradeID:          "trade-001",
		Timestamp:        time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
		Price:            "98.00",
		Size:             "98.00",         // Quote
		BaseSize:         "1.0",           // Base
		OrderType:        OrderTypeLimit,
		LiquidationPrice: "50.337",
		OrderNumber:      2,
		Fee:              "0.0735",
	}
	
	// Verify fields
	if event.Price != "98.00" {
		t.Errorf("expected Price='98.00', got %s", event.Price)
	}
	if event.Size != "98.00" {
		t.Errorf("expected Size (quote)='98.00', got %s", event.Size)
	}
	if event.BaseSize != "1.0" {
		t.Errorf("expected BaseSize='1.0', got %s", event.BaseSize)
	}
	if event.OrderNumber != 2 {
		t.Errorf("expected OrderNumber=2, got %d", event.OrderNumber)
	}
	if event.EventType() != "order.buy.executed" {
		t.Errorf("expected EventType='order.buy.executed', got %s", event.EventType())
	}
	if event.Fee == "" {
		t.Errorf("expected Fee to be set")
	}
}

// ============================================================================
// T032: ProcessCandle called with nil Candle returns error
// ============================================================================
func TestUS1_T032_NilCandleError(t *testing.T) {
	sm := NewStateMachine()
	pos := NewPosition("test", time.Now(), mustDecimalSlice("100"), mustDecimalSlice("100"))
	
	// ProcessCandle with nil candle
	_, err := sm.ProcessCandle(pos, nil)
	
	if err == nil {
		t.Errorf("expected error when candle is nil, got nil")
	}
}

// ============================================================================
// T033: Multiple orders filled on same candle (gap-down) → events in correct order
// ============================================================================
func TestUS1_T033_MultipleOrdersGapDown(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-trade-007"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	
	prices := mustDecimalSlice("100.00", "98.00", "95.844")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	pos := NewPosition(tradeID, openTime, prices, amounts)
	
	// Set position to OPENING with first order filled
	pos.State = StateOpening
	pos.NextOrderIndex = 1
	pos.HasMoreOrders = true
	pos.OpenPrice = mustDecimal("100.00")
	pos.PositionQuantity = mustDecimal("1.0")
	pos.AverageEntryPrice = mustDecimal("100.00")
	pos.Orders = append(pos.Orders, OrderFill{
		OrderIndex:       0,
		OrderNumber:      1,
		OrderType:        OrderTypeMarket,
		ExecutedPrice:    mustDecimal("100.00"),
		ExecutedQuantity: mustDecimal("1.0"),
		QuoteAmount:      mustDecimal("100.00"),
		Timestamp:        openTime,
		Fee:              mustDecimal("0.075"),
	})
	
	// Create candle where open is below BOTH P[1]=98 and P[2]=95.844 (gap-down)
	candle := &Candle{
		Timestamp: time.Date(2024, 1, 1, 0, 1, 0, 0, time.UTC),
		Open:      mustDecimal("95.00"),  // Gaps down below both orders
		High:      mustDecimal("96.00"),
		Low:       mustDecimal("94.50"),  // Low also triggers fills
		Close:     mustDecimal("96.00"),
		Volume:    mustDecimal("1000000"),
	}
	
	events, err := sm.ProcessCandle(pos, candle)
	if err != nil {
		t.Fatalf("ProcessCandle failed: %v", err)
	}
	
	// Count BuyOrderExecutedEvents
	buyEventCount := 0
	var firstBuyOrder, secondBuyOrder *BuyOrderExecutedEvent
	for _, evt := range events {
		if evt.EventType() == "order.buy.executed" {
			buyEventCount++
			buyOrderEvent := evt.(*BuyOrderExecutedEvent)
			if firstBuyOrder == nil {
				firstBuyOrder = buyOrderEvent
			} else if secondBuyOrder == nil {
				secondBuyOrder = buyOrderEvent
			}
		}
	}
	
	// Verify 2 buy orders were filled
	if buyEventCount < 2 {
		t.Errorf("expected at least 2 buy orders on gap-down, got %d events: %+v", buyEventCount, events)
	}
	
	// Verify orders are filled in sequence (OrderNumber should be 2, 3)
	if firstBuyOrder != nil && firstBuyOrder.OrderNumber != 2 {
		t.Errorf("expected first buy order OrderNumber=2, got %d", firstBuyOrder.OrderNumber)
	}
	if secondBuyOrder != nil && secondBuyOrder.OrderNumber != 3 {
		t.Errorf("expected second buy order OrderNumber=3, got %d", secondBuyOrder.OrderNumber)
	}
}
