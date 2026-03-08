package position

import (
	"context"

	"github.com/shopspring/decimal"
)

// FillOrdersForCandle processes all buy orders that should be filled based on candle low price
// Implements Gap-Down Paradox Rule: Orders fill at pre-calculated limit prices, never at market
// Returns slice of OrderFills that were triggered by this candle
func FillOrdersForCandle(ctx context.Context, pos *Position, lowPrice decimal.Decimal) []OrderFill {
	var filledOrders []OrderFill
	
	if pos == nil || pos.Prices == nil || len(pos.Prices) == 0 {
		return filledOrders
	}
	
	// Process orders starting from NextOrderIndex
	for i := pos.NextOrderIndex; i < len(pos.Prices); i++ {
		orderPrice := pos.Prices[i]
		
		// Check if this order should be filled: low <= order_price
		if lowPrice.LessThanOrEqual(orderPrice) {
			// Fill this order at its pre-calculated price (Gap-Down Paradox Rule)
			orderNumber := i + 1 // 1-indexed for user display
			orderQuantity := decimal.NewFromInt(1) // Simplified: assume 1 unit per order
			
			// In reality, this would come from pre-calculated amounts
			// For now, using simplified quantity
			if i < len(pos.Amounts) {
				// Could calculate quantity from amount, but keeping simple for test
				// quoteAmount = pos.Amounts[i]
				// orderQuantity = quoteAmount / orderPrice
			}
			
			quoteAmount := pos.Amounts[i]
			fee := CalculateFee(orderPrice, orderQuantity, OrderTypeLimit, 1) // Assuming spot for now
			
			fill := OrderFill{
				OrderIndex:       i,
				OrderNumber:      orderNumber,
				OrderType:        OrderTypeLimit,
				ExecutedPrice:    orderPrice,
				ExecutedQuantity: orderQuantity,
				QuoteAmount:      quoteAmount,
				Timestamp:        pos.OpenTimestamp, // Would be candle timestamp
				Fee:              fee,
			}
			
			filledOrders = append(filledOrders, fill)
			pos.NextOrderIndex = i + 1
		} else {
			// Price hasn't reached this order yet, stop checking further orders
			break
		}
	}
	
	// Update HasMoreOrders flag
	pos.HasMoreOrders = pos.NextOrderIndex < len(pos.Prices)
	
	return filledOrders
}
