package position

import (
	"testing"
	"time"
)

// ============================================================================
// Phase 4: User Story 2 (US2) — Enforce Pessimistic Execution Order
// ============================================================================

// T050: Candle with low ≤ both P[1] AND ≤ P_liq → buy fills FIRST, P_liq recalculated,
// then liquidation re-checked
func TestPessimisticOrder_T050_BuyBeforeLiquidationRecalc(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-PSO-050"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.844")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	pos := NewPosition(tradeID, openTime, prices, amounts)

	// Setup: Position already opened with first order filled
	pos.State = StateOpening
	pos.NextOrderIndex = 1
	pos.HasMoreOrders = true
	pos.OpenPrice = mustDecimal("100.00")
	pos.PositionQuantity = mustDecimal("1.0")
	pos.AverageEntryPrice = mustDecimal("100.00")
	pos.LiquidationPrice = mustDecimal("50.00") // 50% of avg entry
	pos.Orders = []OrderFill{
		{
			OrderIndex:       0,
			OrderNumber:      1,
			OrderType:        OrderTypeMarket,
			ExecutedPrice:    mustDecimal("100.00"),
			ExecutedQuantity: mustDecimal("1.0"),
			QuoteAmount:      mustDecimal("100.00"),
			Timestamp:        openTime,
			Fee:              mustDecimal("0.075"),
		},
	}
	pos.FeesAccumulated = mustDecimal("0.075")

	// Create candle where low is between P[1]=98 and P_liq=50
	// This should trigger a buy at P[1]=98, recalculate P_liq upward, then re-check liquidation
	candle := &Candle{
		Timestamp: time.Date(2024, 1, 1, 0, 1, 0, 0, time.UTC),
		Open:      mustDecimal("99.00"),
		High:      mustDecimal("99.50"),
		Low:       mustDecimal("97.50"), // Below P[1]=98, triggers buy
		Close:     mustDecimal("99.00"),
		Volume:    mustDecimal("1000000"),
	}

	events, err := sm.ProcessCandle(pos, candle)
	if err != nil {
		t.Fatalf("ProcessCandle failed: %v", err)
	}

	// Verify buy order was executed (event order: BuyOrderExecuted then LiquidationPriceUpdated)
	var buyEventFound, liqEventFound bool
	var buyEventIndex, liqEventIndex int
	for i, evt := range events {
		if evt.EventType() == "order.buy.executed" {
			buyEventFound = true
			buyEventIndex = i
		}
		if evt.EventType() == "liquidation.price.updated" {
			liqEventFound = true
			liqEventIndex = i
		}
	}

	if !buyEventFound {
		t.Errorf("expected BuyOrderExecutedEvent in events")
	}
	if !liqEventFound {
		t.Errorf("expected LiquidationPriceUpdatedEvent in events")
	}

	// Verify order: BuyOrderExecuted comes BEFORE LiquidationPriceUpdated
	if buyEventFound && liqEventFound && buyEventIndex > liqEventIndex {
		t.Errorf("pessimistic order violation: BuyOrderExecuted (index %d) must come before LiquidationPriceUpdated (index %d)", buyEventIndex, liqEventIndex)
	}

	// Verify P_liq was recalculated (should be 50% of new avg entry, which is higher)
	if pos.LiquidationPrice.Equal(mustDecimal("50.00")) {
		t.Errorf("expected P_liq to be recalculated, but it's still 50.00 (original)")
	}

	// Verify position is still open (not liquidated) after recalculation
	if pos.State == StateClosed {
		t.Errorf("expected position to remain open after buy+recalc, but got StateClosed")
	}
}

// T051: After buy+recalc, P_liq moves above low → position stays open
func TestPessimisticOrder_T051_RecalcLiquidationMovesAboveLow(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-PSO-051"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.844")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	pos := NewPosition(tradeID, openTime, prices, amounts)

	// Setup position with market buy
	pos.State = StateOpening
	pos.NextOrderIndex = 1
	pos.HasMoreOrders = true
	pos.OpenPrice = mustDecimal("100.00")
	pos.Orders = []OrderFill{
		{OrderIndex: 0, OrderNumber: 1, OrderType: OrderTypeMarket, ExecutedPrice: mustDecimal("100.00"), ExecutedQuantity: mustDecimal("1.0"), QuoteAmount: mustDecimal("100.00"), Timestamp: openTime, Fee: mustDecimal("0.075")},
	}
	pos.PositionQuantity = mustDecimal("1.0")
	pos.AverageEntryPrice = mustDecimal("100.00")
	pos.LiquidationPrice = mustDecimal("50.00")
	pos.FeesAccumulated = mustDecimal("0.075")

	// Candle with low at 97, which is above P_liq=50 but below P[1]=98
	// This should fill P[1], recalc P_liq upward (now above 97), position stays open
	candle := &Candle{
		Timestamp: time.Date(2024, 1, 1, 0, 1, 0, 0, time.UTC),
		Open:      mustDecimal("99.00"),
		High:      mustDecimal("99.50"),
		Low:       mustDecimal("97.00"), // Between P_liq=50 and P[1]=98
		Close:     mustDecimal("98.50"),
		Volume:    mustDecimal("1000000"),
	}

	events, err := sm.ProcessCandle(pos, candle)
	if err != nil {
		t.Fatalf("ProcessCandle failed: %v", err)
	}

	// Verify there's no TradeClosedEvent (position stayed open)
	for _, evt := range events {
		if evt.EventType() == "trade.closed" {
			t.Errorf("expected position to stay open, but got TradeClosedEvent with reason=%s", evt.(*TradeClosedEvent).Reason)
		}
	}

	if pos.State == StateClosed {
		t.Errorf("expected position to remain open, but got StateClosed")
	}
}

// T052: Candle with no buy trigger + high ≥ P_tp but low ≤ P_liq →
// liquidation closes position (take-profit ignored)
func TestPessimisticOrder_T052_LiquidationBeforeTakeProfit(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-PSO-052"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.844")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	pos := NewPosition(tradeID, openTime, prices, amounts)

	// Setup with multiple orders filled
	pos.State = StateSafetyOrderWait
	pos.NextOrderIndex = 2
	pos.HasMoreOrders = true
	pos.OpenPrice = mustDecimal("100.00")
	pos.Orders = []OrderFill{
		{OrderIndex: 0, OrderNumber: 1, OrderType: OrderTypeMarket, ExecutedPrice: mustDecimal("100.00"), ExecutedQuantity: mustDecimal("1.0"), QuoteAmount: mustDecimal("100.00"), Timestamp: openTime, Fee: mustDecimal("0.075")},
		{OrderIndex: 1, OrderNumber: 2, OrderType: OrderTypeLimit, ExecutedPrice: mustDecimal("98.00"), ExecutedQuantity: mustDecimal("1.0"), QuoteAmount: mustDecimal("98.00"), Timestamp: time.Date(2024, 1, 1, 0, 1, 0, 0, time.UTC), Fee: mustDecimal("0.0735")},
	}
	pos.PositionQuantity = mustDecimal("2.0")
	pos.AverageEntryPrice = mustDecimal("99.00")
	pos.TakeProfitTarget = mustDecimal("99.495")  // 0.5% above 99
	pos.LiquidationPrice = mustDecimal("94.00")    // Low trigger for this scenario
	pos.FeesAccumulated = mustDecimal("0.1485")

	// Candle where high ≥ P_tp AND low ≤ P_liq
	// Liquidation should execute FIRST, closing position
	candle := &Candle{
		Timestamp: time.Date(2024, 1, 1, 0, 2, 0, 0, time.UTC),
		Open:      mustDecimal("97.00"),
		High:      mustDecimal("100.00"), // Above P_tp=99.495
		Low:       mustDecimal("93.00"),  // Below P_liq=94.00
		Close:     mustDecimal("98.00"),
		Volume:    mustDecimal("1000000"),
	}

	events, err := sm.ProcessCandle(pos, candle)
	if err != nil {
		t.Fatalf("ProcessCandle failed: %v", err)
	}

	// Verify TradeClosedEvent with reason="liquidation" (not take_profit)
	var closeEvent *TradeClosedEvent
	for _, evt := range events {
		if evt.EventType() == "trade.closed" {
			closeEvent = evt.(*TradeClosedEvent)
			break
		}
	}

	if closeEvent == nil {
		t.Errorf("expected TradeClosedEvent, got events: %+v", events)
	} else if closeEvent.Reason != "liquidation" {
		t.Errorf("expected Reason='liquidation', got '%s' (take-profit should be ignored)", closeEvent.Reason)
	}

	if pos.State != StateClosed {
		t.Errorf("expected StateClosed, got %v", pos.State)
	}
}

// T053: Position with P_liq=90, candle has high=100, low=89 →
// low ≤ P_liq triggers liquidation (take-profit not checked)
func TestPessimisticOrder_T053_LiquidationIgnoresTakeProfit(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-PSO-053"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.844")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	pos := NewPosition(tradeID, openTime, prices, amounts)

	pos.State = StateSafetyOrderWait
	pos.OpenPrice = mustDecimal("100.00")
	pos.PositionQuantity = mustDecimal("2.0")
	pos.AverageEntryPrice = mustDecimal("99.00")
	pos.TakeProfitTarget = mustDecimal("99.495")
	pos.LiquidationPrice = mustDecimal("90.00") // Exact trigger price
	pos.Orders = []OrderFill{
		{OrderIndex: 0, OrderNumber: 1, OrderType: OrderTypeMarket, ExecutedPrice: mustDecimal("100.00"), ExecutedQuantity: mustDecimal("1.0"), QuoteAmount: mustDecimal("100.00"), Timestamp: openTime, Fee: mustDecimal("0.075")},
		{OrderIndex: 1, OrderNumber: 2, OrderType: OrderTypeLimit, ExecutedPrice: mustDecimal("98.00"), ExecutedQuantity: mustDecimal("1.0"), QuoteAmount: mustDecimal("98.00"), Timestamp: time.Date(2024, 1, 1, 0, 1, 0, 0, time.UTC), Fee: mustDecimal("0.0735")},
	}
	pos.FeesAccumulated = mustDecimal("0.1485")
	pos.NextOrderIndex = 2

	// Candle where high=100 (way above P_tp) but low=89 (below P_liq=90)
	candle := &Candle{
		Timestamp: time.Date(2024, 1, 1, 0, 2, 0, 0, time.UTC),
		Open:      mustDecimal("99.00"),
		High:      mustDecimal("100.00"), // High above P_tp - would normally trigger close
		Low:       mustDecimal("89.00"),  // Low below P_liq=90 - MUST trigger liquidation instead
		Close:     mustDecimal("99.00"),
		Volume:    mustDecimal("1000000"),
	}

	events, err := sm.ProcessCandle(pos, candle)
	if err != nil {
		t.Fatalf("ProcessCandle failed: %v", err)
	}

	// Verify position closed via liquidation, NOT take-profit
	var closeEvent *TradeClosedEvent
	for _, evt := range events {
		if evt.EventType() == "trade.closed" {
			closeEvent = evt.(*TradeClosedEvent)
			break
		}
	}

	if closeEvent == nil {
		t.Errorf("expected TradeClosedEvent")
	} else if closeEvent.Reason != "liquidation" {
		t.Errorf("expected Reason='liquidation' not '%s'; liquidation must be checked BEFORE take-profit", closeEvent.Reason)
	}
}

// T054: Event order verification — if candle triggers buy + liquidation,
// events are [BuyOrderExecuted, LiquidationPriceUpdated, TradeClosed] in that order
func TestPessimisticOrder_T054_EventOrderGuarantee(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "test-PSO-054"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.844")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	pos := NewPosition(tradeID, openTime, prices, amounts)

	pos.State = StateOpening
	pos.NextOrderIndex = 1
	pos.OpenPrice = mustDecimal("100.00")
	pos.PositionQuantity = mustDecimal("1.0")
	pos.AverageEntryPrice = mustDecimal("100.00")
	pos.LiquidationPrice = mustDecimal("60.00") // Will be recalculated upward
	pos.Orders = []OrderFill{
		{OrderIndex: 0, OrderNumber: 1, OrderType: OrderTypeMarket, ExecutedPrice: mustDecimal("100.00"), ExecutedQuantity: mustDecimal("1.0"), QuoteAmount: mustDecimal("100.00"), Timestamp: openTime, Fee: mustDecimal("0.075")},
	}
	pos.FeesAccumulated = mustDecimal("0.075")
	pos.HasMoreOrders = true

	// Candle triggers both a buy AND a liquidation after recalculation
	// This tests the event order guarantee
	candle := &Candle{
		Timestamp: time.Date(2024, 1, 1, 0, 1, 0, 0, time.UTC),
		Open:      mustDecimal("99.00"),
		High:      mustDecimal("99.50"),
		Low:       mustDecimal("55.00"), // Triggers P[1]=98 buy, then P_liq recalculation, then liquidation
		Close:     mustDecimal("98.00"),
		Volume:    mustDecimal("1000000"),
	}

	events, err := sm.ProcessCandle(pos, candle)
	if err != nil {
		t.Fatalf("ProcessCandle failed: %v", err)
	}

	// Extract event indices
	var buyIdx, liqUpdatedIdx, tradeClosedIdx int
	var buyFound, liqUpdatedFound, tradeClosedFound bool

	for i, evt := range events {
		switch evt.EventType() {
		case "order.buy.executed":
			buyFound = true
			buyIdx = i
		case "liquidation.price.updated":
			liqUpdatedFound = true
			liqUpdatedIdx = i
		case "trade.closed":
			tradeClosedFound = true
			tradeClosedIdx = i
		}
	}

	// Verify all events are present
	if !buyFound {
		t.Errorf("expected BuyOrderExecutedEvent")
	}
	if !liqUpdatedFound {
		t.Errorf("expected LiquidationPriceUpdatedEvent")
	}
	if !tradeClosedFound {
		t.Errorf("expected TradeClosedEvent")
	}

	// Verify order: BUY → LIQ_UPDATED → TRADE_CLOSED
	if buyFound && liqUpdatedFound && buyIdx > liqUpdatedIdx {
		t.Errorf("event order violation: BuyOrderExecuted must come before LiquidationPriceUpdated")
	}
	if liqUpdatedFound && tradeClosedFound && liqUpdatedIdx > tradeClosedIdx {
		t.Errorf("event order violation: LiquidationPriceUpdated must come before TradeClosed")
	}
	if buyFound && tradeClosedFound && buyIdx > tradeClosedIdx {
		t.Errorf("event order violation: BuyOrderExecuted must come before TradeClosed")
	}

	if pos.State != StateClosed {
		t.Errorf("expected position to close via liquidation, got state=%v", pos.State)
	}
}
