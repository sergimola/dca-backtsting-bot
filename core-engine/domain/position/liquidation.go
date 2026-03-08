package position

import (
	"context"

	"github.com/shopspring/decimal"
)

// CalculateLiquidationPrice computes the liquidation trigger price for margin positions
// Formula (SDD § 2.5): P_liq = (M - Q*Pbar) / (Q*(mmr-1))
// Where M = account balance, Q = position quantity, Pbar = average entry, mmr = maintenance margin ratio
// Result is clamped to 0 for spot trading (no liquidation risk)
func CalculateLiquidationPrice(accountBalance, positionQuantity, averagePrice, maintenanceMarginRatio decimal.Decimal, isSpot bool) decimal.Decimal {
	// For spot trading, liquidation price is 0 (no liquidation risk)
	if isSpot || positionQuantity.IsZero() {
		return decimal.NewFromInt(0)
	}
	
	// Cross-margin liquidation formula
	// P_liq = (M - Q*Pbar) / (Q*(mmr-1))
	
	numerator := accountBalance.Sub(positionQuantity.Mul(averagePrice))
	denominator := positionQuantity.Mul(maintenanceMarginRatio.Sub(decimal.NewFromInt(1)))
	
	if denominator.IsZero() {
		return decimal.NewFromInt(0)
	}
	
	liquidationPrice := numerator.Div(denominator)
	
	// Clamp to 0 if negative (market can't go below 0)
	if liquidationPrice.IsNegative() {
		return decimal.NewFromInt(0)
	}
	
	return liquidationPrice
}

// CheckLiquidation verifies if position should be liquidated based on current low price
func CheckLiquidation(ctx context.Context, lowPrice, liquidationPrice decimal.Decimal) bool {
	if liquidationPrice.IsZero() {
		return false // No liquidation for spot trading or zero liquidation price
	}
	
	// Liquidation triggered if low <= liquidation_price
	return lowPrice.LessThanOrEqual(liquidationPrice)
}

// CloseLiquidation closes a position due to liquidation
// Returns the loss (negative profit = -account_balance)
func CloseLiquidation(accountBalance decimal.Decimal) decimal.Decimal {
	return accountBalance.Mul(decimal.NewFromInt(-1))
}
