package position

import (
	"context"

	"github.com/shopspring/decimal"
)

// CalculateTakeProfitTarget computes the take-profit trigger price
// Formula (SDD § 2.4): P_tp = Pbar * (1 + distance/100)
func CalculateTakeProfitTarget(averagePrice, distancePercent decimal.Decimal) decimal.Decimal {
	if averagePrice.IsZero() {
		return decimal.NewFromInt(0)
	}
	
	one := decimal.NewFromInt(1)
	oneHundred := decimal.NewFromInt(100)
	
	return averagePrice.Mul(one.Add(distancePercent.Div(oneHundred)))
}

// CheckTakeProfit verifies if position should be closed at take-profit based on current high price
func CheckTakeProfit(ctx context.Context, highPrice, takeProfitPrice decimal.Decimal) bool {
	if takeProfitPrice.IsZero() {
		return false
	}
	
	// Take-profit triggered if high >= take_profit_price
	return highPrice.GreaterThanOrEqual(takeProfitPrice)
}

// CalculateProfit computes the total profit/loss from position close
// Profit = (closePrice * quantity) - (sum of quote amounts) - (sum of fees)
func CalculateProfit(closePrice, positionQuantity decimal.Decimal, orders []OrderFill, feesAccumulated decimal.Decimal) decimal.Decimal {
	if positionQuantity.IsZero() {
		return decimal.NewFromInt(0)
	}
	
	// Proceeds from selling entire position at close price
	proceeds := closePrice.Mul(positionQuantity)
	
	// Sum of all buy costs (quote amounts)
	totalCost := decimal.NewFromInt(0)
	for _, order := range orders {
		totalCost = totalCost.Add(order.QuoteAmount)
	}
	
	// Profit before fees
	profit := proceeds.Sub(totalCost)
	
	// Deduct all fees
	profit = profit.Sub(feesAccumulated)
	
	return profit
}
