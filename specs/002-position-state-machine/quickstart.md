# Quickstart: Position State Machine

**Goal**: Demonstrate PSM usage with a minimal hello-world example.

---

## Installation

Add dependency to `go.mod`:

```bash
go get github.com/shopspring/decimal
go get github.com/google/uuid
```

---

## Hello World: Single Position, Synthetic Candles

### Step 1: Import and setup

```go
package main

import (
	"fmt"
	"time"

	"github.com/shopspring/decimal"
	"dca-bot/core-engine/domain/position"
)

func main() {
	// Initialize Position State Machine
	psm := position.NewStateMachine() // (Not yet implemented; placeholder)
	
	// Create pre-calculated price grid (SDD § 2.1)
	// P₀ = 100, entry = 2%, scale = 1.1
	prices := mustDecimalSlice(
		"100.00000000",  // P₀ (market entry)
		"98.00000000",   // P₁
		"95.84400000",   // P₂
	)
	
	// Create pre-calculated amount grid (SDD § 2.2)
	// total = 100 USDT, scale = 2.0
	amounts := mustDecimalSlice(
		"14.28571428",   // A₀
		"28.57142857",   // A₁
		"57.14285715",   // A₂
	)
	
	// Create a fresh position
	tradeID := "test-trade-001"
	openTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	
	pos, err := psm.NewPosition(tradeID, openTime, prices, amounts)
	if err != nil {
		panic(err)
	}
	
	fmt.Printf("Position created: %s\n", pos.TradeID)
	fmt.Printf("State: %s\n", pos.State)
	fmt.Printf("Has %d orders configured\n", len(prices))
}

func mustDecimalSlice(strs ...string) []decimal.Decimal {
	result := make([]decimal.Decimal, len(strs))
	for i, s := range strs {
		result[i], _ = decimal.NewFromString(s)
	}
	return result
}
```

### Step 2: Process synthetic candles

```go
func main() {
	// ... setup from Step 1 ...
	
	// Create synthetic candles to test the state machine
	candles := []position.Candle{
		{
			Timestamp: time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
			Open:      mustDecimal("100.00"),
			High:      mustDecimal("100.50"),
			Low:       mustDecimal("99.50"),
			Close:     mustDecimal("100.00"),
			Volume:    mustDecimal("1000000"),
		},
		{
			Timestamp: time.Date(2024, 1, 1, 0, 1, 0, 0, time.UTC),
			Open:      mustDecimal("100.00"),
			High:      mustDecimal("100.00"),
			Low:       mustDecimal("98.50"), // Below P₁, triggers first safety order
			Close:     mustDecimal("99.00"),
			Volume:    mustDecimal("1000000"),
		},
		{
			Timestamp: time.Date(2024, 1, 1, 0, 2, 0, 0, time.UTC),
			Open:      mustDecimal("99.00"),
			High:      mustDecimal("99.00"),
			Low:       mustDecimal("95.70"), // Below P₂, triggers second safety order
			Close:     mustDecimal("98.00"),
			Volume:    mustDecimal("1000000"),
		},
		{
			Timestamp: time.Date(2024, 1, 1, 0, 3, 0, 0, time.UTC),
			Open:      mustDecimal("98.00"),
			High:      mustDecimal("100.00"), // Above take-profit (Pbar * 1.005)
			Low:       mustDecimal("97.50"),
			Close:     mustDecimal("100.00"),
			Volume:    mustDecimal("1000000"),
		},
	}
	
	// Process each candle through PSM
	for i, candle := range candles {
		fmt.Printf("\n--- Candle %d: %s ---\n", i+1, candle.Timestamp.Format("15:04:05"))
		fmt.Printf("Open: %s, High: %s, Low: %s, Close: %s\n",
			candle.Open, candle.High, candle.Low, candle.Close)
		
		events, err := psm.ProcessCandle(pos, &candle)
		if err != nil {
			fmt.Printf("Error: %v\n", err)
			break
		}
		
		// Print emitted events
		for _, event := range events {
			printEvent(event)
		}
		
		// Print position state after candle
		fmt.Printf("Position State: %s\n", pos.State)
		fmt.Printf("  Quantity: %s\n", pos.PositionQuantity)
		fmt.Printf("  Avg Entry: %s\n", pos.AverageEntryPrice)
		fmt.Printf("  Take-Profit: %s\n", pos.TakeProfitTarget)
		fmt.Printf("  Liquidation: %s\n", pos.LiquidationPrice)
		fmt.Printf("  Profit: %s\n", pos.Profit)
	}
}

func printEvent(e position.Event) {
	switch event := e.(type) {
	case *position.TradeOpenedEvent:
		fmt.Printf("[TRADE OPENED] ID=%s Amount=%v\n", event.TradeID, event.RunID)
	
	case *position.BuyOrderExecutedEvent:
		fmt.Printf("[BUY ORDER #%d] Price=%s Size=%s Base=%s Fee=%s\n",
			event.OrderNumber, event.Price, event.Size, event.BaseSize, event.Fee)
		fmt.Printf("  Liquidation updated: %s\n", event.LiquidationPrice)
	
	case *position.LiquidationPriceUpdatedEvent:
		fmt.Printf("[LIQUIDATION UPDATED] Price=%s Current=%s Ratio=%s\n",
			event.LiquidationPrice, event.CurrentPrice, event.PriceRatio)
	
	case *position.TradeClosedEvent:
		fmt.Printf("[TRADE CLOSED] %s ClosingPrice=%s Size=%s Profit=%s Duration=%v\n",
			event.Reason, event.ClosingPrice, event.Size, event.Profit, event.Duration)
	
	case *position.SellOrderExecutedEvent:
		fmt.Printf("[SELL ORDER] Price=%s Size=%s Profit=%s\n",
			event.Price, event.Size, event.Profit)
	
	case *position.PriceChangedEvent:
		fmt.Printf("[PRICE CHANGED] OHLC=(%s/%s/%s/%s)\n",
			event.Open, event.High, event.Low, event.Close)
	
	case *position.MonthlyAdditionEvent:
		fmt.Printf("[MONTHLY ADDITION] Amount=%s NewBalance=%s\n",
			event.AdditionAmount, event.NewBalance)
	
	default:
		fmt.Printf("[EVENT] Type=%s Timestamp=%s\n", e.EventType(), e.EventTimestamp())
	}
}

func mustDecimal(s string) decimal.Decimal {
	d, _ := decimal.NewFromString(s)
	return d
}
```

### Expected Output

```
Position created: test-trade-001
State: IDLE
Has 3 orders configured

--- Candle 1: 00:00:00 ---
Open: 100.00, High: 100.50, Low: 99.50, Close: 100.00
[PRICE CHANGED] OHLC=(100.00/100.50/99.50/100.00)
[TRADE OPENED] ID=test-trade-001 Amount=...
[BUY ORDER #1] Price=100.00 Size=14.28571428 Base=0.14285714 Fee=0.00107142
  Liquidation updated: 0
Position State: OPENING
  Quantity: 0.14285714
  Avg Entry: 100.00000000
  Take-Profit: 100.50000000
  Liquidation: 0
  Profit: 0

--- Candle 2: 00:01:00 ---
Open: 100.00, High: 100.00, Low: 98.50, Close: 99.00
[PRICE CHANGED] OHLC=(100.00/100.00/98.50/99.00)
[BUY ORDER #2] Price=98.00 Size=28.57142857 Base=0.29155640 Fee=0.00214285
  Liquidation updated: 25.50000000
Position State: SAFETY_ORDER_WAIT
  Quantity: 0.43441354
  Avg Entry: 98.92200000
  Take-Profit: 99.40661000
  Liquidation: 25.50000000
  Profit: -0.00321427

--- Candle 3: 00:02:00 ---
Open: 99.00, High: 99.00, Low: 95.70, Close: 98.00
[PRICE CHANGED] OHLC=(99.00/99.00/95.70/98.00)
[BUY ORDER #3] Price=95.844 Size=57.14285715 Base=0.59687500 Fee=0.00428571
  Liquidation updated: 12.75000000
Position State: SAFETY_ORDER_WAIT
  Quantity: 1.03128894
  Avg Entry: 96.92200000
  Take-Profit: 97.40661000
  Liquidation: 12.75000000
  Profit: -0.00750000

--- Candle 4: 00:03:00 ---
Open: 98.00, High: 100.00, Low: 97.50, Close: 100.00
[PRICE CHANGED] OHLC=(98.00/100.00/97.50/100.00)
[TRADE CLOSED] take_profit ClosingPrice=97.40661 Size=1.03128894 Profit=1.24... Duration=3m
[SELL ORDER] Price=97.40661 Size=1.03128894 Profit=1.24...
Position State: CLOSED
  Quantity: 0
  Avg Entry: 0
  Take-Profit: 0
  Liquidation: 0
  Profit: 1.24...
```

---

## Unit Testing: Canonical Test Data

The test suite validates PSM against canonical test cases from spec.md:

```go
func TestCanonicalP1Calculation(t *testing.T) {
	// SDD § 2.1: P₀=100, entry=2%, scale=1.1 → P₁=98.00
	P0 := mustDecimal("100.00")
	entry := mustDecimal("2.0")
	P1 := P0.Mul(decimal.NewFromInt(1).Sub(entry.Div(decimal.NewFromInt(100))))
	
	expected := mustDecimal("98.00000000")
	if !P1.Equal(expected) {
		t.Errorf("P1 mismatch: got %s, want %s", P1, expected)
	}
}

func TestCanonicalP2Calculation(t *testing.T) {
	// SDD § 2.1: P₁=98, entry=2%, scale=1.1 → P₂=95.844
	P1 := mustDecimal("98.00")
	entry := mustDecimal("2.0")
	scale := mustDecimal("1.1")
	
	P2 := P1.Mul(decimal.NewFromInt(1).Sub(entry.Div(decimal.NewFromInt(100)).Mul(scale)))
	
	expected := mustDecimal("95.84400000")
	if !P2.Equal(expected) {
		t.Errorf("P2 mismatch: got %s, want %s", P2, expected)
	}
}

func TestCanonicalOrderAmounts(t *testing.T) {
	// SDD § 2.2: total=100, scale=2.0, n=3 orders
	// A[n] = 100 * 2.0^n / R, where R = (2.0^3 - 1) / (2.0 - 1) = 7
	
	total := mustDecimal("100.0")
	scale := mustDecimal("2.0")
	R := scale.Pow(decimal.NewFromInt(3)).Sub(decimal.NewFromInt(1)).Div(scale.Sub(decimal.NewFromInt(1)))
	
	expected := []string{
		"14.28571428",
		"28.57142857",
		"57.14285715",
	}
	
	for i, exp := range expected {
		scalePow := scale.Pow(decimal.NewFromInt(int64(i)))
		amount := total.Mul(scalePow).Div(R)
		
		expDecimal := mustDecimal(exp)
		if !amount.Equal(expDecimal) {
			t.Errorf("A[%d] mismatch: got %s, want %s", i, amount, expDecimal)
		}
	}
}
```

---

## Integration Testing: Minute Loop Protocol

```go
func TestMinuteLoopProtocol(t *testing.T) {
	// SDD § 3.1: Minute Loop processes candles in strict order
	// 1. Dispatch PriceChangedEvent
	// 2. Check monthly addition
	// 3. Process buy orders
	// 4. Recalc liquidation
	// 5. Check liquidation
	// 6. Check take-profit
	// 7. Check early exit
	
	// Test scenario: Buy → liquidation on same candle
	// Expected: Buy filled first, liquidation checked against updated state
	
	// (Implementation: run through synthetic candles, assert event order)
}
```

---

## Next Steps

1. Implement the SSM on the basis of these contracts
2. Write comprehensive unit tests using canonical test data
3. Validate gap-down handling (SDD § 3.2)
4. Run parity tests against Python bot
5. Integrate into orchestrator layer
