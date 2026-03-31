package orchestrator

import (
	"encoding/json"
	"time"

	"github.com/shopspring/decimal"
)

// WideDecimal wraps decimal.Decimal to guarantee uniform 8 decimal place serialization.
// MarshalJSON produces quoted strings like "49.09800000" via StringFixed(8).
type WideDecimal struct {
	decimal.Decimal
}

// NewWideDecimal wraps an existing decimal.Decimal value.
func NewWideDecimal(d decimal.Decimal) WideDecimal {
	return WideDecimal{Decimal: d}
}

// MarshalJSON produces a quoted string with exactly 8 decimal places.
// Example: "49.09800000"
func (wd WideDecimal) MarshalJSON() ([]byte, error) {
	return json.Marshal(wd.Decimal.StringFixed(8))
}

// WideEvent is a fully-denormalized analytics record combining candle, position, portfolio,
// and action data into a single flat struct. One WideEvent is emitted per candle tick
// (price_changed) and per PSM fill event (order_filled, position_opened, position_closed).
//
// All fields use value types — no pointers. JSON null is never produced.
// Absent data uses sentinel defaults: "" for strings, "0.00000000" for decimals, 0 for ints.
//
// Field ordering follows the six dimension groups from the spec:
// Identity → Market → Portfolio → Position → Analytics → Action
type WideEvent struct {
	// Identity
	SchemaVersion int       `json:"schema_version"`
	RunID         string    `json:"run_id"`
	TradeID       string    `json:"trade_id"`
	Timestamp     time.Time `json:"timestamp"`
	EventType     string    `json:"event_type"`
	Symbol        string    `json:"symbol"`

	// Market (snapshot of the triggering candle)
	CandleOpen   WideDecimal `json:"candle_open"`
	CandleHigh   WideDecimal `json:"candle_high"`
	CandleLow    WideDecimal `json:"candle_low"`
	CandleClose  WideDecimal `json:"candle_close"`
	CandleVolume WideDecimal `json:"candle_volume"`

	// Portfolio
	RunningAccountBalance WideDecimal `json:"running_account_balance"`
	GlobalCandleCount     int64       `json:"global_candle_count"`

	// Position (sentinel defaults when no position is active)
	PositionState        string      `json:"position_state"`
	AverageEntryPrice    WideDecimal `json:"average_entry_price"`
	PositionQuantity     WideDecimal `json:"position_quantity"`
	TotalCapitalDeployed WideDecimal `json:"total_capital_deployed"`
	FeesAccumulated      WideDecimal `json:"fees_accumulated"`
	TakeProfitPrice      WideDecimal `json:"take_profit_price"`
	LiquidationPrice     WideDecimal `json:"liquidation_price"`
	FilledOrdersCount    int         `json:"filled_orders_count"`

	// Analytics (computed at emit time)
	UnrealizedPnl      WideDecimal `json:"unrealized_pnl"`
	CurrentDrawdownPct WideDecimal `json:"current_drawdown_pct"`

	// Action (event-specific; sentinel defaults for non-fill events)
	ActionPrice    WideDecimal `json:"action_price"`
	ActionQuantity WideDecimal `json:"action_quantity"`
	ActionFee      WideDecimal `json:"action_fee"`
	OrderNumber    int         `json:"order_number"`
	RealizedPnl    WideDecimal `json:"realized_pnl"`
	CloseReason    string      `json:"close_reason"`
}
