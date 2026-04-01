package orchestrator

import (
	"encoding/json"
	"strconv"
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

// appendQuotedFixed8 appends a quoted decimal with 8 fixed places: "X.XXXXXXXX"
func appendQuotedFixed8(dst []byte, d decimal.Decimal) []byte {
	dst = append(dst, '"')
	dst = append(dst, d.StringFixed(8)...)
	dst = append(dst, '"')
	return dst
}

// appendQuotedString appends a JSON-safe quoted string.
func appendQuotedString(dst []byte, s string) []byte {
	dst = append(dst, '"')
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case '"':
			dst = append(dst, '\\', '"')
		case '\\':
			dst = append(dst, '\\', '\\')
		case '\n':
			dst = append(dst, '\\', 'n')
		case '\r':
			dst = append(dst, '\\', 'r')
		case '\t':
			dst = append(dst, '\\', 't')
		default:
			dst = append(dst, c)
		}
	}
	dst = append(dst, '"')
	return dst
}

// AppendJSON appends the JSON representation of the WideEvent to dst without
// using encoding/json (no reflection). The reusable dst buffer eliminates
// per-event allocation. Field order matches the struct's json tags exactly.
func (we *WideEvent) AppendJSON(dst []byte) []byte {
	dst = append(dst, `{"schema_version":`...)
	dst = strconv.AppendInt(dst, int64(we.SchemaVersion), 10)

	dst = append(dst, `,"run_id":`...)
	dst = appendQuotedString(dst, we.RunID)

	dst = append(dst, `,"trade_id":`...)
	dst = appendQuotedString(dst, we.TradeID)

	dst = append(dst, `,"timestamp":"`...)
	dst = we.Timestamp.AppendFormat(dst, time.RFC3339Nano)
	dst = append(dst, '"')

	dst = append(dst, `,"event_type":`...)
	dst = appendQuotedString(dst, we.EventType)

	dst = append(dst, `,"symbol":`...)
	dst = appendQuotedString(dst, we.Symbol)

	// Market
	dst = append(dst, `,"candle_open":`...)
	dst = appendQuotedFixed8(dst, we.CandleOpen.Decimal)

	dst = append(dst, `,"candle_high":`...)
	dst = appendQuotedFixed8(dst, we.CandleHigh.Decimal)

	dst = append(dst, `,"candle_low":`...)
	dst = appendQuotedFixed8(dst, we.CandleLow.Decimal)

	dst = append(dst, `,"candle_close":`...)
	dst = appendQuotedFixed8(dst, we.CandleClose.Decimal)

	dst = append(dst, `,"candle_volume":`...)
	dst = appendQuotedFixed8(dst, we.CandleVolume.Decimal)

	// Portfolio
	dst = append(dst, `,"running_account_balance":`...)
	dst = appendQuotedFixed8(dst, we.RunningAccountBalance.Decimal)

	dst = append(dst, `,"global_candle_count":`...)
	dst = strconv.AppendInt(dst, we.GlobalCandleCount, 10)

	// Position
	dst = append(dst, `,"position_state":`...)
	dst = appendQuotedString(dst, we.PositionState)

	dst = append(dst, `,"average_entry_price":`...)
	dst = appendQuotedFixed8(dst, we.AverageEntryPrice.Decimal)

	dst = append(dst, `,"position_quantity":`...)
	dst = appendQuotedFixed8(dst, we.PositionQuantity.Decimal)

	dst = append(dst, `,"total_capital_deployed":`...)
	dst = appendQuotedFixed8(dst, we.TotalCapitalDeployed.Decimal)

	dst = append(dst, `,"fees_accumulated":`...)
	dst = appendQuotedFixed8(dst, we.FeesAccumulated.Decimal)

	dst = append(dst, `,"take_profit_price":`...)
	dst = appendQuotedFixed8(dst, we.TakeProfitPrice.Decimal)

	dst = append(dst, `,"liquidation_price":`...)
	dst = appendQuotedFixed8(dst, we.LiquidationPrice.Decimal)

	dst = append(dst, `,"filled_orders_count":`...)
	dst = strconv.AppendInt(dst, int64(we.FilledOrdersCount), 10)

	// Analytics
	dst = append(dst, `,"unrealized_pnl":`...)
	dst = appendQuotedFixed8(dst, we.UnrealizedPnl.Decimal)

	dst = append(dst, `,"current_drawdown_pct":`...)
	dst = appendQuotedFixed8(dst, we.CurrentDrawdownPct.Decimal)

	// Action
	dst = append(dst, `,"action_price":`...)
	dst = appendQuotedFixed8(dst, we.ActionPrice.Decimal)

	dst = append(dst, `,"action_quantity":`...)
	dst = appendQuotedFixed8(dst, we.ActionQuantity.Decimal)

	dst = append(dst, `,"action_fee":`...)
	dst = appendQuotedFixed8(dst, we.ActionFee.Decimal)

	dst = append(dst, `,"order_number":`...)
	dst = strconv.AppendInt(dst, int64(we.OrderNumber), 10)

	dst = append(dst, `,"realized_pnl":`...)
	dst = appendQuotedFixed8(dst, we.RealizedPnl.Decimal)

	dst = append(dst, `,"close_reason":`...)
	dst = appendQuotedString(dst, we.CloseReason)

	dst = append(dst, '}')
	return dst
}
