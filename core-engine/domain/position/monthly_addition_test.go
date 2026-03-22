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
// T088: PSM must NOT emit MonthlyAdditionEvent at the 43,200-candle boundary.
// Monthly capital injection is now exclusively managed by the Orchestrator via
// globalCandleCount. The PSM's ProcessCandle no longer contains the %43200 block.
// ============================================================================
func TestUS5_T088_PSMDoesNotEmitMonthlyAdditionEvent(t *testing.T) {
	sm := NewStateMachine()

	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	prices := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts := mustDecimalSlice("10.00", "20.00", "30.00")
	pos := NewPosition("test-monthly-boundary", startTime, prices, amounts)
	pos.AccountBalance = mustDecimal("1000.00")
	pos.MonthlyAddition = mustDecimal("100.00")

	basePrice := mustDecimal("100.00")
	var monthlyAdditionEventCount int

	// Process exactly 43200 candles (30 days)
	for i := int64(0); i < 43200; i++ {
		candle := generateCandle(startTime.Add(time.Duration(i)*time.Minute), basePrice)
		events, err := sm.ProcessCandle(pos, candle)
		if err != nil {
			t.Fatalf("ProcessCandle %d failed: %v", i, err)
		}
		for _, evt := range events {
			if evt.EventType() == "monthly.addition" {
				monthlyAdditionEventCount++
			}
		}
	}

	// Verify CandleCount is still tracked correctly
	if pos.CandleCount != 43200 {
		t.Errorf("after 43200 candles, expected CandleCount=43200, got %d", pos.CandleCount)
	}

	// PSM must NOT have emitted any MonthlyAdditionEvent — that is now the Orchestrator's job
	if monthlyAdditionEventCount > 0 {
		t.Errorf("expected 0 MonthlyAdditionEvents from PSM over 43200 candles, got %d", monthlyAdditionEventCount)
	}
}

// ============================================================================
// T089: PSM must NOT modify AccountBalance at the 43,200-candle boundary.
// Balance updates at monthly boundaries are exclusively managed by the Orchestrator.
// ============================================================================
func TestUS5_T089_PSMDoesNotModifyAccountBalanceAtMonthlyBoundary(t *testing.T) {
	sm := NewStateMachine()

	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	prices := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts := mustDecimalSlice("10.00", "20.00", "30.00")
	pos := NewPosition("test-balance-unchanged", startTime, prices, amounts)
	initialBalance := mustDecimal("1000.00")
	pos.AccountBalance = initialBalance
	pos.MonthlyAddition = mustDecimal("100.00")

	basePrice := mustDecimal("100.00")

	// Process exactly 43200 candles (30 days)
	for i := int64(0); i < 43200; i++ {
		candle := generateCandle(startTime.Add(time.Duration(i)*time.Minute), basePrice)
		_, err := sm.ProcessCandle(pos, candle)
		if err != nil {
			t.Fatalf("ProcessCandle %d failed: %v", i, err)
		}
	}

	// AccountBalance must equal the initial value — PSM must not have modified it
	if !pos.AccountBalance.Equal(initialBalance) {
		t.Errorf("expected AccountBalance unchanged at %v after 43200 PSM candles, got %v",
			initialBalance, pos.AccountBalance)
	}
}

// ============================================================================
// T090: After 43,200 PSM candles, pos.AccountBalance is unchanged regardless of
// MonthlyAddition value. The Orchestrator, not the PSM, is responsible for
// updating the running balance at monthly boundaries.
// ============================================================================
func TestUS5_T090_PSMDoesNotModifyBalanceAcrossMultipleBoundaries(t *testing.T) {
	sm := NewStateMachine()

	startTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	prices := mustDecimalSlice("100.00", "98.00", "95.84")
	amounts := mustDecimalSlice("10.00", "20.00", "30.00")
	pos := NewPosition("test-no-psm-balance-mutation", startTime, prices, amounts)
	initialBalance := mustDecimal("1000.00")
	pos.AccountBalance = initialBalance
	pos.MonthlyAddition = mustDecimal("500.00") // large amount — must not affect balance

	basePrice := mustDecimal("100.00")

	// Process 86400 candles (2 × 30-day boundaries) to ensure no injection fires at either
	for i := int64(0); i < 86400; i++ {
		candle := generateCandle(startTime.Add(time.Duration(i)*time.Minute), basePrice)
		_, err := sm.ProcessCandle(pos, candle)
		if err != nil {
			t.Fatalf("ProcessCandle %d failed: %v", i, err)
		}
	}

	// AccountBalance must remain exactly the initial value throughout
	if !pos.AccountBalance.Equal(initialBalance) {
		t.Errorf("expected AccountBalance=%v after 2 monthly boundaries through PSM, got %v",
			initialBalance, pos.AccountBalance)
	}

	// CandleCount must be accurate
	if pos.CandleCount != 86400 {
		t.Errorf("expected CandleCount=86400, got %d", pos.CandleCount)
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
