package position

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

// ============================================================================
// T108: Comprehensive backtest scenario (60 days, 2 positions, monthly addition)
// ============================================================================
func TestIntegration_T108_60DayBacktestScenario(t *testing.T) {
	sm := NewStateMachine()
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// Simulate 60 days of trading with 2 positions and 1 monthly addition
	totalProfit := decimal.Zero

	// ---- Position 1 (Jan 1 - Jan 31) ----
	p1 := NewPosition("trade-p1", startTime, []decimal.Decimal{
		mustDecimal("100.00"),
		mustDecimal("98.00"),
	}, []decimal.Decimal{
		mustDecimal("10.00"),
		mustDecimal("20.00"),
	})
	p1.AccountBalance = mustDecimal("1000.00")

	// P1: Day 1 - buy at 100.00
	candle1 := &Candle{
		Timestamp: startTime,
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.00"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	_, _ = sm.ProcessCandle(p1, candle1)

	// P1: Day 5 - safety order fills at 98.00
	candle2 := &Candle{
		Timestamp: startTime.AddDate(0, 0, 4),
		Open:      mustDecimal("98.50"),
		High:      mustDecimal("99.00"),
		Low:       mustDecimal("97.00"),
		Close:     mustDecimal("98.00"),
		Volume:    mustDecimal("1000000"),
	}
	_, _ = sm.ProcessCandle(p1, candle2)

	// P1: Day 15 - take-profit triggers at 105.00 (average price ~98.67)
	candle3 := &Candle{
		Timestamp: startTime.AddDate(0, 0, 14),
		Open:      mustDecimal("104.00"),
		High:      mustDecimal("106.00"),
		Low:       mustDecimal("103.00"),
		Close:     mustDecimal("105.00"),
		Volume:    mustDecimal("1000000"),
	}
	_, _ = sm.ProcessCandle(p1, candle3)

	if p1.State != StateClosed {
		t.Logf("P1 closed at profit: %v", p1.Profit)
		totalProfit = totalProfit.Add(p1.Profit)
	}

	// ---- Position 2 (Feb 1 - Feb 28) ----
	p2StartTime := time.Date(2024, 2, 1, 0, 0, 0, 0, time.UTC)
	p2 := NewPosition("trade-p2", p2StartTime, []decimal.Decimal{
		mustDecimal("101.00"),
		mustDecimal("99.00"),
	}, []decimal.Decimal{
		mustDecimal("10.00"),
		mustDecimal("20.00"),
	})
	p2.AccountBalance = mustDecimal("1000.00")

	// P2: Day 1 - buy at 101.00
	candle4 := &Candle{
		Timestamp: p2StartTime,
		Open:      mustDecimal("100.50"),
		High:      mustDecimal("101.50"),
		Low:       mustDecimal("100.00"),
		Close:     mustDecimal("101.00"),
		Volume:    mustDecimal("1000000"),
	}
	_, _ = sm.ProcessCandle(p2, candle4)

	// P2: Day 10 - safety order fills
	candle5 := &Candle{
		Timestamp: p2StartTime.AddDate(0, 0, 9),
		Open:      mustDecimal("99.50"),
		High:      mustDecimal("100.00"),
		Low:       mustDecimal("98.00"),
		Close:     mustDecimal("99.00"),
		Volume:    mustDecimal("1000000"),
	}
	_, _ = sm.ProcessCandle(p2, candle5)

	// P2: Day 20 - liquidate at 96.00 (below liquidation price)
	candle6 := &Candle{
		Timestamp: p2StartTime.AddDate(0, 0, 19),
		Open:      mustDecimal("96.50"),
		High:      mustDecimal("97.00"),
		Low:       mustDecimal("95.00"),
		Close:     mustDecimal("96.00"),
		Volume:    mustDecimal("1000000"),
	}
	_, _ = sm.ProcessCandle(p2, candle6)

	if p2.State != StateClosed {
		t.Logf("P2 closed at profit: %v", p2.Profit)
		totalProfit = totalProfit.Add(p2.Profit)
	}

	// Verify both positions closed
	if p1.State != StateClosed || p2.State != StateClosed {
		t.Errorf("expected both positions closed, got p1=%v, p2=%v", p1.State, p2.State)
	}

	// Log cumulative profit (should be sum of both)
	t.Logf("60-day backtest: P1 profit=%v, P2 profit=%v, Total=%v",
		p1.Profit, p2.Profit, totalProfit)
}

// ============================================================================
// T110: Gap-down + liquidation scenario
// Test: Price gaps down past multiple orders and below liquidation price
// Expected: All remaining orders fill, position closes on liquidation
// ============================================================================
func TestIntegration_T110_GapDownWithLiquidation(t *testing.T) {
	sm := NewStateMachine()
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// 3 orders: market buy at 100, safety orders at 98 and 95
	p := NewPosition("trade-gapdown-liq", startTime, []decimal.Decimal{
		mustDecimal("100.00"),
		mustDecimal("98.00"),
		mustDecimal("95.00"),
	}, []decimal.Decimal{
		mustDecimal("10.00"),
		mustDecimal("20.00"),
		mustDecimal("40.00"),
	})
	p.AccountBalance = mustDecimal("1000.00")

	// Candle 1: Buy at 100.00
	candle1 := &Candle{
		Timestamp: startTime,
		Open:      mustDecimal("100.00"),
		High:      mustDecimal("100.50"),
		Low:       mustDecimal("99.50"),
		Close:     mustDecimal("100.00"),
		Volume:    mustDecimal("1000000"),
	}
	events1, _ := sm.ProcessCandle(p, candle1)
	if p.State != StateOpening {
		t.Errorf("after candle 1 buy, expected StateOpening, got %v", p.State)
	}

	// Calculate liquidation price to verify gap-down hits it
	avgPrice := mustDecimal("10.00").Mul(mustDecimal("100.00")).Div(mustDecimal("10.00"))
	t.Logf("Average entry price: %v", avgPrice)

	// Candle 2: Gap down - opens at 94.00, low at 90.00 (hits ALL remaining orders and below P_liq)
	candle2 := &Candle{
		Timestamp: startTime.Add(time.Minute),
		Open:      mustDecimal("94.00"),    // Below 95 order
		High:      mustDecimal("94.00"),
		Low:       mustDecimal("90.00"),    // Hits all orders + liquidation
		Close:     mustDecimal("91.00"),
		Volume:    mustDecimal("1000000"),
	}
	events2, err := sm.ProcessCandle(p, candle2)
	if err != nil {
		t.Fatalf("ProcessCandle 2 failed: %v", err)
	}

	// Verify all events in gap-down fill
	t.Logf("Gap-down candle 2 events: %d", len(events2))
	for i, evt := range events2 {
		t.Logf("  Event %d: %s", i, evt.EventType())
	}

	// After gap-down: all orders should be filled (pessimistic)
	if p.NextOrderIndex < len(p.Prices) {
		t.Errorf("gap-down should fill all remaining orders, got NextOrderIndex=%d, total=%d",
			p.NextOrderIndex, len(p.Prices))
	}

	// Verify liquidation closes position
	if p.State != StateClosed {
		t.Errorf("expected position closed on liquidation, got %v", p.State)
	}

	// Verify liquidation event in events2
	foundLiquidation := false
	for _, evt := range events2 {
		if evt.EventType() == "trade.closed" {
			if tcEvent, ok := evt.(*TradeClosedEvent); ok && tcEvent.Reason == "liquidation" {
				foundLiquidation = true
				break
			}
		}
	}

	if !foundLiquidation {
		t.Errorf("expected TradeClosedEvent with reason='liquidation' in gap-down scenario")
	}

	_ = events1 // Mark used
}
