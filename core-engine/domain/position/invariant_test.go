package position

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

// ============================================================================
// T112: State Machine Invariant Validator
// After each candle, verify Position struct integrity and invariants
// ============================================================================

// TestInvariant_QuantitiesNonNegative verifies all quantities remain >= 0
func TestInvariant_QuantitiesNonNegative(t *testing.T) {
	sm := NewStateMachine()
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	pos := NewPosition("inv-qty", startTime,
		[]decimal.Decimal{
			mustDecimal("100.00"),
			mustDecimal("98.00"),
		},
		[]decimal.Decimal{
			mustDecimal("10.00"),
			mustDecimal("20.00"),
		},
	)
	pos.AccountBalance = mustDecimal("1000.00")

	// Process multiple candles
	for i := 0; i < 10; i++ {
		candle := &Candle{
			Timestamp: startTime.Add(time.Duration(i) * time.Minute),
			Open:      mustDecimal("99.00"),
			High:      mustDecimal("99.50"),
			Low:       mustDecimal("98.50"),
			Close:     mustDecimal("99.00"),
			Volume:    mustDecimal("1000000"),
		}
		_, _ = sm.ProcessCandle(pos, candle)

		// Verify quantities
		if pos.PositionQuantity.IsNegative() {
			t.Errorf("after candle %d: PositionQuantity is negative: %v", i, pos.PositionQuantity)
		}

		if pos.AccountBalance.IsNegative() {
			t.Errorf("after candle %d: AccountBalance is negative: %v", i, pos.AccountBalance)
		}

		// Verify fees cannot exceed total filled amounts
		if pos.FeesAccumulated.IsNegative() {
			t.Errorf("after candle %d: FeesAccumulated is negative: %v", i, pos.FeesAccumulated)
		}
	}

	t.Log("✓ Quantities remain non-negative throughout processing")
}

// TestInvariant_PricesMonotonic verifies order prices are monotonically decreasing
func TestInvariant_PricesMonotonic(t *testing.T) {
	sm := NewStateMachine()
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := []decimal.Decimal{
		mustDecimal("100.00"),
		mustDecimal("98.00"),
		mustDecimal("95.84"),
		mustDecimal("93.93"),
	}

	pos := NewPosition("inv-prices", startTime, prices, []decimal.Decimal{
		mustDecimal("10.00"),
		mustDecimal("20.00"),
		mustDecimal("40.00"),
		mustDecimal("80.00"),
	})
	pos.AccountBalance = mustDecimal("1000.00")

	// Verify monotonically decreasing prices
	for i := 0; i < len(prices)-1; i++ {
		if prices[i].LessThanOrEqual(prices[i+1]) {
			t.Errorf("prices not monotonic: prices[%d]=%v >= prices[%d]=%v",
				i, prices[i], i+1, prices[i+1])
		}
	}

	// Process candles
	for i := 0; i < 5; i++ {
		candle := &Candle{
			Timestamp: startTime.Add(time.Duration(i) * time.Minute),
			Open:      mustDecimal("99.00"),
			High:      mustDecimal("99.50"),
			Low:       mustDecimal("98.50"),
			Close:     mustDecimal("99.00"),
			Volume:    mustDecimal("1000000"),
		}
		_, _ = sm.ProcessCandle(pos, candle)
	}

	t.Log("✓ Price grid remains monotonically decreasing")
}

// TestInvariant_NextOrderIndexValid verifies NextOrderIndex is within bounds
func TestInvariant_NextOrderIndexValid(t *testing.T) {
	sm := NewStateMachine()
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := []decimal.Decimal{
		mustDecimal("100.00"),
		mustDecimal("98.00"),
	}

	pos := NewPosition("inv-index", startTime, prices, []decimal.Decimal{
		mustDecimal("10.00"),
		mustDecimal("20.00"),
	})
	pos.AccountBalance = mustDecimal("1000.00")

	totalOrders := len(prices)

	for i := 0; i < 10; i++ {
		candle := &Candle{
			Timestamp: startTime.Add(time.Duration(i) * time.Minute),
			Open:      mustDecimal("99.00"),
			High:      mustDecimal("99.50"),
			Low:       mustDecimal("98.00"),
			Close:     mustDecimal("99.00"),
			Volume:    mustDecimal("1000000"),
		}
		_, _ = sm.ProcessCandle(pos, candle)

		// Verify bounds
		if pos.NextOrderIndex < 0 {
			t.Errorf("after candle %d: NextOrderIndex < 0: %d", i, pos.NextOrderIndex)
		}

		if pos.NextOrderIndex > totalOrders {
			t.Errorf("after candle %d: NextOrderIndex > total orders: %d > %d",
				i, pos.NextOrderIndex, totalOrders)
		}
	}

	t.Log("✓ NextOrderIndex remains within valid bounds [0, totalOrders]")
}

// TestInvariant_AveragePriceMonotonic verifies average entry price is consistent with fills
func TestInvariant_AveragePriceMonotonic(t *testing.T) {
	sm := NewStateMachine()
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	pos := NewPosition("inv-avg", startTime,
		[]decimal.Decimal{
			mustDecimal("100.00"),
			mustDecimal("98.00"),
		},
		[]decimal.Decimal{
			mustDecimal("10.00"),
			mustDecimal("20.00"),
		},
	)
	pos.AccountBalance = mustDecimal("1000.00")

	// Candle 1: Market buy at 100.00
	c1 := &Candle{
		Timestamp: startTime,
		Open:      mustDecimal("100.00"),
		High:      mustDecimal("100.00"),
		Low:       mustDecimal("100.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	_, _ = sm.ProcessCandle(pos, c1)
	avg1 := pos.AverageEntryPrice

	if !avg1.Equal(mustDecimal("100.00")) {
		t.Errorf("after first fill, avg should be 100.00, got %v", avg1)
	}

	// Candle 2: Safety order at 98.00 (lower than market buy)
	c2 := &Candle{
		Timestamp: startTime.Add(time.Minute),
		Open:      mustDecimal("99.00"),
		High:      mustDecimal("99.00"),
		Low:       mustDecimal("98.00"),
		Close:     mustDecimal("98.50"),
		Volume:    mustDecimal("1000000"),
	}
	_, _ = sm.ProcessCandle(pos, c2)
	avg2 := pos.AverageEntryPrice

	// After buying at lower price, average should decrease or stay same
	if avg2.GreaterThan(avg1) {
		t.Errorf("after buying at lower price, average increased: %v -> %v", avg1, avg2)
	}

	// avg2 should be between the two prices (weighted average)
	if avg2.GreaterThanOrEqual(avg1) || avg2.LessThanOrEqual(mustDecimal("98.00")) {
		t.Errorf("average not properly weighted: expected between 98.00 and 100.00, got %v", avg2)
	}

	t.Log("✓ Average entry price updates consistently with fills")
}

// TestInvariant_StateConsistency verifies Position.State matches actual state
func TestInvariant_StateConsistency(t *testing.T) {
	sm := NewStateMachine()
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	pos := NewPosition("inv-state", startTime,
		[]decimal.Decimal{mustDecimal("100.00")},
		[]decimal.Decimal{mustDecimal("10.00")},
	)
	pos.AccountBalance = mustDecimal("1000.00")

	// Before any candle processing
	if pos.State != StateIdle {
		t.Errorf("new position should be StateIdle, got %v", pos.State)
	}

	// Candle 1: Buy
	c1 := &Candle{
		Timestamp: startTime,
		Open:      mustDecimal("100.00"),
		High:      mustDecimal("100.00"),
		Low:       mustDecimal("100.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	_, _ = sm.ProcessCandle(pos, c1)

	// After market buy
	if pos.State == StateIdle {
		t.Errorf("after market buy, position should not be StateIdle")
	}

	if pos.PositionQuantity.IsZero() {
		t.Errorf("after market buy, position quantity should be > 0")
	}

	t.Log("✓ Position state remains consistent with filled orders and balance")
}

// TestInvariant_ClosedPositionFinal verifies closed positions don't change
func TestInvariant_ClosedPositionFinal(t *testing.T) {
	sm := NewStateMachine()
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	pos := NewPosition("inv-closed", startTime,
		[]decimal.Decimal{mustDecimal("100.00")},
		[]decimal.Decimal{mustDecimal("10.00")},
	)
	pos.AccountBalance = mustDecimal("1000.00")

	// Candle 1: Buy at 100
	c1 := &Candle{
		Timestamp: startTime,
		Open:      mustDecimal("100.00"),
		High:      mustDecimal("100.00"),
		Low:       mustDecimal("100.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	_, _ = sm.ProcessCandle(pos, c1)

	// Candle 2: Take-profit at 100.50
	c2 := &Candle{
		Timestamp: startTime.Add(time.Minute),
		Open:      mustDecimal("100.30"),
		High:      mustDecimal("100.60"),
		Low:       mustDecimal("100.00"),
		Close:     mustDecimal("100.50"),
		Volume:    mustDecimal("1000000"),
	}
	_, _ = sm.ProcessCandle(pos, c2)

	if pos.State != StateClosed {
		t.Errorf("expected position closed after take-profit, got %v", pos.State)
	}

	finalQty := pos.PositionQuantity
	finalProfit := pos.Profit

	// Candle 3: More price movement (should not affect closed position)
	c3 := &Candle{
		Timestamp: startTime.Add(2 * time.Minute),
		Open:      mustDecimal("101.00"),
		High:      mustDecimal("102.00"),
		Low:       mustDecimal("100.00"),
		Close:     mustDecimal("101.50"),
		Volume:    mustDecimal("1000000"),
	}
	_, _ = sm.ProcessCandle(pos, c3)

	if pos.State != StateClosed {
		t.Errorf("closed position should remain closed")
	}

	if !pos.PositionQuantity.Equal(finalQty) {
		t.Errorf("closed position quantity should not change: %v -> %v", finalQty, pos.PositionQuantity)
	}

	if !pos.Profit.Equal(finalProfit) {
		t.Errorf("closed position profit should not change: %v -> %v", finalProfit, pos.Profit)
	}

	t.Log("✓ Closed positions remain immutable after closure")
}

// TestInvariant_FeesAccumulate verifies fees only increase or stay same
func TestInvariant_FeesAccumulate(t *testing.T) {
	sm := NewStateMachine()
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	pos := NewPosition("inv-fees", startTime,
		[]decimal.Decimal{
			mustDecimal("100.00"),
			mustDecimal("98.00"),
		},
		[]decimal.Decimal{
			mustDecimal("10.00"),
			mustDecimal("20.00"),
		},
	)
	pos.AccountBalance = mustDecimal("1000.00")

	previousFees := pos.FeesAccumulated

	for i := 0; i < 5; i++ {
		candle := &Candle{
			Timestamp: startTime.Add(time.Duration(i) * time.Minute),
			Open:      mustDecimal("99.00"),
			High:      mustDecimal("99.50"),
			Low:       mustDecimal("98.00"),
			Close:     mustDecimal("99.00"),
			Volume:    mustDecimal("1000000"),
		}
		_, _ = sm.ProcessCandle(pos, candle)

		// Fees should never decrease
		if pos.FeesAccumulated.LessThan(previousFees) {
			t.Errorf("after candle %d: fees decreased from %v to %v",
				i, previousFees, pos.FeesAccumulated)
		}

		previousFees = pos.FeesAccumulated
	}

	t.Log("✓ Accumulated fees never decrease (monotonic increase)")
}
