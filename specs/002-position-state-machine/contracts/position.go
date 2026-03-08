// Package position defines the core Position State Machine contracts
package position

import (
	"time"

	"github.com/shopspring/decimal"
)

// PositionState represents the current phase of a position lifecycle
type PositionState int

const (
	StateIdle PositionState = iota
	StateOpening
	StateSafetyOrderWait
	StateClosed
)

func (s PositionState) String() string {
	switch s {
	case StateIdle:
		return "IDLE"
	case StateOpening:
		return "OPENING"
	case StateSafetyOrderWait:
		return "SAFETY_ORDER_WAIT"
	case StateClosed:
		return "CLOSED"
	default:
		return "UNKNOWN"
	}
}

// OrderType distinguishes market vs. limit orders
type OrderType int

const (
	OrderTypeMarket OrderType = iota
	OrderTypeLimit
)

func (t OrderType) String() string {
	switch t {
	case OrderTypeMarket:
		return "MARKET"
	case OrderTypeLimit:
		return "LIMIT"
	default:
		return "UNKNOWN"
	}
}

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
// This is the mutable aggregate root passed to und managed by PSM
type Position struct {
	// Identification
	TradeID        string    // UUID for this position
	OpenTimestamp  time.Time // When position was first opened
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
		// All aggregates start at zero
	}
}

// Fee rates (SDD § 2.6)
var (
	FeeRateSpot         = decimal.NewFromString("0.00075")  // 0.075% spot (multiplier=1)
	FeeRateMarginMarket = decimal.NewFromString("0.0006")   // 0.06% margin market
	FeeRateMarginLimit  = decimal.NewFromString("0.0002")   // 0.02% margin limit
)

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
