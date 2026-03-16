package position

import (
	"testing"
	"time"
)

// TestTakeProfit_RespectsLimitPrice asserts that a take-profit fill uses the
// configured TakeProfitTarget (limit price) as the ClosingPrice, not the candle
// High or Close. Positive slippage is not realistic for a limit sell order.
//
// Scenario:
//   - TakeProfitTarget = $7,650.00 (the configured limit sell price)
//   - Candle.High      = $8,343.07 (well above the take-profit — triggers fill)
//   - Candle.Close     = $8,294.53
//   - Expected ClosingPrice in TradeClosedEvent = $7,650.00 (limit price, not High/Close)
func TestTakeProfit_RespectsLimitPrice(t *testing.T) {
	sm := NewStateMachine()
	tradeID := "slippage-test-001"
	openTime := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)

	// Build a position that is already open with one order filled at $7,500.00
	pos := &Position{
		TradeID:       tradeID,
		State:         StateSafetyOrderWait,
		OpenTimestamp: openTime,
		HasMoreOrders: true,
		NextOrderIndex: 1,
		OpenPrice:     mustDecimal("7500.00"),

		Orders: []OrderFill{
			{
				OrderIndex:        0,
				OrderNumber:       1,
				OrderType:         OrderTypeMarket,
				ExecutedPrice:     mustDecimal("7500.00"),
				ExecutedQuantity:  mustDecimal("0.01"),
				QuoteAmount:       mustDecimal("75.00"),
				Timestamp:         openTime,
				Fee:               mustDecimal("0.05625"),
			},
		},

		PositionQuantity: mustDecimal("0.01"),
		AverageEntryPrice: mustDecimal("7500.00"),

		// TakeProfitTarget is exactly $7,650.00 (1.00% TP on $7,500)
		TakeProfitTarget: mustDecimal("7650.00"),

		LiquidationPrice: mustDecimal("0"),
		FeesAccumulated:  mustDecimal("0.05625"),
		Profit:           mustDecimal("0"),

		Prices:  mustDecimalSlice("7500.00"),
		Amounts: mustDecimalSlice("75.00"),
	}

	// Candle: High far exceeds TakeProfitTarget — the position MUST fill at the
	// limit price, not at the candle High.
	candle := &Candle{
		Timestamp: time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC),
		Open:      mustDecimal("7600.00"),
		High:      mustDecimal("8343.07"), // >> TakeProfitTarget
		Low:       mustDecimal("7265.00"),
		Close:     mustDecimal("8294.53"),
		Volume:    mustDecimal("5000000"),
	}

	events, err := sm.ProcessCandle(pos, candle)
	if err != nil {
		t.Fatalf("ProcessCandle returned error: %v", err)
	}

	// Find the TradeClosedEvent
	var closeEvent *TradeClosedEvent
	for _, evt := range events {
		if tc, ok := evt.(*TradeClosedEvent); ok {
			closeEvent = tc
			break
		}
	}

	if closeEvent == nil {
		t.Fatalf("expected a TradeClosedEvent but got none; all events: %+v", events)
	}

	if closeEvent.Reason != "take_profit" {
		t.Errorf("expected Reason='take_profit', got %q", closeEvent.Reason)
	}

	// THE KEY ASSERTION: closing price must equal the configured limit price,
	// not the candle High ($8,343.07) or Close ($8,294.53).
	expectedClosingPrice := mustDecimal("7650.00")
	actualClosingPrice := mustDecimal(closeEvent.ClosingPrice)

	if !expectedClosingPrice.Equal(actualClosingPrice) {
		t.Errorf("positive slippage bug: expected ClosingPrice=%s (limit price), got %s (candle high/close leaked through)",
			expectedClosingPrice.String(), actualClosingPrice.String())
	}
}
