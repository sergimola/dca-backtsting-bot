package fixtures

import "github.com/shopspring/decimal"

// CanonicalTestData provides exact Decimal values from spec.md canonical test data table
// These values must match the legacy Python bot exactly to 8 decimal places

var (
	// Price grid test baseline
	P0BasePrice              = mustDecimal("100.00")
	EntryDropPercent         = mustDecimal("2.0")
	PriceScaleEpsilon        = mustDecimal("1.1")
	
	// Expected canonical prices
	PriceP1Expected          = mustDecimal("98.00000000")
	PriceP2Expected          = mustDecimal("95.84400000")
	
	// Order amount scaling
	TotalAmountPerTrade      = mustDecimal("100.0")
	AmountScaleEpsilon       = mustDecimal("2.0")
	NumberOfOrders           = 3
	
	// Expected canonical amounts
	AmountA0Expected         = mustDecimal("14.28571428")
	AmountA1Expected         = mustDecimal("28.57142857")
	AmountA2Expected         = mustDecimal("57.14285715")
	
	// Average entry price baseline
	FillQuantity1            = mustDecimal("1.0")
	FillPrice1               = mustDecimal("98.00")
	FillQuantity2            = mustDecimal("1.0")
	FillPrice2               = mustDecimal("95.844")
	
	// Expected canonical average
	AverageEntryPriceExpected = mustDecimal("96.92200000")
	
	// Take-profit baseline
	TakeProfitDistancePercent = mustDecimal("0.5")
	
	// Expected canonical take-profit
	TakeProfitTargetExpected  = mustDecimal("97.40661000")
	
	// Liquidation price baseline
	AccountBalanceForLiq      = mustDecimal("1000.0")
	PositionSizeForLiq        = mustDecimal("20.0")
	AverageEntryForLiq        = mustDecimal("100.00")
	MaintenanceMarginRatio    = mustDecimal("0.0067")
	
	// Expected canonical liquidation price
	LiquidationPriceExpected  = mustDecimal("50.33725964")
	
	// Fee calculation baseline
	FeeCalculationPrice       = mustDecimal("95.844")
	FeeCalculationQuantity    = mustDecimal("1.0")
	FeeRateSpot               = mustDecimal("0.00075")
	
	// Expected canonical fee
	FeeExpected               = mustDecimal("0.071883")
)

// mustDecimal parses a string to decimal, panics on error
// Used only in fixtures initialization
func mustDecimal(s string) decimal.Decimal {
	d, err := decimal.NewFromString(s)
	if err != nil {
		panic("mustDecimal in fixtures: " + s + ": " + err.Error())
	}
	return d
}
