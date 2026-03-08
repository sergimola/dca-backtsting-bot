// Package position defines event schema contracts
package position

import "time"

// Event is the base interface for all domain events
type Event interface {
	EventType() string
	EventTimestamp() time.Time
}

// TradeOpenedEvent is emitted when the market buy (order #1) is executed
type TradeOpenedEvent struct {
	RunID string      // Backtest run identifier
	TradeID string    // UUID of this trade
	Timestamp time.Time // When market buy was filled
	TradingPair string // e.g., "BTC/USDT"
	// Amount decimal.Decimal // Total capital allocated (C)
	ConfiguredOrders []OrderGrid // Pre-calculated price/amount grids (SDD § 5.5)
	// Config *config.Config // Full config (strict type, not dict)
}

type OrderGrid struct {
	OrderIndex  int
	OrderNumber int
	Price       string // Decimal as string for JSON
	Amount      string // Decimal as string for JSON
}

func (e *TradeOpenedEvent) EventType() string {
	return "trade.opened"
}

func (e *TradeOpenedEvent) EventTimestamp() time.Time {
	return e.Timestamp
}

// BuyOrderExecutedEvent is emitted when a safety order is filled
type BuyOrderExecutedEvent struct {
	RunID            string // Backtest run identifier
	TradeID          string // UUID of this trade
	Timestamp        time.Time
	Price            string // Decimal as string
	Size             string // Quote amount (USDT) - SDD § 5.7
	BaseSize         string // Base currency quantity (e.g., BTC)
	OrderType        OrderType
	LiquidationPrice string // Updated after fill
	OrderNumber      int    // 1-indexed
	Fee              string // Decimal as string
}

func (e *BuyOrderExecutedEvent) EventType() string {
	return "order.buy.executed"
}

func (e *BuyOrderExecutedEvent) EventTimestamp() time.Time {
	return e.Timestamp
}

// LiquidationPriceUpdatedEvent is emitted after each buy order
type LiquidationPriceUpdatedEvent struct {
	RunID            string
	TradeID          string
	Timestamp        time.Time
	TradingPair      string
	LiquidationPrice string // Decimal as string
	CurrentPrice     string // Decimal as string
	PriceRatio       string // Decimal as string (SDD § 5.6)
}

func (e *LiquidationPriceUpdatedEvent) EventType() string {
	return "liquidation.price.updated"
}

func (e *LiquidationPriceUpdatedEvent) EventTimestamp() time.Time {
	return e.Timestamp
}

// TradeClosedEvent is emitted when position closes (take-profit or liquidation)
type TradeClosedEvent struct {
	RunID         string
	TradeID       string
	OpenTimestamp time.Time
	Timestamp     time.Time
	TradingPair   string
	ClosingPrice  string // Decimal as string
	Size          string // Total position size (base currency)
	Profit        string // Decimal as string (SDD § 2.7)
	Duration      int64  // Nanoseconds
	Reason        string // "take_profit", "liquidation", "end_of_backtest"
}

func (e *TradeClosedEvent) EventType() string {
	return "trade.closed"
}

func (e *TradeClosedEvent) EventTimestamp() time.Time {
	return e.Timestamp
}

// SellOrderExecutedEvent is emitted when position is sold
type SellOrderExecutedEvent struct {
	RunID     string
	TradeID   string
	Timestamp time.Time
	Price     string // Decimal as string
	Size      string // Base quantity sold
	Profit    string // Decimal as string
}

func (e *SellOrderExecutedEvent) EventType() string {
	return "order.sell.executed"
}

func (e *SellOrderExecutedEvent) EventTimestamp() time.Time {
	return e.Timestamp
}

// PriceChangedEvent is emitted at the start of each candle
type PriceChangedEvent struct {
	RunID       string
	TradingPair string
	Timestamp   time.Time
	Open        string // Decimal as string
	High        string // Decimal as string
	Low         string // Decimal as string
	Close       string // Decimal as string
	Volume      string // Decimal as string
}

func (e *PriceChangedEvent) EventType() string {
	return "price.changed"
}

func (e *PriceChangedEvent) EventTimestamp() time.Time {
	return e.Timestamp
}

// MonthlyAdditionEvent is emitted on 30-day boundaries
type MonthlyAdditionEvent struct {
	RunID           string
	Timestamp       time.Time
	TradingPair     string
	AdditionAmount  string // Decimal as string
	PreviousBalance string // Decimal as string
	NewBalance      string // Decimal as string
	AdditionNumber  int    // 1st, 2nd, 3rd injection
	DaysSinceStart  int
}

func (e *MonthlyAdditionEvent) EventType() string {
	return "monthly.addition"
}

func (e *MonthlyAdditionEvent) EventTimestamp() time.Time {
	return e.Timestamp
}
