package position

import (
	"time"

	"github.com/shopspring/decimal"
)

// OrderFill represents a single executed order (buy or sell)
type OrderFill struct {
	OrderIndex       int             // 0-indexed into Prices/Amounts grid
	OrderNumber      int             // 1-indexed for human readability
	OrderType        OrderType       // MARKET or LIMIT
	ExecutedPrice    decimal.Decimal // Execution price
	ExecutedQuantity decimal.Decimal // Base currency quantity (e.g., BTC)
	QuoteAmount      decimal.Decimal // Quote currency (USDT) before fees
	Timestamp        time.Time       // When order was filled
	Fee              decimal.Decimal // Fee deducted from profit (SDD § 2.6)
}

// Position represents a single active DCA trade
// This is the mutable aggregate root passed to and managed by PSM
type Position struct {
	// Identification
	TradeID        string     // UUID for this position
	OpenTimestamp  time.Time  // When position was first opened
	CloseTimestamp *time.Time // When position was closed (nil if open)

	// State
	State PositionState

	// Configuration (pre-calculated from config.Config and trading pair)
	Prices []decimal.Decimal // P₀, P₁, ..., P_n (SDD § 2.1)
	Amounts []decimal.Decimal // A₀, A₁, ..., A_n (SDD § 2.2)

	// Execution history
	Orders []OrderFill // All filled orders (buy + sell)

	// Current aggregates (recalculated after each fill)
	PositionQuantity  decimal.Decimal // Total base currency held (Σ Q_n)
	AverageEntryPrice decimal.Decimal // Size-weighted avg entry (Pbar, SDD § 2.3)
	TakeProfitTarget  decimal.Decimal // Trigger price (P_tp, SDD § 2.4)
	LiquidationPrice  decimal.Decimal // Trigger price (P_liq, SDD § 2.5); clamped ≥ 0

	// P&L tracking (quote currency)
	Profit            decimal.Decimal // Total profit/loss
	FeesAccumulated   decimal.Decimal // Sum of all fees

	// Account tracking (for re-entry and monthly additions)
	AccountBalance    decimal.Decimal // Current available balance for position sizing
	MonthlyAddition   decimal.Decimal // Capital added monthly (SDD § 3.2 US5)
	CandleCount       int64           // Cumulative candles processed (for day_counter in monthly additions)

	// Exit strategy (US6: Early Exit on Last Order Fill)
	ExitOnLastOrder   bool            // If true, close position immediately when last order fills (SDD § 3.3 US6)

	// Metadata
	OpenPrice      decimal.Decimal // Market buy execution price
	NextOrderIndex int             // Which order (by index) fills next
	HasMoreOrders  bool            // Shorthand: NextOrderIndex < len(Prices)
}

// NewPosition initializes a fresh position with pre-calculated grids
func NewPosition(tradeID string, timestamp time.Time, prices, amounts []decimal.Decimal) *Position {
	return &Position{
		TradeID:       tradeID,
		OpenTimestamp: timestamp,
		State:         StateIdle,
		Prices:        prices,
		Amounts:       amounts,
		Orders:        []OrderFill{},
		CandleCount:   0,
		// All aggregates start at zero (clamped later)
	}
}

// CalculateReentryPrice computes the pessimistic re-entry price after take-profit close
// Re-entry price = close_price × 1.0005 (SDD § 3.1 US4)
func CalculateReentryPrice(closePrice decimal.Decimal) decimal.Decimal {
	if closePrice.IsZero() {
		return decimal.Zero
	}
	buffer, _ := decimal.NewFromString("1.0005")
	return closePrice.Mul(buffer)
}

// Fee rates (SDD § 2.6)
var (
	FeeRateSpot         decimal.Decimal // 0.075% spot (multiplier=1)
	FeeRateMarginMarket decimal.Decimal // 0.06% margin market
	FeeRateMarginLimit  decimal.Decimal // 0.02% margin limit
)

func init() {
	var err error
	FeeRateSpot, err = decimal.NewFromString("0.00075")
	if err != nil {
		panic("invalid FeeRateSpot: " + err.Error())
	}
	FeeRateMarginMarket, err = decimal.NewFromString("0.0006")
	if err != nil {
		panic("invalid FeeRateMarginMarket: " + err.Error())
	}
	FeeRateMarginLimit, err = decimal.NewFromString("0.0002")
	if err != nil {
		panic("invalid FeeRateMarginLimit: " + err.Error())
	}
}

// CalculateFee returns the fee for an order based on type and position multiplier
// fee = price * quantity * rate
func CalculateFee(price, quantity decimal.Decimal, orderType OrderType, multiplier int) decimal.Decimal {
	var rate decimal.Decimal

	if multiplier == 1 {
		// Spot trading
		rate = FeeRateSpot
	} else {
		// Margin trading
		if orderType == OrderTypeMarket {
			rate = FeeRateMarginMarket
		} else {
			rate = FeeRateMarginLimit
		}
	}

	return price.Mul(quantity).Mul(rate)
}
