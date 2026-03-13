package position

import "time"

// TradeOpenedEvent is emitted when the market buy (order #1) is executed
type TradeOpenedEvent struct {
	RunID            string    `json:"run_id"`
	TradeID          string    `json:"trade_id"`
	Timestamp        time.Time `json:"timestamp"`
	TradingPair      string    `json:"trading_pair"`
	ConfiguredOrders []OrderGrid `json:"configured_orders"`
	EntryFee         string    `json:"entry_fee"` // Fee paid on the initial market buy
}

type OrderGrid struct {
	OrderIndex  int    `json:"order_index"`
	OrderNumber int    `json:"order_number"`
	Price       string `json:"price"` // Decimal as string for JSON
	Amount      string `json:"amount"` // Decimal as string for JSON
}

func (e *TradeOpenedEvent) EventType() string {
	return "trade.opened"
}

func (e *TradeOpenedEvent) EventTimestamp() time.Time {
	return e.Timestamp
}

// BuyOrderExecutedEvent is emitted when a safety order is filled
type BuyOrderExecutedEvent struct {
	RunID            string    `json:"run_id"`
	TradeID          string    `json:"trade_id"`
	Timestamp        time.Time `json:"timestamp"`
	Price            string    `json:"price"` // Decimal as string
	Size             string    `json:"size"` // Quote amount (USDT) - SDD § 5.7
	BaseSize         string    `json:"base_size"` // Base currency quantity (e.g., BTC)
	OrderType        OrderType `json:"order_type"`
	LiquidationPrice string    `json:"liquidation_price"` // Updated after fill
	OrderNumber      int       `json:"order_number"` // 1-indexed
	Fee              string    `json:"fee"` // Decimal as string
}

func (e *BuyOrderExecutedEvent) EventType() string {
	return "order.buy.executed"
}

func (e *BuyOrderExecutedEvent) EventTimestamp() time.Time {
	return e.Timestamp
}

// LiquidationPriceUpdatedEvent is emitted after each buy order
type LiquidationPriceUpdatedEvent struct {
	RunID            string    `json:"run_id"`
	TradeID          string    `json:"trade_id"`
	Timestamp        time.Time `json:"timestamp"`
	TradingPair      string    `json:"trading_pair"`
	LiquidationPrice string    `json:"liquidation_price"` // Decimal as string
	CurrentPrice     string    `json:"current_price"` // Decimal as string
	PriceRatio       string    `json:"price_ratio"` // Decimal as string (SDD § 5.6)
}

func (e *LiquidationPriceUpdatedEvent) EventType() string {
	return "liquidation.price.updated"
}

func (e *LiquidationPriceUpdatedEvent) EventTimestamp() time.Time {
	return e.Timestamp
}

// TradeClosedEvent is emitted when position closes (take-profit or liquidation)
type TradeClosedEvent struct {
	RunID         string    `json:"run_id"`
	TradeID       string    `json:"trade_id"`
	OpenTimestamp time.Time `json:"open_timestamp"`
	Timestamp     time.Time `json:"timestamp"`
	TradingPair   string    `json:"trading_pair"`
	ClosingPrice  string    `json:"closing_price"` // Decimal as string
	Size          string    `json:"size"` // Total position size (base currency)
	Profit        string    `json:"profit"` // Decimal as string (SDD § 2.7)
	Duration      int64     `json:"duration"` // Nanoseconds
	Reason        string    `json:"reason"` // "take_profit", "liquidation", "end_of_backtest"
}

func (e *TradeClosedEvent) EventType() string {
	return "trade.closed"
}

func (e *TradeClosedEvent) EventTimestamp() time.Time {
	return e.Timestamp
}

// SellOrderExecutedEvent is emitted when position closes via take-profit with a sell order
type SellOrderExecutedEvent struct {
	RunID       string    `json:"run_id"`
	TradeID     string    `json:"trade_id"`
	Timestamp   time.Time `json:"timestamp"`
	Price       string    `json:"price"` // Decimal as string
	Size        string    `json:"size"` // Quote amount
	BaseSize    string    `json:"base_size"` // Base currency quantity
	Profit      string    `json:"profit"` // Decimal as string
	Fee         string    `json:"fee"` // Decimal as string
}

func (e *SellOrderExecutedEvent) EventType() string {
	return "order.sell.executed"
}

func (e *SellOrderExecutedEvent) EventTimestamp() time.Time {
	return e.Timestamp
}

// PriceChangedEvent is emitted for each candle processed
type PriceChangedEvent struct {
	RunID     string    `json:"run_id"`
	TradeID   string    `json:"trade_id"`
	Timestamp time.Time `json:"timestamp"`
	Open      string    `json:"open"`
	High      string    `json:"high"`
	Low       string    `json:"low"`
	Close     string    `json:"close"`
	Volume    string    `json:"volume"`
}

func (e *PriceChangedEvent) EventType() string {
	return "price.changed"
}

func (e *PriceChangedEvent) EventTimestamp() time.Time {
	return e.Timestamp
}

// MonthlyAdditionEvent is emitted on 30-day boundaries
type MonthlyAdditionEvent struct {
	RunID             string    `json:"run_id"`
	TradeID           string    `json:"trade_id"`
	Timestamp         time.Time `json:"timestamp"`
	AdditionAmount    string    `json:"addition_amount"`
	PreviousBalance   string    `json:"previous_balance"`
	NewBalance        string    `json:"new_balance"`
	AdditionNumber    int       `json:"addition_number"`
	DaysSinceStart    int       `json:"days_since_start"`
}

func (e *MonthlyAdditionEvent) EventType() string {
	return "monthly.addition"
}

func (e *MonthlyAdditionEvent) EventTimestamp() time.Time {
	return e.Timestamp
}
