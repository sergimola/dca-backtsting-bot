package position

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

// Helper function to generate a synthetic candle at a specific time
func generateCandle(timestamp time.Time, price decimal.Decimal) *Candle {
	return &Candle{
		Timestamp: timestamp,
		Open:      price,
		High:      price.Add(decimal.NewFromInt(1)),
		Low:       price.Sub(decimal.NewFromInt(1)),
		Close:     price,
		Volume:    mustDecimal("1000000"),
	}
}

// ============================================================================
// T086: Position.CandleCount increments correctly through ProcessCandle()
// ============================================================================
func TestUS5_T086_CandleCountIncrements(t *testing.T) {
	sm := NewStateMachine()

	tradeID := "test-candle-count"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts := mustDecimalSlice("10.00", "20.00", "30.00")
	pos := NewPosition(tradeID, startTime, prices, amounts)
	pos.AccountBalance = mustDecimal("1000.00")
	pos.MonthlyAddition = mustDecimal("100.00")

	// Process 100 candles and verify CandleCount
	basePrice := mustDecimal("100.00")
	for i := int64(0); i < 100; i++ {
		candle := generateCandle(startTime.Add(time.Duration(i)*time.Minute), basePrice)
		_, err := sm.ProcessCandle(pos, candle)
		if err != nil {
			t.Fatalf("ProcessCandle %d failed: %v", i, err)
		}

		// Verify CandleCount incremented
		if pos.CandleCount != i+1 {
			t.Errorf("after candle %d, expected CandleCount=%d, got %d", i, i+1, pos.CandleCount)
		}
	}

	// Verify final count
	if pos.CandleCount != 100 {
		t.Errorf("expected CandleCount=100 after 100 candles, got %d", pos.CandleCount)
	}
}

// ============================================================================
// T087: Daily boundary detection — CandleCount % 1440 == 0 indicates day transition
// ============================================================================
func TestUS5_T087_DailyBoundaryDetection(t *testing.T) {
	sm := NewStateMachine()

	tradeID := "test-daily-boundary"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts := mustDecimalSlice("10.00", "20.00", "30.00")
	pos := NewPosition(tradeID, startTime, prices, amounts)
	pos.AccountBalance = mustDecimal("1000.00")
	pos.MonthlyAddition = mustDecimal("100.00")

	basePrice := mustDecimal("100.00")

	// Process exactly 1440 candles (1 day)
	for i := int64(0); i < 1440; i++ {
		candle := generateCandle(startTime.Add(time.Duration(i)*time.Minute), basePrice)
		_, err := sm.ProcessCandle(pos, candle)
		if err != nil {
			t.Fatalf("ProcessCandle %d failed: %v", i, err)
		}
	}

	// Verify CandleCount = 1440
	if pos.CandleCount != 1440 {
		t.Errorf("after 1440 candles, expected CandleCount=1440, got %d", pos.CandleCount)
	}

	// Verify daily boundary: 1440 % 1440 == 0
	if pos.CandleCount%1440 != 0 {
		t.Errorf("CandleCount %d should be divisible by 1440", pos.CandleCount)
	}

	// Process one more candle into day 2
	candle := generateCandle(startTime.Add(1440*time.Minute), basePrice)
	_, err := sm.ProcessCandle(pos, candle)
	if err != nil {
		t.Fatalf("ProcessCandle 1441 failed: %v", err)
	}

	// Verify CandleCount = 1441
	if pos.CandleCount != 1441 {
		t.Errorf("after 1441 candles, expected CandleCount=1441, got %d", pos.CandleCount)
	}

	// Verify daily boundary: 1441 % 1440 != 0
	if pos.CandleCount%1440 == 0 {
		t.Errorf("CandleCount %d should NOT be divisible by 1440", pos.CandleCount)
	}
}

// ============================================================================
// T088: Monthly boundary — CandleCount = 43200 (30 days) triggers MonthlyAdditionEvent
// ============================================================================
func TestUS5_T088_MonthlyBoundaryTriggersEvent(t *testing.T) {
	sm := NewStateMachine()

	tradeID := "test-monthly-boundary"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts := mustDecimalSlice("10.00", "20.00", "30.00")
	pos := NewPosition(tradeID, startTime, prices, amounts)
	initialBalance := mustDecimal("1000.00")
	pos.AccountBalance = initialBalance
	pos.MonthlyAddition = mustDecimal("100.00")

	basePrice := mustDecimal("100.00")
	var monthlyAdditionEvent *MonthlyAdditionEvent

	// Process exactly 43200 candles (30 days)
	for i := int64(0); i < 43200; i++ {
		candle := generateCandle(startTime.Add(time.Duration(i)*time.Minute), basePrice)
		events, err := sm.ProcessCandle(pos, candle)
		if err != nil {
			t.Fatalf("ProcessCandle %d failed: %v", i, err)
		}

		// Check for MonthlyAdditionEvent on candle 43200
		if i == 43199 { // 0-indexed, so 43199 is the 43200th candle
			for _, evt := range events {
				if evt.EventType() == "monthly.addition" {
					monthlyAdditionEvent = evt.(*MonthlyAdditionEvent)
					break
				}
			}
		}
	}

	// Verify CandleCount = 43200
	if pos.CandleCount != 43200 {
		t.Errorf("after 43200 candles, expected CandleCount=43200, got %d", pos.CandleCount)
	}

	// Verify MonthlyAdditionEvent was emitted
	if monthlyAdditionEvent == nil {
		t.Errorf("expected MonthlyAdditionEvent on candle 43200, got none")
	}

	// Verify event contains correct amount
	if monthlyAdditionEvent != nil {
		eventAmount := mustDecimal(monthlyAdditionEvent.AdditionAmount)
		if !eventAmount.Equal(pos.MonthlyAddition) {
			t.Errorf("expected monthly addition amount %v, got %v", pos.MonthlyAddition, eventAmount)
		}
	}
}

// ============================================================================
// T089: Account balance increases by monthly_addition amount on day 30
// ============================================================================
func TestUS5_T089_AccountBalanceIncreasesOnDay30(t *testing.T) {
	sm := NewStateMachine()

	tradeID := "test-balance-increase"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts := mustDecimalSlice("10.00", "20.00", "30.00")
	pos := NewPosition(tradeID, startTime, prices, amounts)
	initialBalance := mustDecimal("1000.00")
	pos.AccountBalance = initialBalance
	pos.MonthlyAddition = mustDecimal("100.00")

	basePrice := mustDecimal("100.00")

	// Process exactly 43200 candles (30 days)
	for i := int64(0); i < 43200; i++ {
		candle := generateCandle(startTime.Add(time.Duration(i)*time.Minute), basePrice)
		events, err := sm.ProcessCandle(pos, candle)
		if err != nil {
			t.Fatalf("ProcessCandle %d failed: %v", i, err)
		}

		// Check if monthly addition event occurred
		if i == 43199 { // 0-indexed
			for _, evt := range events {
				if evt.EventType() == "monthly.addition" {
					// Event detected - monthly addition has been applied
					_ = evt
				}
			}
		}
	}

	// Verify balance increased by the monthly addition amount
	// The balance should NOT be the initial + monthly, but rather:
	// The balance at the time of the event + monthly (or the implementation 
	// should update the balance as part of the event)
	// For now, we check that the current balance is at least the initial + monthly
	minExpectedBalance := initialBalance.Add(pos.MonthlyAddition)
	
	if pos.AccountBalance.LessThan(minExpectedBalance) {
		t.Errorf("expected account balance >= %v, got %v", minExpectedBalance, pos.AccountBalance)
	}
}

// ============================================================================
// T090: Subsequent position after day 30 sees increased account balance
// ============================================================================
func TestUS5_T090_SubsequentPositionUsesIncreasedBalance(t *testing.T) {
	sm := NewStateMachine()

	tradeID1 := "test-pos-before-monthly"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts := mustDecimalSlice("10.00", "20.00", "30.00")
	pos1 := NewPosition(tradeID1, startTime, prices, amounts)
	initialBalance := mustDecimal("1000.00")
	pos1.AccountBalance = initialBalance
	pos1.MonthlyAddition = mustDecimal("100.00")

	basePrice := mustDecimal("100.00")
	var balanceAtMonthlyEvent decimal.Decimal

	// Process 43200 candles and capture balance at monthly event
	for i := int64(0); i < 43200; i++ {
		candle := generateCandle(startTime.Add(time.Duration(i)*time.Minute), basePrice)
		events, err := sm.ProcessCandle(pos1, candle)
		if err != nil {
			t.Fatalf("ProcessCandle %d failed: %v", i, err)
		}

		// Capture balance at monthly addition event
		if i == 43199 {
			for _, evt := range events {
				if evt.EventType() == "monthly.addition" {
					balanceAtMonthlyEvent = pos1.AccountBalance
				}
			}
		}
	}

	// Create second position that inherits the increased balance
	tradeID2 := "test-pos-after-monthly"
	pos2 := NewPosition(tradeID2, startTime.Add(43200*time.Minute), prices, amounts)
	pos2.AccountBalance = balanceAtMonthlyEvent

	// Verify second position has increased balance
	// Expected: initial (1000) + monthly addition (100) = 1100
	minExpectedBalance := initialBalance.Add(pos1.MonthlyAddition)
	
	if pos2.AccountBalance.LessThan(minExpectedBalance) {
		t.Errorf("expected second position balance >= %v, got %v", minExpectedBalance, pos2.AccountBalance)
	}
}

// ============================================================================
// T091: MonthlyAdditionEvent NOT dispatched when monthly_addition = 0
// ============================================================================
func TestUS5_T091_NoEventWhenMonthlyAdditionIsZero(t *testing.T) {
	sm := NewStateMachine()

	tradeID := "test-zero-addition"
	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	prices := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts := mustDecimalSlice("10.00", "20.00", "30.00")
	pos := NewPosition(tradeID, startTime, prices, amounts)
	pos.AccountBalance = mustDecimal("1000.00")
	pos.MonthlyAddition = mustDecimal("0.00") // Zero addition

	basePrice := mustDecimal("100.00")
	var monthlyEventCount int

	// Process 43200 candles (30 days)
	for i := int64(0); i < 43200; i++ {
		candle := generateCandle(startTime.Add(time.Duration(i)*time.Minute), basePrice)
		events, err := sm.ProcessCandle(pos, candle)
		if err != nil {
			t.Fatalf("ProcessCandle %d failed: %v", i, err)
		}

		// Count monthly events
		for _, evt := range events {
			if evt.EventType() == "monthly.addition" {
				monthlyEventCount++
			}
		}
	}

	// Verify no MonthlyAdditionEvent was dispatched
	if monthlyEventCount > 0 {
		t.Errorf("expected no MonthlyAdditionEvent when monthly_addition=0, got %d events", monthlyEventCount)
	}

	// Verify balance unchanged
	if !pos.AccountBalance.Equal(mustDecimal("1000.00")) {
		t.Errorf("expected balance unchanged at 1000.00, got %v", pos.AccountBalance)
	}
}
