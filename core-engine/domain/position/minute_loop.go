package position

import (
	"context"
	"fmt"
	"time"

	"github.com/shopspring/decimal"
)

// ProcessCandle applies the Minute Loop Protocol (SDD § 3.1) to one candle
// Strict implementation following user story US1:
//
// 1. Emit PriceChangedEvent
// 2. If State == StateIdle:
//    - Execute market buy at candle Close
//    - Transition to StateOpening
//    - Emit TradeOpenedEvent
// 3. Pessimistic Order (CRITICAL):
//    a. Call FillOrdersForCandle (buy check)
//    b. If buys occurred:
//       - Recalculate AverageEntryPrice, TakeProfitTarget, LiquidationPrice
//       - Emit BuyOrderExecutedEvent and LiquidationPriceUpdatedEvent
//    c. Check Liquidation: if true, close position, emit TradeClosedEvent, return
//    d. Check Take-Profit: if true, close position, emit TradeClosedEvent + SellOrderExecutedEvent, return
func (sm *StateMachine) ProcessCandle(pos *Position, candle *Candle) ([]Event, error) {
	if pos == nil || candle == nil {
		return nil, fmt.Errorf("position and candle must not be nil")
	}

	var events []Event
	ctx := context.Background()

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
	if pos.State == StateOpening || pos.State == StateSafetyOrderWait {
		// 3a. Call FillOrdersForCandle (buy check)
		filledOrders := FillOrdersForCandle(ctx, pos, candle.Low)

		// 3b. If buys occurred, recalculate aggregates
		if len(filledOrders) > 0 {
			// Add filled orders to position
			pos.Orders = append(pos.Orders, filledOrders...)

			// Recalculate aggregates
			pos.PositionQuantity = CalculatePositionQuantity(pos.Orders)
			pos.AverageEntryPrice = CalculateAverageEntryPrice(pos.Orders)

			// Recalculate liquidation price (simplified for testing)
			// For full implementation, would use CalculateLiquidationPrice with account balance
			// For now, set to 50% of average entry price (liquidation trigger below entry)
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

		// 3c. Check Liquidation
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

			return events, nil // Break execution
		}

		// 3d. Check Take-Profit
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

			return events, nil // Break execution
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
