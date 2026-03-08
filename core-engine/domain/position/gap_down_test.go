package position

import (
	"context"
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

// ============================================================================
// Phase 5: User Story 3 (US3) — Handle Gap-Down Paradox
// ============================================================================

// T060: Candle open=95.0, low=94.0; orders at P[1]=98, P[2]=95.844, P[3]=95 →
// all 3 fill at their exact prices (not at open=95.0)
func TestGapDown_T060_MultipleOrdersExactPrices(t *testing.T) {
	tradeID := "test-GD-060"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.84400000", "95.00")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715", "100.00")
	pos := NewPosition(tradeID, openTime, prices, amounts)

	// Setup: Position with first market buy already filled
	pos.State = StateOpening
	pos.NextOrderIndex = 1
	pos.HasMoreOrders = true
	pos.OpenPrice = mustDecimal("100.00")
	pos.Orders = []OrderFill{
		{
			OrderIndex:       0,
			OrderNumber:      1,
			OrderType:        OrderTypeMarket,
			ExecutedPrice:    mustDecimal("100.00"),
			ExecutedQuantity: mustDecimal("1.0"),
			QuoteAmount:      mustDecimal("14.28571428"),
			Timestamp:        openTime,
			Fee:              CalculateFee(mustDecimal("100.00"), mustDecimal("1.0"), OrderTypeMarket, 1),
		},
	}
	pos.PositionQuantity = mustDecimal("1.0")
	pos.AverageEntryPrice = mustDecimal("100.00")
	pos.FeesAccumulated = pos.Orders[0].Fee

	// Gap-down candle: open is 95, which is below P[1]=98, P[2]=95.844, and P[3]=95
	// All three orders should fill at their exact prices, not at open=95
	candle := &Candle{
		Timestamp: time.Date(2024, 1, 1, 0, 1, 0, 0, time.UTC),
		Open:      mustDecimal("95.00"),   // Gap down from prior close ~100
		High:      mustDecimal("95.50"),
		Low:       mustDecimal("94.00"),   // Low below all three limit orders
		Close:     mustDecimal("95.00"),
		Volume:    mustDecimal("1000000"),
	}

	// Call FillOrdersForCandle directly to test gap-down logic
	ctx := context.Background()
	fills := FillOrdersForCandle(ctx, pos, candle.Low)

	// Should fill all 3 pending orders (P[1], P[2], P[3])
	if len(fills) != 3 {
		t.Errorf("expected 3 fills, got %d", len(fills))
	}

	// Verify each order filled at EXACT price, not at candle open
	expectedPrices := []string{"98.00", "95.84400000", "95.00"}
	for i, fill := range fills {
		if i >= len(expectedPrices) {
			break
		}
		expectedPrice := mustDecimal(expectedPrices[i])
		if !fill.ExecutedPrice.Equal(expectedPrice) {
			t.Errorf("fill #%d: expected price=%s, got %s (NOT at candle open=95.00)",
				i+1, expectedPrice.String(), fill.ExecutedPrice.String())
		}
	}

	// Verify order quantities match configured amounts (not gap-adjusted)
	if len(fills) > 0 && !fills[0].QuoteAmount.Equal(amounts[1]) {
		t.Errorf("fill #1 quote amount: expected %s, got %s", amounts[1].String(), fills[0].QuoteAmount.String())
	}
	if len(fills) > 1 && !fills[1].QuoteAmount.Equal(amounts[2]) {
		t.Errorf("fill #2 quote amount: expected %s, got %s", amounts[2].String(), fills[1].QuoteAmount.String())
	}
	if len(fills) > 2 && !fills[2].QuoteAmount.Equal(amounts[3]) {
		t.Errorf("fill #3 quote amount: expected %s, got %s", amounts[3].String(), fills[2].QuoteAmount.String())
	}
}

// T061: Candle open=95.5, gap=1.0 below prior close; order at P[1]=98 →
// fills at 98, not at open=95.5
func TestGapDown_T061_FillAtLimitNotMarketPrice(t *testing.T) {
	tradeID := "test-GD-061"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.844")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715")
	pos := NewPosition(tradeID, openTime, prices, amounts)

	// Setup: Market buy filled at 100
	pos.State = StateOpening
	pos.NextOrderIndex = 1
	pos.OpenPrice = mustDecimal("100.00")
	pos.Orders = []OrderFill{
		{
			OrderIndex:       0,
			OrderNumber:      1,
			OrderType:        OrderTypeMarket,
			ExecutedPrice:    mustDecimal("100.00"),
			ExecutedQuantity: mustDecimal("1.0"),
			QuoteAmount:      amounts[0],
			Timestamp:        openTime,
			Fee:              CalculateFee(mustDecimal("100.00"), mustDecimal("1.0"), OrderTypeMarket, 1),
		},
	}
	pos.PositionQuantity = mustDecimal("1.0")
	pos.AverageEntryPrice = mustDecimal("100.00")
	pos.FeesAccumulated = pos.Orders[0].Fee
	pos.HasMoreOrders = true

	// Gap-down candle
	// Prior close was ~96.5 (assumed), open=95.5 (gap of 1.0 down)
	// Order is at P[1]=98 (above the gap!)
	// This order should STILL fill at 98, because the low is 95.0 (≤ 98)
	candle := &Candle{
		Timestamp: time.Date(2024, 1, 1, 0, 1, 0, 0, time.UTC),
		Open:      mustDecimal("95.50"), // Gap down 1.0
		High:      mustDecimal("95.70"),
		Low:       mustDecimal("94.90"), // Low is below 98, so order fills
		Close:     mustDecimal("95.60"),
		Volume:    mustDecimal("1000000"),
	}

	ctx := context.Background()
	fills := FillOrdersForCandle(ctx, pos, candle.Low)

	if len(fills) != 1 {
		t.Errorf("expected 1 fill, got %d", len(fills))
	}

	if len(fills) > 0 {
		// Verify fill price is 98, NOT the candle open of 95.5
		expectedPrice := mustDecimal("98.00")
		if !fills[0].ExecutedPrice.Equal(expectedPrice) {
			t.Errorf("gap-down fill: expected price=%s (limit), got %s (NOT %s market)", expectedPrice.String(), fills[0].ExecutedPrice.String(), candle.Open.String())
		}
	}
}

// T062: Verify order quantities match configured amounts (not gap-adjusted)
func TestGapDown_T062_QuantitiesDontChangeOnGapDown(t *testing.T) {
	ctx := context.Background()

	prices := mustDecimalSlice("100.00", "98.00", "95.844", "94.00")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715", "120.00")

	pos := NewPosition("test-GD-062", time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC), prices, amounts)

	// Setup
	pos.State = StateOpening
	pos.NextOrderIndex = 1
	pos.OpenPrice = mustDecimal("100.00")
	pos.Orders = []OrderFill{
		{OrderIndex: 0, OrderNumber: 1, OrderType: OrderTypeMarket, ExecutedPrice: mustDecimal("100.00"), ExecutedQuantity: mustDecimal("1.0"), QuoteAmount: amounts[0], Timestamp: time.Now(), Fee: mustDecimal("0.0")},
	}
	pos.PositionQuantity = mustDecimal("1.0")
	pos.AverageEntryPrice = mustDecimal("100.00")

	// Massive gap-down: open at 80, way below all orders
	candle := &Candle{
		Timestamp: time.Now().Add(time.Minute),
		Open:      mustDecimal("80.00"),
		High:      mustDecimal("80.50"),
		Low:       mustDecimal("79.00"),
		Close:     mustDecimal("80.00"),
		Volume:    mustDecimal("1000000"),
	}

	fills := FillOrdersForCandle(ctx, pos, candle.Low)

	// All remaining orders should fill, each with its configured amount
	expectedAmounts := amounts[1:] // Skip first (already filled at market buy)

	for i, fill := range fills {
		if i >= len(expectedAmounts) {
			break
		}
		if !fill.QuoteAmount.Equal(expectedAmounts[i]) {
			t.Errorf("fill #%d quote amount: expected %s, got %s (amounts must NOT change on gap-down)",
				i+1, expectedAmounts[i].String(), fill.QuoteAmount.String())
		}
	}
}

// T063: Multiple fills on single candle, verify order execution index increments correctly
func TestGapDown_T063_OrderIndexIncrementsCorrectly(t *testing.T) {
	ctx := context.Background()

	prices := mustDecimalSlice("100.00", "98.00", "95.844", "94.00", "92.00")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715", "100.00", "200.00")

	pos := NewPosition("test-GD-063", time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC), prices, amounts)

	pos.State = StateOpening
	pos.NextOrderIndex = 1
	pos.OpenPrice = mustDecimal("100.00")
	pos.Orders = []OrderFill{{OrderIndex: 0, OrderNumber: 1, OrderType: OrderTypeMarket, ExecutedPrice: mustDecimal("100.00"), ExecutedQuantity: mustDecimal("1.0"), QuoteAmount: amounts[0], Timestamp: time.Now(), Fee: mustDecimal("0.0")}}
	pos.PositionQuantity = mustDecimal("1.0")
	pos.AverageEntryPrice = mustDecimal("100.00")
	pos.HasMoreOrders = true

	// Gap-down to 91, should fill orders at indices 1, 2, 3, 4
	candle := &Candle{
		Timestamp: time.Now().Add(time.Minute),
		Open:      mustDecimal("91.00"),
		High:      mustDecimal("91.50"),
		Low:       mustDecimal("90.00"),
		Close:     mustDecimal("91.00"),
		Volume:    mustDecimal("1000000"),
	}

	fills := FillOrdersForCandle(ctx, pos, candle.Low)

	// Should fill 4 orders (indices 1-4)
	if len(fills) != 4 {
		t.Errorf("expected 4 fills, got %d", len(fills))
	}

	// Verify OrderIndex increments: 1, 2, 3, 4
	expectedIndices := []int{1, 2, 3, 4}
	for i, fill := range fills {
		if i >= len(expectedIndices) {
			break
		}
		if fill.OrderIndex != expectedIndices[i] {
			t.Errorf("fill #%d: expected OrderIndex=%d, got %d", i+1, expectedIndices[i], fill.OrderIndex)
		}
	}

	// Verify NextOrderIndex updated in position
	if pos.NextOrderIndex != 5 {
		t.Errorf("expected NextOrderIndex=5 after filling indices 1-4, got %d", pos.NextOrderIndex)
	}
}

// T064: Gap-down past all remaining orders → fills all at their respective prices
func TestGapDown_T064_GapDownPastAllOrders(t *testing.T) {
	ctx := context.Background()

	prices := mustDecimalSlice("100.00", "98.00", "95.844", "94.00")
	amounts := mustDecimalSlice("14.28571428", "28.57142857", "57.14285715", "100.00")

	pos := NewPosition("test-GD-064", time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC), prices, amounts)

	pos.State = StateOpening
	pos.NextOrderIndex = 1
	pos.OpenPrice = mustDecimal("100.00")
	pos.Orders = []OrderFill{{OrderIndex: 0, OrderNumber: 1, OrderType: OrderTypeMarket, ExecutedPrice: mustDecimal("100.00"), ExecutedQuantity: mustDecimal("1.0"), QuoteAmount: amounts[0], Timestamp: time.Now(), Fee: mustDecimal("0.0")}}
	pos.PositionQuantity = mustDecimal("1.0")
	pos.AverageEntryPrice = mustDecimal("100.00")
	pos.HasMoreOrders = true

	// Extreme gap-down: open at 50, WAY below all remaining orders
	candle := &Candle{
		Timestamp: time.Now().Add(time.Minute),
		Open:      mustDecimal("50.00"),
		High:      mustDecimal("50.50"),
		Low:       mustDecimal("49.00"), // Below all remaining orders
		Close:     mustDecimal("50.00"),
		Volume:    mustDecimal("1000000"),
	}

	fills := FillOrdersForCandle(ctx, pos, candle.Low)

	// Should fill ALL remaining orders (3 orders at indices 1, 2, 3)
	if len(fills) != 3 {
		t.Errorf("expected 3 fills (all remaining), got %d", len(fills))
	}

	// Verify all filled at exact prices, not at open=50
	expectedPrices := []string{"98.00", "95.84400000", "94.00"}
	for i, fill := range fills {
		if i >= len(expectedPrices) {
			break
		}
		expectedPrice := mustDecimal(expectedPrices[i])
		if !fill.ExecutedPrice.Equal(expectedPrice) {
			t.Errorf("fill #%d: expected price=%s, got %s (NOT at open=50.00 or low=49.00)",
				i+1, expectedPrice.String(), fill.ExecutedPrice.String())
		}
	}

	// Verify HasMoreOrders is false
	if pos.HasMoreOrders {
		t.Errorf("expected HasMoreOrders=false after filling all, got %v", pos.HasMoreOrders)
	}
}

// T065: Canonical gap-down scenario from SDD § 3.2 with exact prices and quantities
// Scenario: Configured orders at P=[100, 98, 95.844, 93.525] with amounts=[14.29, 28.57, 57.14, 142.86]
// Candle gaps down to open=92, low=91.5
// Expected fills: all 4 orders at exact prices
func TestGapDown_T065_CanonicalGapDownScenario(t *testing.T) {
	ctx := context.Background()
	tradeID := "canonical-gap-down"
	openTime := time.Date(2024, 1, 15, 9, 0, 0, 0, time.UTC)

	// Canonical price sequence: P_n = P_{n-1} * (1 - 0.02/100 * 1.1^(n-1))
	// P_0 = 100, P_1 = 98, P_2 = 95.844, P_3 = 93.525 (approx)
	prices := mustDecimalSlice("100.00", "98.00", "95.84400000", "93.52457520")
	// Amounts: geometric sequence with scale=2.0, total=1000
	// R = (2^4 - 1)/(2-1) = 15
	// A_0 = 1000 * 2^0 / 15 ≈ 66.67
	// A_1 = 1000 * 2^1 / 15 ≈ 133.33
	// A_2 = 1000 * 2^2 / 15 ≈ 266.67
	// A_3 = 1000 * 2^3 / 15 ≈ 533.33
	amounts := mustDecimalSlice("66.66666667", "133.33333333", "266.66666667", "533.33333333")

	pos := NewPosition(tradeID, openTime, prices, amounts)

	// Setup: first market buy executed
	pos.State = StateOpening
	pos.NextOrderIndex = 1
	pos.OpenPrice = prices[0]                                // 100.00
	pos.PositionQuantity = mustDecimal("1.0")                // qty for first order
	pos.AverageEntryPrice = prices[0]                        // 100.00
	pos.FeesAccumulated = CalculateFee(prices[0], mustDecimal("1.0"), OrderTypeMarket, 1)
	pos.Orders = []OrderFill{
		{
			OrderIndex:       0,
			OrderNumber:      1,
			OrderType:        OrderTypeMarket,
			ExecutedPrice:    prices[0],
			ExecutedQuantity: mustDecimal("1.0"),
			QuoteAmount:      amounts[0],
			Timestamp:        openTime,
			Fee:              pos.FeesAccumulated,
		},
	}
	pos.HasMoreOrders = true

	// Gap-down candle
	gapDownTime := openTime.Add(time.Minute)
	gapDownCandle := &Candle{
		Timestamp: gapDownTime,
		Open:      mustDecimal("92.00"),  // Opens below P_1, P_2, and P_3
		High:      mustDecimal("92.50"),
		Low:       mustDecimal("91.50"),  // Below all remaining orders
		Close:     mustDecimal("92.00"),
		Volume:    mustDecimal("5000000"),
	}

	// Execute gap-down fill
	fills := FillOrdersForCandle(ctx, pos, gapDownCandle.Low)

	// Should fill all 3 remaining orders
	if len(fills) != 3 {
		t.Errorf("expected 3 fills in canonical scenario, got %d", len(fills))
	}

	// Verify exact fill data
	expectedFills := []struct {
		orderNumber  int
		price        decimal.Decimal
		quoteAmount  decimal.Decimal
	}{
		{2, prices[1], amounts[1]}, // P_1 = 98.00, A_1
		{3, prices[2], amounts[2]}, // P_2 = 95.844, A_2
		{4, prices[3], amounts[3]}, // P_3 = 93.525, A_3
	}

	for i, expected := range expectedFills {
		if i >= len(fills) {
			break
		}
		fill := fills[i]

		if fill.OrderNumber != expected.orderNumber {
			t.Errorf("fill #%d: expected OrderNumber=%d, got %d", i+1, expected.orderNumber, fill.OrderNumber)
		}
		if !fill.ExecutedPrice.Equal(expected.price) {
			t.Errorf("fill #%d: expected price=%s, got %s", i+1, expected.price.String(), fill.ExecutedPrice.String())
		}
		if !fill.QuoteAmount.Equal(expected.quoteAmount) {
			t.Errorf("fill #%d: expected quoteAmount=%s, got %s", i+1, expected.quoteAmount.String(), fill.QuoteAmount.String())
		}
	}

	// Verify Gap-Down Paradox Rule is applied: fills are at exact P_n, NOT interpolated
	for i, fill := range fills {
		// None of the prices should be at open=92 or low=91.5
		if fill.ExecutedPrice.Equal(gapDownCandle.Open) || fill.ExecutedPrice.Equal(gapDownCandle.Low) {
			t.Errorf("fill #%d: Gap-Down Paradox Rule violated! Fill cannot be at open=%s or low=%s, must be at exact P_n",
				i+1, gapDownCandle.Open.String(), gapDownCandle.Low.String())
		}
	}
}
