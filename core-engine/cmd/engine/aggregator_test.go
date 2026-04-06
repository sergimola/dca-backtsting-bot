package main

import (
	"fmt"
	"math"
	"testing"
	"time"

	"dca-bot/core-engine/application/orchestrator"
	"dca-bot/core-engine/domain/position"

	"github.com/shopspring/decimal"
)

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

var testTS = time.Date(2024, 5, 12, 14, 0, 0, 0, time.UTC)

func makeOpenedEvent(tradeID string, orders []position.OrderGrid, entryFee string) orchestrator.Event {
	return orchestrator.Event{
		Timestamp: testTS,
		Type:      orchestrator.EventTypePositionOpened,
		Data: &position.TradeOpenedEvent{
			TradeID:          tradeID,
			Timestamp:        testTS,
			ConfiguredOrders: orders,
			EntryFee:         entryFee,
		},
	}
}

func makeBuyEvent(tradeID string, price, baseSize, fee string, orderNum int) orchestrator.Event {
	return orchestrator.Event{
		Timestamp: testTS,
		Type:      orchestrator.EventTypeBuyOrderExecuted,
		Data: &position.BuyOrderExecutedEvent{
			TradeID:     tradeID,
			Timestamp:   testTS,
			Price:       price,
			BaseSize:    baseSize,
			Fee:         fee,
			OrderNumber: orderNum,
		},
	}
}

func makeSellEvent(tradeID, fee string) orchestrator.Event {
	return orchestrator.Event{
		Timestamp: testTS,
		Type:      orchestrator.EventType("SellOrderExecuted"),
		Data: &position.SellOrderExecutedEvent{
			TradeID:   tradeID,
			Timestamp: testTS,
			Fee:       fee,
		},
	}
}

func makeClosedEvent(tradeID, closingPrice, size, profit string) orchestrator.Event {
	return orchestrator.Event{
		Timestamp: testTS,
		Type:      orchestrator.EventTypePositionClosed,
		Data: &position.TradeClosedEvent{
			TradeID:      tradeID,
			Timestamp:    testTS,
			ClosingPrice: closingPrice,
			Size:         size,
			Profit:       profit,
		},
	}
}

func almostEqual(a, b, tolerance float64) bool {
	return math.Abs(a-b) <= tolerance
}

func makeClosedEventWithReason(tradeID, closingPrice, size, profit, reason string) orchestrator.Event {
	return orchestrator.Event{
		Timestamp: testTS,
		Type:      orchestrator.EventTypePositionClosed,
		Data: &position.TradeClosedEvent{
			TradeID:      tradeID,
			Timestamp:    testTS,
			ClosingPrice: closingPrice,
			Size:         size,
			Profit:       profit,
			Reason:       reason,
		},
	}
}

func makeMonthlyAdditionEvent(amount string) orchestrator.Event {
	return orchestrator.Event{
		Timestamp: testTS,
		Type:      orchestrator.EventType("monthly.addition"),
		Data: &position.MonthlyAdditionEvent{
			Timestamp:      testTS,
			AdditionAmount: amount,
		},
	}
}

// ---------------------------------------------------------------------------
// aggregateBacktestEvents tests
// ---------------------------------------------------------------------------

func TestAggregateBacktestEvents_RoiCalc(t *testing.T) {
	events := []orchestrator.Event{
		makeClosedEvent("t1", "51000", "0.01", "100"),
	}
	balance := decimal.NewFromInt(1000)
	result := aggregateBacktestEvents(events, balance, nil, decimal.Zero)

	want := 10.0 // (100/1000)*100
	if !almostEqual(result.PnlSummary.Roi, want, 0.0001) {
		t.Errorf("ROI = %.6f; want %.6f", result.PnlSummary.Roi, want)
	}
}

func TestAggregateBacktestEvents_MaxDrawdown(t *testing.T) {
	// Trade 1: profit +200 → equity 1200 (peak), drawdown 0
	// Trade 2: profit -100 → equity 1100, drawdown = 100/1200*100 ≈ 8.333%
	// Trade 3: profit +50  → equity 1150, drawdown = 50/1200*100 ≈ 4.167% (lower than peak)
	events := []orchestrator.Event{
		makeClosedEvent("t1", "51000", "0.01", "200"),
		makeClosedEvent("t2", "49500", "0.01", "-100"),
		makeClosedEvent("t3", "50500", "0.01", "50"),
	}
	balance := decimal.NewFromInt(1000)
	result := aggregateBacktestEvents(events, balance, nil, decimal.Zero)

	wantMaxDD := 100.0 / 1200.0 * 100.0 // ≈ 8.3333%
	if !almostEqual(result.PnlSummary.MaxDrawdown, wantMaxDD, 0.001) {
		t.Errorf("MaxDrawdown = %.6f; want ≈ %.6f", result.PnlSummary.MaxDrawdown, wantMaxDD)
	}
}

func TestAggregateBacktestEvents_TotalFees(t *testing.T) {
	events := []orchestrator.Event{
		makeOpenedEvent("t1", []position.OrderGrid{{Price: "50000", Amount: "500"}}, "1.5"),
		makeBuyEvent("t1", "49000", "0.0102", "0.25", 2),
		makeSellEvent("t1", "0.30"),
	}
	balance := decimal.NewFromInt(1000)
	result := aggregateBacktestEvents(events, balance, nil, decimal.Zero)

	wantFees := 2.05
	if !almostEqual(result.PnlSummary.TotalFees, wantFees, 0.0001) {
		t.Errorf("TotalFees = %.6f; want %.6f", result.PnlSummary.TotalFees, wantFees)
	}
}

func TestAggregateBacktestEvents_SafetyOrderCounts(t *testing.T) {
	events := []orchestrator.Event{
		makeBuyEvent("t1", "49000", "0.01", "0.1", 2), // soIndex=1
		makeBuyEvent("t1", "48000", "0.02", "0.1", 2), // soIndex=1
		makeBuyEvent("t1", "47000", "0.03", "0.1", 3), // soIndex=2
	}
	balance := decimal.NewFromInt(1000)
	result := aggregateBacktestEvents(events, balance, nil, decimal.Zero)

	if result.SafetyOrderCounts[1] != 2 {
		t.Errorf("soIndex 1 count = %d; want 2", result.SafetyOrderCounts[1])
	}
	if result.SafetyOrderCounts[2] != 1 {
		t.Errorf("soIndex 2 count = %d; want 1", result.SafetyOrderCounts[2])
	}
	if len(result.SafetyOrderCounts) != 2 {
		t.Errorf("SafetyOrderCounts len = %d; want 2", len(result.SafetyOrderCounts))
	}
}

func TestAggregateBacktestEvents_ZeroBalanceNoRoiPanic(t *testing.T) {
	events := []orchestrator.Event{
		makeClosedEvent("t1", "51000", "0.01", "100"),
	}
	balance := decimal.Zero
	result := aggregateBacktestEvents(events, balance, nil, decimal.Zero)
	// With zero account balance, ROI must be 0 (not a divide-by-zero panic)
	if result.PnlSummary.Roi != 0 {
		t.Errorf("ROI with zero balance = %.6f; want 0", result.PnlSummary.Roi)
	}
}

// ---------------------------------------------------------------------------
// buildTradeEvents tests
// ---------------------------------------------------------------------------

func TestBuildTradeEvents_EntryAndSafetyOrder(t *testing.T) {
	events := []orchestrator.Event{
		makeOpenedEvent("t1", []position.OrderGrid{{Price: "50000", Amount: "500"}}, "1.0"),
		makeBuyEvent("t1", "49000", "0.0123", "0.5", 2),
	}
	result := buildTradeEvents(events)

	if len(result) != 2 {
		t.Fatalf("len = %d; want 2", len(result))
	}

	entry := result[0]
	if entry.EventType != "ENTRY" {
		t.Errorf("result[0].EventType = %q; want ENTRY", entry.EventType)
	}
	if !almostEqual(entry.Price, 50000, 0.001) {
		t.Errorf("entry.Price = %.2f; want 50000", entry.Price)
	}
	if !almostEqual(entry.Quantity, 0.01, 0.0001) {
		t.Errorf("entry.Quantity = %.6f; want 0.01", entry.Quantity)
	}
	if !almostEqual(entry.Balance, 500, 0.001) {
		t.Errorf("entry.Balance = %.2f; want 500", entry.Balance)
	}
	if entry.TradeID != "1" {
		t.Errorf("entry.TradeID = %q; want \"1\"", entry.TradeID)
	}
	if !almostEqual(entry.Fee, 1.0, 0.0001) {
		t.Errorf("entry.Fee = %.4f; want 1.0", entry.Fee)
	}

	so := result[1]
	if so.EventType != "SAFETY_ORDER" {
		t.Errorf("result[1].EventType = %q; want SAFETY_ORDER", so.EventType)
	}
	if !almostEqual(so.Price, 49000, 0.001) {
		t.Errorf("so.Price = %.2f; want 49000", so.Price)
	}
	if !almostEqual(so.Balance, 49000*0.0123, 0.001) {
		t.Errorf("so.Balance = %.4f; want %.4f", so.Balance, 49000*0.0123)
	}
	if so.TradeID != "1" {
		t.Errorf("so.TradeID = %q; want \"1\"", so.TradeID)
	}
}

func TestBuildTradeEvents_ExitFeePatchedFromSellOrder(t *testing.T) {
	events := []orchestrator.Event{
		makeOpenedEvent("t1", []position.OrderGrid{{Price: "50000", Amount: "500"}}, "1.0"),
		makeClosedEvent("t1", "51000", "0.01", "200"),
		makeSellEvent("t1", "2.5"),
	}
	result := buildTradeEvents(events)

	// ENTRY + EXIT
	if len(result) != 2 {
		t.Fatalf("len = %d; want 2", len(result))
	}
	exit := result[1]
	if exit.EventType != "EXIT" {
		t.Errorf("result[1].EventType = %q; want EXIT", exit.EventType)
	}
	if !almostEqual(exit.Fee, 2.5, 0.0001) {
		t.Errorf("EXIT.Fee = %.4f; want 2.5 (patched from SellOrderExecuted)", exit.Fee)
	}
	if !almostEqual(exit.Balance, 200, 0.001) {
		t.Errorf("EXIT.Balance = %.2f; want 200 (profit)", exit.Balance)
	}
}

func TestBuildTradeEvents_MultipleTradesSequentialIds(t *testing.T) {
	events := []orchestrator.Event{
		makeOpenedEvent("t1", []position.OrderGrid{{Price: "50000", Amount: "100"}}, "0.1"),
		makeClosedEvent("t1", "51000", "0.002", "10"),
		makeSellEvent("t1", "0.05"),
		makeOpenedEvent("t2", []position.OrderGrid{{Price: "52000", Amount: "100"}}, "0.1"),
		makeClosedEvent("t2", "53000", "0.002", "10"),
		makeSellEvent("t2", "0.05"),
		makeOpenedEvent("t3", []position.OrderGrid{{Price: "54000", Amount: "100"}}, "0.1"),
		makeClosedEvent("t3", "55000", "0.002", "10"),
		makeSellEvent("t3", "0.05"),
	}
	result := buildTradeEvents(events)

	// 3 ENTRY + 3 EXIT = 6
	if len(result) != 6 {
		t.Fatalf("len = %d; want 6", len(result))
	}

	wantIDs := []string{"1", "1", "2", "2", "3", "3"}
	for i, te := range result {
		if te.TradeID != wantIDs[i] {
			t.Errorf("result[%d].TradeID = %q; want %q", i, te.TradeID, wantIDs[i])
		}
	}

	wantTypes := []string{"ENTRY", "EXIT", "ENTRY", "EXIT", "ENTRY", "EXIT"}
	for i, te := range result {
		if te.EventType != wantTypes[i] {
			t.Errorf("result[%d].EventType = %q; want %q", i, te.EventType, wantTypes[i])
		}
	}
}

func TestBuildTradeEvents_SellOrderNeverEmitted(t *testing.T) {
	// SellOrderExecuted must not appear as its own event in the result.
	events := []orchestrator.Event{
		makeOpenedEvent("t1", []position.OrderGrid{{Price: "50000", Amount: "100"}}, "0.1"),
		makeClosedEvent("t1", "51000", "0.002", "10"),
		makeSellEvent("t1", "0.3"),
	}
	result := buildTradeEvents(events)
	if len(result) != 2 {
		t.Errorf("len = %d; want 2 (SellOrderExecuted must not produce an event)", len(result))
	}
}

// ---------------------------------------------------------------------------
// buildSafetyOrderUsage tests
// ---------------------------------------------------------------------------

func TestBuildSafetyOrderUsage_SortedAscending(t *testing.T) {
	counts := map[int]int{
		2: 5,
		0: 3,
		1: 7,
	}
	result := buildSafetyOrderUsage(counts)

	if len(result) != 3 {
		t.Fatalf("len = %d; want 3", len(result))
	}

	wantLevels := []string{"1", "2", "3"}
	wantCounts := []int{3, 7, 5}
	for i, e := range result {
		if e.Level != wantLevels[i] {
			t.Errorf("result[%d].Level = %q; want %q", i, e.Level, wantLevels[i])
		}
		if e.Count != wantCounts[i] {
			t.Errorf("result[%d].Count = %d; want %d", i, e.Count, wantCounts[i])
		}
	}
}

func TestBuildSafetyOrderUsage_EmptyMapReturnsEmptySlice(t *testing.T) {
	result := buildSafetyOrderUsage(map[int]int{})
	if len(result) != 0 {
		t.Errorf("len = %d; want 0", len(result))
	}
}

// ---------------------------------------------------------------------------
// monthly.addition / FR-019, FR-020, FR-021 tests
// ---------------------------------------------------------------------------

// TestAggregateBacktestEvents_MonthlyAddition verifies SC-007:
//   - realizedPnl=250 over denominator=1000+3×500=2500 → ROI ≈ 10.00%
//
// Without the fix the denominator would be 1000 → ROI ≈ 25.00%.
func TestAggregateBacktestEvents_MonthlyAddition(t *testing.T) {
	events := []orchestrator.Event{
		makeMonthlyAdditionEvent("500"),
		makeMonthlyAdditionEvent("500"),
		makeMonthlyAdditionEvent("500"),
		makeClosedEvent("t1", "51000", "0.01", "250"),
	}
	balance := decimal.NewFromInt(1000)
	result := aggregateBacktestEvents(events, balance, nil, decimal.Zero)

	// ROI = 250 / (1000 + 1500) × 100 = 10.00
	if !almostEqual(result.PnlSummary.Roi, 10.0, 0.0001) {
		t.Errorf("ROI = %.6f; want 10.0000 (corrected denominator 2500)", result.PnlSummary.Roi)
	}
}

// TestAggregateBacktestEvents_NoAdditionsRoiUnchanged confirms zero-addition
// backtests are mathematically identical to the old formula.
func TestAggregateBacktestEvents_NoAdditionsRoiUnchanged(t *testing.T) {
	events := []orchestrator.Event{
		makeClosedEvent("t1", "51000", "0.01", "100"),
	}
	balance := decimal.NewFromInt(1000)
	result := aggregateBacktestEvents(events, balance, nil, decimal.Zero)

	if !almostEqual(result.PnlSummary.Roi, 10.0, 0.0001) {
		t.Errorf("ROI = %.6f; want 10.0000 (no additions, denominator unchanged)", result.PnlSummary.Roi)
	}
}

// TestAggregateBacktestEvents_ZeroBalancePlusAdditions confirms no panic when
// accountBalance is zero but additions are present.
func TestAggregateBacktestEvents_ZeroBalancePlusAdditions(t *testing.T) {
	events := []orchestrator.Event{
		makeMonthlyAdditionEvent("1000"),
		makeClosedEvent("t1", "51000", "0.01", "100"),
	}
	balance := decimal.Zero
	result := aggregateBacktestEvents(events, balance, nil, decimal.Zero)

	// ROI = 100 / 1000 × 100 = 10.00
	if !almostEqual(result.PnlSummary.Roi, 10.0, 0.0001) {
		t.Errorf("ROI = %.6f; want 10.0000 (denominator covered entirely by addition)", result.PnlSummary.Roi)
	}
}

// TestBuildTradeEvents_MonthlyAdditionEmitsDeposit verifies FR-021:
// monthly.addition events must emit DEPOSIT rows with the injection amount as
// Balance and zero Price, Quantity, Fee.
func TestBuildTradeEvents_MonthlyAdditionEmitsDeposit(t *testing.T) {
	events := []orchestrator.Event{
		makeMonthlyAdditionEvent("500"),
		makeMonthlyAdditionEvent("500"),
		makeMonthlyAdditionEvent("500"),
		makeOpenedEvent("t1", []position.OrderGrid{{Price: "50000", Amount: "100"}}, "0.1"),
		makeClosedEvent("t1", "51000", "0.002", "10"),
		makeSellEvent("t1", "0.05"),
	}
	result := buildTradeEvents(events)

	// 3 DEPOSIT + 1 ENTRY + 1 EXIT = 5
	if len(result) != 5 {
		t.Fatalf("len = %d; want 5 (3 DEPOSIT + ENTRY + EXIT)", len(result))
	}

	// First three events must be DEPOSIT rows.
	for i := 0; i < 3; i++ {
		d := result[i]
		if d.EventType != "DEPOSIT" {
			t.Errorf("result[%d].EventType = %q; want DEPOSIT", i, d.EventType)
		}
		if !almostEqual(d.Balance, 500, 0.001) {
			t.Errorf("result[%d].Balance = %.2f; want 500", i, d.Balance)
		}
		if d.Price != 0 {
			t.Errorf("result[%d].Price = %.2f; want 0", i, d.Price)
		}
		if d.Quantity != 0 {
			t.Errorf("result[%d].Quantity = %.2f; want 0", i, d.Quantity)
		}
		if d.Fee != 0 {
			t.Errorf("result[%d].Fee = %.4f; want 0", i, d.Fee)
		}
		if d.TradeID != "deposit" {
			t.Errorf("result[%d].TradeID = %q; want \"deposit\"", i, d.TradeID)
		}
	}

	// Remaining events: ENTRY then EXIT
	if result[3].EventType != "ENTRY" {
		t.Errorf("result[3].EventType = %q; want ENTRY", result[3].EventType)
	}
	if result[4].EventType != "EXIT" {
		t.Errorf("result[4].EventType = %q; want EXIT", result[4].EventType)
	}
}

// ---------------------------------------------------------------------------
// 019-engine-stop-loss: Win Rate aggregation tests (T023)
// ---------------------------------------------------------------------------

func TestAggregateWinRate_10TPs_3SLs(t *testing.T) {
	events := make([]orchestrator.Event, 0, 13)
	for i := 0; i < 10; i++ {
		events = append(events, makeClosedEventWithReason(
			fmt.Sprintf("tp-%d", i), "51000", "0.01", "50", "take_profit"))
	}
	for i := 0; i < 3; i++ {
		events = append(events, makeClosedEventWithReason(
			fmt.Sprintf("sl-%d", i), "49000", "0.01", "-30", "stop_loss"))
	}
	result := aggregateBacktestEvents(events, decimal.NewFromInt(10000), nil, decimal.Zero)

	// winRate = 10 / (10+3) ≈ 0.76923077
	wantWinRate := 10.0 / 13.0
	if !almostEqual(result.PnlSummary.WinRate, wantWinRate, 0.0001) {
		t.Errorf("WinRate = %.8f; want ≈ %.8f", result.PnlSummary.WinRate, wantWinRate)
	}
	if result.StopLossCount != 3 {
		t.Errorf("StopLossCount = %d; want 3", result.StopLossCount)
	}
	if result.TakeProfitCount != 10 {
		t.Errorf("TakeProfitCount = %d; want 10", result.TakeProfitCount)
	}
}

func TestAggregateWinRate_5TPs_0SLs(t *testing.T) {
	events := make([]orchestrator.Event, 0, 5)
	for i := 0; i < 5; i++ {
		events = append(events, makeClosedEventWithReason(
			fmt.Sprintf("tp-%d", i), "51000", "0.01", "50", "take_profit"))
	}
	result := aggregateBacktestEvents(events, decimal.NewFromInt(10000), nil, decimal.Zero)

	// winRate = 5/5 = 1.0
	if !almostEqual(result.PnlSummary.WinRate, 1.0, 0.0001) {
		t.Errorf("WinRate = %.8f; want 1.0", result.PnlSummary.WinRate)
	}
	if result.StopLossCount != 0 {
		t.Errorf("StopLossCount = %d; want 0", result.StopLossCount)
	}
	if result.TakeProfitCount != 5 {
		t.Errorf("TakeProfitCount = %d; want 5", result.TakeProfitCount)
	}
}

func TestAggregateWinRate_0TPs_0SLs_NoDiv0(t *testing.T) {
	// No closed events at all — should be winRate=0, not panic
	events := []orchestrator.Event{}
	result := aggregateBacktestEvents(events, decimal.NewFromInt(10000), nil, decimal.Zero)

	if result.PnlSummary.WinRate != 0 {
		t.Errorf("WinRate = %.8f; want 0.0 (no division by zero)", result.PnlSummary.WinRate)
	}
	if result.StopLossCount != 0 {
		t.Errorf("StopLossCount = %d; want 0", result.StopLossCount)
	}
	if result.TakeProfitCount != 0 {
		t.Errorf("TakeProfitCount = %d; want 0", result.TakeProfitCount)
	}
}
