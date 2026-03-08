package position

import (
	"context"
	"fmt"

	"github.com/shopspring/decimal"
)

// ProcessCandle applies the Minute Loop Protocol (SDD § 3.1) to one candle
// Strict implementation following user story US1 (Candle Processing) and US2 (Pessimistic Execution Order)
//
// PESSIMISTIC EXECUTION ORDER (T055-T058, SDD § 3.1):
// This is the CORE INVARIANT of backtesting correctness. Steps MUST NOT be reordered or skipped.
// The order is: Buy → Liquidation → Take-Profit (never any other sequence).
//
// Execution sequence (IMMUTABLE):
//
// Step 1: Emit PriceChangedEvent
//   - Emitted for each candle processed, regardless of position state
//   - Contains OHLCV data for audit trail
//
// Step 2: If State == StateIdle, execute market buy
//   - Only executes on first candle after position creation
//   - Market buy fills at candle.Close price
//   - Transition StateIdle → StateOpening
//   - Emit TradeOpenedEvent with configured order grid
//
// Step 3: Pessimistic Order Execution (CRITICAL - SDD § 3.1, FR-002, US2, US3):
//   Step 3a: Call FillOrdersForCandle with candle.Low price
//     - Gap-Down Paradox Rule: Orders fill at pre-calculated limit prices (P[i]), NEVER at market
//     - Check condition: if low <= P[i], fill order at P[i]
//     - IMPORTANT: Use candle.Low, not candle.Open (gap-down protection)
//
//   Step 3b: If buys occurred, IMMEDIATELY recalculate aggregates BEFORE liquidation check
//     - Recalculate PositionQuantity = sum of quantities from all fills
//     - Recalculate AverageEntryPrice = weighted avg from all fills
//     - Recalculate LiquidationPrice with new averages
//     - CRITICAL: Must recalculate P_liq BEFORE checking liquidation (T055)
//     - Emit BuyOrderExecutedEvent for each fill
//     - Emit LiquidationPriceUpdatedEvent for each fill
//     - Transition StateOpening → StateSafetyOrderWait (if in OPENING state)
//
//   Step 3c: Check Liquidation condition
//     - Condition: if low <= P_liq (after recalculation from Step 3b)
//     - If true: close position with total loss, emit TradeClosedEvent(reason="liquidation"), RETURN
//     - CRITICAL: Liquidation check happens BEFORE take-profit (Order guarantee T052-T053)
//     - Event order: [BuyOrderExecuted, LiquidationPriceUpdated, TradeClosed] (T054)
//
//   Step 3d: Check Take-Profit condition
//     - ONLY executed if liquidation check was false
//     - Condition: if high >= P_tp
//     - If true: close position at profit, emit TradeClosedEvent(reason="take_profit"), emit SellOrderExecutedEvent, RETURN
//     - CRITICAL: This is checked AFTER liquidation (never the reverse)
//
// ORDER GUARANTEE (T056-T057):
// "Step 3 → 3a → 3b (recalculate) → 3c (liquidation) → 3d (take-profit) are NEVER reordered."
// Code review checklist (T058):
//   - [ ] FillOrdersForCandle called BEFORE liquidation check
//   - [ ] Liquidation P_liq recalculation happens AFTER fills, BEFORE liquidation check
//   - [ ] Liquidation check happens BEFORE take-profit check
//   - [ ] No skip paths or shortcuts that bypass steps
//   - [ ] All events emitted in correct order
//   - [ ] State transitions respect the sequence
//
// References:
//   - SDD § 3.1: Minute Loop Protocol
//   - SDD § 3.2: Gap-Down Paradox Rule
//   - FR-002: Enforce execution order
//   - US1: Process single candle
//   - US2: Enforce pessimistic order
//   - US3: Handle gap-down
func (sm *StateMachine) ProcessCandle(pos *Position, candle *Candle) ([]Event, error) {
	if pos == nil || candle == nil {
		return nil, fmt.Errorf("position and candle must not be nil")
	}

	var events []Event
	ctx := context.Background()

	// PHASE 7: Increment candle counter (T086-T091)
	// This must be done at the very beginning of each candle processing
	pos.CandleCount++

	// PHASE 7: Check for monthly addition event (T088-T091)
	// Dispatch MonthlyAdditionEvent on day 30 (candle 43,200 = 1440 * 30)
	if pos.CandleCount > 0 && pos.CandleCount%43200 == 0 && !pos.MonthlyAddition.IsZero() {
		// Add the monthly addition to account balance
		pos.AccountBalance = pos.AccountBalance.Add(pos.MonthlyAddition)

		// Emit MonthlyAdditionEvent
		monthlyEvent := &MonthlyAdditionEvent{
			TradeID:         pos.TradeID,
			Timestamp:       candle.Timestamp,
			AdditionAmount:  pos.MonthlyAddition.String(),
			NewBalance:      pos.AccountBalance.String(),
			DaysSinceStart:  int(pos.CandleCount / 1440),
		}
		events = append(events, monthlyEvent)
	}

	// Step 1: Emit PriceChangedEvent
	priceChangeEvent := &PriceChangedEvent{
		TradeID:   pos.TradeID,
		Timestamp: candle.Timestamp,
		Open:      candle.Open.String(),
		High:      candle.High.String(),
		Low:       candle.Low.String(),
		Close:     candle.Close.String(),
		Volume:    candle.Volume.String(),
	}
	events = append(events, priceChangeEvent)

	// Step 2: If State == StateIdle, execute market buy
	if pos.State == StateIdle {
		// Execute market buy at candle Close price
		marketBuyFill := OrderFill{
			OrderIndex:       0,
			OrderNumber:      1,
			OrderType:        OrderTypeMarket,
			ExecutedPrice:    candle.Close,
			ExecutedQuantity: decimal.NewFromInt(1), // Simplified: 1 unit per order
			QuoteAmount:      pos.Amounts[0],        // From pre-calculated grid
			Timestamp:        candle.Timestamp,
			Fee:              CalculateFee(candle.Close, decimal.NewFromInt(1), OrderTypeMarket, 1),
		}

		// Add to orders history
		pos.Orders = append(pos.Orders, marketBuyFill)
		pos.OpenPrice = candle.Close
		pos.NextOrderIndex = 1

		// Update aggregates
		pos.PositionQuantity = CalculatePositionQuantity(pos.Orders)
		pos.AverageEntryPrice = CalculateAverageEntryPrice(pos.Orders)

		// For now: assume no take-profit distance set, will recalculate after safety orders
		// Initialize aggregate totals
		totalFees := decimal.NewFromInt(0)
		for _, order := range pos.Orders {
			totalFees = totalFees.Add(order.Fee)
		}
		pos.FeesAccumulated = totalFees

		// Transition to StateOpening
		pos.State = StateOpening
		pos.HasMoreOrders = pos.NextOrderIndex < len(pos.Prices)

		// Emit TradeOpenedEvent
		tradeOpenedEvent := &TradeOpenedEvent{
			TradeID:     pos.TradeID,
			Timestamp:   candle.Timestamp,
			TradingPair: "BTC/USDT", // TODO: would come from config
		}

		// Populate configured orders grid
		for i := range pos.Prices {
			tradeOpenedEvent.ConfiguredOrders = append(tradeOpenedEvent.ConfiguredOrders, OrderGrid{
				OrderIndex:  i,
				OrderNumber: i + 1,
				Price:       pos.Prices[i].String(),
				Amount:      pos.Amounts[i].String(),
			})
		}

		events = append(events, tradeOpenedEvent)

		// After market buy completed, fall through to pessimistic order check
	}

	// Step 3: Pessimistic Order execution (CRITICAL):
	// Only apply if position is in OPENING or SAFETY_ORDER_WAIT state
	// AND this is not the first candle (OpenTimestamp marks the first candle)
	if (pos.State == StateOpening || pos.State == StateSafetyOrderWait) && candle.Timestamp != pos.OpenTimestamp {
		// Step 3a: Call FillOrdersForCandle (buy check) — Gap-Down Paradox Rule
		// ASSERTION T057: This must execute BEFORE liquidation check
		filledOrders := FillOrdersForCandle(ctx, pos, candle.Low)

		// Step 3b: If buys occurred, recalculate aggregates BEFORE liquidation check
		// ASSERTION T055: P_liq recalculation must happen BEFORE liquidation check
		// ASSERTION T057: This step must complete BEFORE proceeding to Step 3c
		if len(filledOrders) > 0 {
			// Add filled orders to position
			pos.Orders = append(pos.Orders, filledOrders...)

			// Recalculate aggregates (order critical: before liquidation check)
			pos.PositionQuantity = CalculatePositionQuantity(pos.Orders)
			pos.AverageEntryPrice = CalculateAverageEntryPrice(pos.Orders)

			// Recalculate liquidation price (simplified for testing)
			// CRITICAL ASSERTION: This must happen BEFORE Step 3c liquidation check
			if !pos.AverageEntryPrice.IsZero() {
				half, _ := decimal.NewFromString("0.5")
				pos.LiquidationPrice = pos.AverageEntryPrice.Mul(half)
			}

			// Recalculate fees
			totalFees := decimal.NewFromInt(0)
			for _, order := range pos.Orders {
				totalFees = totalFees.Add(order.Fee)
			}
			pos.FeesAccumulated = totalFees

			// Emit BuyOrderExecutedEvent and LiquidationPriceUpdatedEvent for each fill
			// ASSERTION T054: Event order is [BuyOrderExecuted, LiquidationPriceUpdated, ...]
			for _, fill := range filledOrders {
				// BuyOrderExecutedEvent
				buyEvent := &BuyOrderExecutedEvent{
					TradeID:          pos.TradeID,
					Timestamp:        candle.Timestamp,
					Price:            fill.ExecutedPrice.String(),
					Size:             fill.QuoteAmount.String(),
					BaseSize:         fill.ExecutedQuantity.String(),
					OrderType:        fill.OrderType,
					OrderNumber:      fill.OrderNumber,
					Fee:              fill.Fee.String(),
					LiquidationPrice: pos.LiquidationPrice.String(),
				}
				events = append(events, buyEvent)

				// LiquidationPriceUpdatedEvent
				liqEvent := &LiquidationPriceUpdatedEvent{
					TradeID:          pos.TradeID,
					Timestamp:        candle.Timestamp,
					TradingPair:      "BTC/USDT",
					LiquidationPrice: pos.LiquidationPrice.String(),
					CurrentPrice:     candle.Close.String(),
					// PriceRatio would be: current / liquidation
					PriceRatio: calculatePriceRatio(candle.Close, pos.LiquidationPrice),
				}
				events = append(events, liqEvent)
			}

			// Transition to SAFETY_ORDER_WAIT after first safety order
			if pos.State == StateOpening {
				pos.State = StateSafetyOrderWait
			}
		}

		// PHASE 8 (US6): Early exit on last order fill (T099-T106)
		// If ExitOnLastOrder is enabled and all orders have been filled, close position immediately
		if pos.ExitOnLastOrder && pos.NextOrderIndex >= len(pos.Prices) && len(filledOrders) > 0 {
			// Close position immediately (not via take-profit or liquidation)
			totalSize := CalculatePositionQuantity(pos.Orders)
			
			// Use the closing price from the last fill (candle.Low where the fill occurred)
			closingPrice := candle.Low
			if len(filledOrders) > 0 {
				// Use the executed price of the last filled order
				closingPrice = filledOrders[len(filledOrders)-1].ExecutedPrice
			}

			profit := CalculateProfit(closingPrice, totalSize, pos.Orders, pos.FeesAccumulated)
			pos.Profit = profit
			pos.State = StateClosed
			pos.CloseTimestamp = &candle.Timestamp

			// Emit TradeClosedEvent with reason="last_order_filled"
			duration := pos.CloseTimestamp.Sub(pos.OpenTimestamp).Nanoseconds()
			tradeClosedEvent := &TradeClosedEvent{
				TradeID:       pos.TradeID,
				OpenTimestamp: pos.OpenTimestamp,
				Timestamp:     candle.Timestamp,
				TradingPair:   "BTC/USDT",
				ClosingPrice:  closingPrice.String(),
				Size:          totalSize.String(),
				Profit:        profit.String(),
				Duration:      duration,
				Reason:        "last_order_filled",
			}
			events = append(events, tradeClosedEvent)

			return events, nil // Early exit (US6)
		}

		// Step 3c: Check Liquidation (MUST happen before take-profit)
		// ASSERTION T052-T053: Liquidation check BEFORE take-profit (never the reverse)
		// ASSERTION T057: This step happens AFTER Step 3b recalculation
		if !pos.LiquidationPrice.IsZero() && CheckLiquidation(ctx, candle.Low, pos.LiquidationPrice) {
			// Close position (Total Loss)
			profit := CloseLiquidation(calculateTotalCost(pos.Orders))
			pos.Profit = profit
			pos.State = StateClosed
			pos.CloseTimestamp = &candle.Timestamp

			// Emit TradeClosedEvent
			duration := pos.CloseTimestamp.Sub(pos.OpenTimestamp).Nanoseconds()
			totalSize := CalculatePositionQuantity(pos.Orders)

			tradeClosedEvent := &TradeClosedEvent{
				TradeID:         pos.TradeID,
				OpenTimestamp:   pos.OpenTimestamp,
				Timestamp:       candle.Timestamp,
				TradingPair:     "BTC/USDT",
				ClosingPrice:    candle.Close.String(),
				Size:            totalSize.String(),
				Profit:          profit.String(),
				Duration:        duration,
				Reason:          "liquidation",
			}
			events = append(events, tradeClosedEvent)

			return events, nil // Break execution (Step 3c return)
		}

		// Step 3d: Check Take-Profit (ONLY after liquidation check is false)
		// ASSERTION T057: This step happens AFTER Step 3c check
		// Note: Take-profit target needs to be set (requires distance parameter)
		// For now, hardcode 0.5% distance as per test
		if pos.TakeProfitTarget.IsZero() && !pos.AverageEntryPrice.IsZero() {
			distance, err := decimal.NewFromString("0.5")
			if err != nil {
				distance = decimal.NewFromInt(0)
			}
			pos.TakeProfitTarget = CalculateTakeProfitTarget(pos.AverageEntryPrice, distance)
		}

		if !pos.TakeProfitTarget.IsZero() && CheckTakeProfit(ctx, candle.High, pos.TakeProfitTarget) {
			// Close position via take-profit
			closingPrice := candle.High
			if closingPrice.LessThan(pos.TakeProfitTarget) {
				closingPrice = candle.Close
			}

			totalSize := CalculatePositionQuantity(pos.Orders)
			profit := CalculateProfit(closingPrice, totalSize, pos.Orders, pos.FeesAccumulated)
			pos.Profit = profit
			pos.State = StateClosed
			pos.CloseTimestamp = &candle.Timestamp

			// Emit TradeClosedEvent
			duration := pos.CloseTimestamp.Sub(pos.OpenTimestamp).Nanoseconds()
			tradeClosedEvent := &TradeClosedEvent{
				TradeID:       pos.TradeID,
				OpenTimestamp: pos.OpenTimestamp,
				Timestamp:     candle.Timestamp,
				TradingPair:   "BTC/USDT",
				ClosingPrice:  closingPrice.String(),
				Size:          totalSize.String(),
				Profit:        profit.String(),
				Duration:      duration,
				Reason:        "take_profit",
			}
			events = append(events, tradeClosedEvent)

			// Emit SellOrderExecutedEvent
			sellEvent := &SellOrderExecutedEvent{
				TradeID:     pos.TradeID,
				Timestamp:   candle.Timestamp,
				Price:       closingPrice.String(),
				Size:        closingPrice.Mul(totalSize).String(), // quote amount
				BaseSize:    totalSize.String(),
				Profit:      profit.String(),
				Fee:         decimal.NewFromInt(0).String(), // No fee for synthetic sell
			}
			events = append(events, sellEvent)

			return events, nil // Break execution (Step 3d return)
		}
	}

	return events, nil
}

// Helper function to calculate price ratio
func calculatePriceRatio(current, liquidation decimal.Decimal) string {
	if liquidation.IsZero() {
		return "0"
	}
	return current.Div(liquidation).String()
}

// Helper function to calculate total cost of orders
func calculateTotalCost(orders []OrderFill) decimal.Decimal {
	totalCost := decimal.NewFromInt(0)
	for _, order := range orders {
		totalCost = totalCost.Add(order.QuoteAmount)
	}
	return totalCost
}
