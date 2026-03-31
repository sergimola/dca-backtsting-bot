package orchestrator

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// T005: Zero-value serialization — no JSON null, all decimals "0.00000000", all strings ""
func TestWideEvent_ZeroValueSerialization(t *testing.T) {
	var we WideEvent
	b, err := json.Marshal(we)
	require.NoError(t, err)

	// Parse into a generic map to inspect field values
	var m map[string]interface{}
	require.NoError(t, json.Unmarshal(b, &m))

	// No field should be null
	for key, val := range m {
		assert.NotNil(t, val, "field %q must not be null", key)
	}

	// Decimal fields must all be "0.00000000"
	decimalFields := []string{
		"candle_open", "candle_high", "candle_low", "candle_close", "candle_volume",
		"running_account_balance",
		"average_entry_price", "position_quantity", "total_capital_deployed",
		"fees_accumulated", "take_profit_price", "liquidation_price",
		"unrealized_pnl", "current_drawdown_pct",
		"action_price", "action_quantity", "action_fee", "realized_pnl",
	}
	for _, f := range decimalFields {
		val, ok := m[f]
		assert.True(t, ok, "expected field %q in JSON", f)
		assert.Equal(t, "0.00000000", val, "field %q zero value", f)
	}

	// String fields must be ""
	stringFields := []string{
		"run_id", "trade_id", "event_type", "symbol",
		"position_state", "close_reason",
	}
	for _, f := range stringFields {
		val, ok := m[f]
		assert.True(t, ok, "expected field %q in JSON", f)
		assert.Equal(t, "", val, "field %q zero value", f)
	}

	// Integer fields must be 0
	intFields := []string{
		"schema_version", "global_candle_count", "filled_orders_count", "order_number",
	}
	for _, f := range intFields {
		val, ok := m[f]
		assert.True(t, ok, "expected field %q in JSON", f)
		assert.Equal(t, float64(0), val, "field %q zero value", f) // JSON numbers decode as float64
	}

	// Timestamp zero-value produces RFC3339 (Go time.Time zero marshals as "0001-01-01T00:00:00Z")
	ts, ok := m["timestamp"]
	assert.True(t, ok)
	assert.IsType(t, "", ts)
}

// T005 (continued): Total field count matches the 28-field contract
func TestWideEvent_FieldCount(t *testing.T) {
	var we WideEvent
	b, err := json.Marshal(we)
	require.NoError(t, err)

	var m map[string]interface{}
	require.NoError(t, json.Unmarshal(b, &m))

	assert.Equal(t, 29, len(m), "WideEvent must have exactly 29 JSON fields (6+5+2+8+2+6)")
}

// T006: Canonical math proof — drawdown calculation
func TestWideEvent_CanonicalDrawdown(t *testing.T) {
	avgEntry := decimal.NewFromInt(100)
	candleLow := decimal.RequireFromString("54.50")

	// current_drawdown_pct = (candle_low − average_entry_price) / average_entry_price × 100
	drawdown := candleLow.Sub(avgEntry).Div(avgEntry).Mul(decimal.NewFromInt(100))

	wd := NewWideDecimal(drawdown)
	b, err := json.Marshal(wd)
	require.NoError(t, err)
	assert.Equal(t, `"-45.50000000"`, string(b))
}

// T006: Canonical math proof — unrealized PnL calculation
func TestWideEvent_CanonicalUnrealizedPnl(t *testing.T) {
	avgEntry := decimal.NewFromInt(100)
	candleClose := decimal.NewFromInt(60)
	posQty := decimal.RequireFromString("2.5")

	// unrealized_pnl = (candle_close − average_entry_price) × position_quantity
	pnl := candleClose.Sub(avgEntry).Mul(posQty)

	wd := NewWideDecimal(pnl)
	b, err := json.Marshal(wd)
	require.NoError(t, err)
	assert.Equal(t, `"-100.00000000"`, string(b))
}

// T005 (supplemental): WideDecimal positive value serialization
func TestWideDecimal_PositiveValue(t *testing.T) {
	d := decimal.RequireFromString("49.098")
	wd := NewWideDecimal(d)

	b, err := json.Marshal(wd)
	require.NoError(t, err)
	assert.Equal(t, `"49.09800000"`, string(b))
}

// T005 (supplemental): WideDecimal zero value
func TestWideDecimal_ZeroValue(t *testing.T) {
	var wd WideDecimal
	b, err := json.Marshal(wd)
	require.NoError(t, err)
	assert.Equal(t, `"0.00000000"`, string(b))
}

// T005 (supplemental): WideEvent with populated fields — schema_version and all fields present
func TestWideEvent_PopulatedSerialization(t *testing.T) {
	we := WideEvent{
		SchemaVersion:         1,
		RunID:                 "test-run-123",
		TradeID:               "test-trade-456",
		Timestamp:             time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
		EventType:             "price_changed",
		Symbol:                "BTCUSDC",
		CandleOpen:            NewWideDecimal(decimal.NewFromInt(97000)),
		CandleHigh:            NewWideDecimal(decimal.NewFromInt(97500)),
		CandleLow:             NewWideDecimal(decimal.NewFromInt(96800)),
		CandleClose:           NewWideDecimal(decimal.NewFromInt(97200)),
		CandleVolume:          NewWideDecimal(decimal.RequireFromString("12.3456789")),
		RunningAccountBalance: NewWideDecimal(decimal.NewFromInt(10000)),
		GlobalCandleCount:     1441,
		PositionState:         "active",
		AverageEntryPrice:     NewWideDecimal(decimal.NewFromInt(97000)),
		PositionQuantity:      NewWideDecimal(decimal.RequireFromString("0.0102")),
		FilledOrdersCount:     1,
	}

	b, err := json.Marshal(we)
	require.NoError(t, err)

	var m map[string]interface{}
	require.NoError(t, json.Unmarshal(b, &m))

	assert.Equal(t, float64(1), m["schema_version"])
	assert.Equal(t, "test-run-123", m["run_id"])
	assert.Equal(t, "price_changed", m["event_type"])
	assert.Equal(t, "97000.00000000", m["candle_open"])
	assert.Equal(t, "12.34567890", m["candle_volume"])
	assert.Equal(t, float64(1441), m["global_candle_count"])
	assert.Equal(t, "active", m["position_state"])

	// Unpopulated decimal fields still get "0.00000000"
	assert.Equal(t, "0.00000000", m["unrealized_pnl"])
	assert.Equal(t, "0.00000000", m["action_price"])
	assert.Equal(t, "", m["close_reason"])
}

// T028: No config field duplication — WideEvent JSON keys must not contain backtest config fields
func TestWideEvent_US4_NoConfigDuplication(t *testing.T) {
	// Populate every field to maximum so all keys appear
	we := WideEvent{
		SchemaVersion:         1,
		RunID:                 "run-1",
		TradeID:               "trade-1",
		Timestamp:             time.Now(),
		EventType:             "price_changed",
		Symbol:                "BTCUSDC",
		CandleOpen:            NewWideDecimal(decimal.NewFromInt(100)),
		CandleHigh:            NewWideDecimal(decimal.NewFromInt(105)),
		CandleLow:             NewWideDecimal(decimal.NewFromInt(95)),
		CandleClose:           NewWideDecimal(decimal.NewFromInt(102)),
		CandleVolume:          NewWideDecimal(decimal.NewFromInt(10)),
		RunningAccountBalance: NewWideDecimal(decimal.NewFromInt(10000)),
		GlobalCandleCount:     1000,
		PositionState:         "active",
		AverageEntryPrice:     NewWideDecimal(decimal.NewFromInt(100)),
		PositionQuantity:      NewWideDecimal(decimal.NewFromInt(1)),
		TotalCapitalDeployed:  NewWideDecimal(decimal.NewFromInt(100)),
		FeesAccumulated:       NewWideDecimal(decimal.NewFromInt(1)),
		TakeProfitPrice:       NewWideDecimal(decimal.NewFromInt(103)),
		LiquidationPrice:      NewWideDecimal(decimal.NewFromInt(50)),
		FilledOrdersCount:     3,
		UnrealizedPnl:         NewWideDecimal(decimal.NewFromInt(2)),
		CurrentDrawdownPct:    NewWideDecimal(decimal.NewFromInt(-5)),
		ActionPrice:           NewWideDecimal(decimal.NewFromInt(99)),
		ActionQuantity:        NewWideDecimal(decimal.NewFromInt(1)),
		ActionFee:             NewWideDecimal(decimal.RequireFromString("0.1")),
		OrderNumber:           2,
		RealizedPnl:           NewWideDecimal(decimal.NewFromInt(50)),
		CloseReason:           "take_profit",
	}

	b, err := json.Marshal(we)
	require.NoError(t, err)

	var m map[string]interface{}
	require.NoError(t, json.Unmarshal(b, &m))

	// Forbidden config fields that MUST NOT appear in WideEvent
	forbiddenKeys := []string{
		"amount_scale",
		"multiplier",
		"take_profit_pct",
		"stop_loss_pct",
		"initial_investment",
		"price_drop_percentage",
		"num_safety_orders",
		"price_scale",
		"amount_per_trade",
		"margin_type",
		"number_of_orders",
		"account_balance",
		"monthly_addition",
		"exit_on_last_order",
	}

	for _, key := range forbiddenKeys {
		_, exists := m[key]
		assert.False(t, exists, "config field %q must NOT appear in WideEvent JSON", key)
	}
}
