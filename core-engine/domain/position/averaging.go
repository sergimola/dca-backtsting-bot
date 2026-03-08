package position

import "github.com/shopspring/decimal"

// CalculateAverageEntryPrice computes the size-weighted average entry price
// Formula (SDD § 2.3): Pbar = Σ(P_j * Q_j) / Σ(Q_j)
func CalculateAverageEntryPrice(orders []OrderFill) decimal.Decimal {
	if len(orders) == 0 {
		return decimal.NewFromInt(0)
	}
	
	totalQuantity := decimal.NewFromInt(0)
	totalCost := decimal.NewFromInt(0)
	
	for _, order := range orders {
		// Only count buy orders (OrderType == MARKET or LIMIT for buys)
		// Sell orders have OrderType classification, but for now assume all are buys
		totalCost = totalCost.Add(order.ExecutedPrice.Mul(order.ExecutedQuantity))
		totalQuantity = totalQuantity.Add(order.ExecutedQuantity)
	}
	
	if totalQuantity.IsZero() {
		return decimal.NewFromInt(0)
	}
	
	return totalCost.Div(totalQuantity)
}

// CalculatePositionQuantity sums all buy order quantities
func CalculatePositionQuantity(orders []OrderFill) decimal.Decimal {
	totalQuantity := decimal.NewFromInt(0)
	
	for _, order := range orders {
		// Only count buy orders
		// For now, assume all orders in the Position.Orders slice are buys
		totalQuantity = totalQuantity.Add(order.ExecutedQuantity)
	}
	
	return totalQuantity
}
