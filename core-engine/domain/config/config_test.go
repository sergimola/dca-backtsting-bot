// config_test.go — Unit tests for Config entity, validation, JSON serialization, and
//
//	US1 (Config Contract) + US4 (Constraint Validation) acceptance scenarios.
//
// TDD: All tests in this file were written before the implementation in config.go.
// SDD References: Section 2.0, 4.1 — Test Case 3 (canonical defaults).
//
// Canonical Test Data — Test Case 3 (all 13 defaults, SDD Table 4.1):
//
//	trading_pair                 = "LTC/USDT"
//	start_date                   = "2024-01-02T14:00:00Z"
//	end_date                     = "2024-01-05T14:00:00Z"
//	price_entry                  = 2.0
//	price_scale                  = 1.1
//	amount_scale                 = 2.0
//	number_of_orders             = 10
//	amount_per_trade             = 17500
//	margin_type                  = "cross"
//	multiplier                   = 1
//	take_profit_distance_percent = 0.5
//	account_balance              = 1000
//	monthly_addition             = 0.0
//	exit_on_last_order           = false
package config

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/shopspring/decimal"
)

// ── Helpers (T010) ────────────────────────────────────────────────────────────

// decimalEqual checks that expected and actual are identical string representations,
// which verifies exact fixed-point equality (no float coercion). FR-013.
func decimalEqual(t *testing.T, label string, expected, actual decimal.Decimal) {
	t.Helper()
	if !expected.Equal(actual) {
		t.Errorf("%s: expected %s, got %s", label, expected.String(), actual.String())
	}
}

// mustDecimal converts a string literal to decimal.Decimal and panics on failure.
// Used only in test setup — keeps test data readable.
func mustDecimal(s string) decimal.Decimal {
	d, err := decimal.NewFromString(s)
	if err != nil {
		panic("mustDecimal: invalid string: " + s)
	}
	return d
}

// ── Canonical Test Case 3 constants (T013, T015) ──────────────────────────────

const (
	TC3TradingPair  = "BTC/USDC"
	TC3StartDate    = "2024-01-02T14:00:00Z"
	TC3EndDate      = "2024-01-05T14:00:00Z"
	TC3MarginType   = "cross"
	TC3NumOrders    = 10
	TC3ExitOnLast   = false
)

var (
	TC3PriceEntry                = mustDecimal("2.0")
	TC3PriceScale                = mustDecimal("1.1")
	TC3AmountScale               = mustDecimal("2.0")
	TC3AmountPerTrade            = mustDecimal("17500")
	TC3Multiplier                = mustDecimal("1")
	TC3TakeProfitDistancePct     = mustDecimal("0.5")
	TC3AccountBalance            = mustDecimal("1000")
	TC3MonthlyAddition           = mustDecimal("0.0")
)

// ── Phase 3 / US1: Config Entity Tests (T016–T030) ──────────────────────────

// T016 — US1: NewConfig() with no options applies all 13 canonical defaults.
func TestUS1_DefaultConfig(t *testing.T) {
	cfg, err := NewConfig()
	if err != nil {
		t.Fatalf("NewConfig() unexpected error: %v", err)
	}
	if cfg.TradingPair() != TC3TradingPair {
		t.Errorf("trading_pair: want %q got %q", TC3TradingPair, cfg.TradingPair())
	}
	if cfg.StartDate() != TC3StartDate {
		t.Errorf("start_date: want %q got %q", TC3StartDate, cfg.StartDate())
	}
	if cfg.EndDate() != TC3EndDate {
		t.Errorf("end_date: want %q got %q", TC3EndDate, cfg.EndDate())
	}
	decimalEqual(t, "price_entry", TC3PriceEntry, cfg.PriceEntry())
	decimalEqual(t, "price_scale", TC3PriceScale, cfg.PriceScale())
	decimalEqual(t, "amount_scale", TC3AmountScale, cfg.AmountScale())
	if cfg.NumberOfOrders() != TC3NumOrders {
		t.Errorf("number_of_orders: want %d got %d", TC3NumOrders, cfg.NumberOfOrders())
	}
	decimalEqual(t, "amount_per_trade", TC3AmountPerTrade, cfg.AmountPerTrade())
	if cfg.MarginType() != TC3MarginType {
		t.Errorf("margin_type: want %q got %q", TC3MarginType, cfg.MarginType())
	}
	decimalEqual(t, "multiplier", TC3Multiplier, cfg.Multiplier())
	decimalEqual(t, "take_profit_distance_percent", TC3TakeProfitDistancePct, cfg.TakeProfitDistancePercent())
	decimalEqual(t, "account_balance", TC3AccountBalance, cfg.AccountBalance())
	decimalEqual(t, "monthly_addition", TC3MonthlyAddition, cfg.MonthlyAddition())
	if cfg.ExitOnLastOrder() != TC3ExitOnLast {
		t.Errorf("exit_on_last_order: want %v got %v", TC3ExitOnLast, cfg.ExitOnLastOrder())
	}
}

// T017 — US1: Option overrides one field; remaining 12 take defaults.
func TestUS1_CustomTradingPair(t *testing.T) {
	cfg, err := NewConfig(WithTradingPair("BTC/USDT"))
	if err != nil {
		t.Fatalf("NewConfig() unexpected error: %v", err)
	}
	if cfg.TradingPair() != "BTC/USDT" {
		t.Errorf("trading_pair: want BTC/USDT got %s", cfg.TradingPair())
	}
	// All others stay default
	decimalEqual(t, "price_entry", TC3PriceEntry, cfg.PriceEntry())
	if cfg.NumberOfOrders() != TC3NumOrders {
		t.Errorf("number_of_orders: want %d got %d", TC3NumOrders, cfg.NumberOfOrders())
	}
}

// T018 — US1: Empty trading_pair must fail validation.
func TestUS1_EmptyTradingPairFails(t *testing.T) {
	_, err := NewConfig(WithTradingPair(""))
	if err == nil {
		t.Fatal("expected ValidationError for empty trading_pair, got nil")
	}
	var ve *ValidationError
	if !asValidationError(err, &ve) {
		t.Fatalf("expected *ValidationError, got %T: %v", err, err)
	}
	if ve.Field != "trading_pair" {
		t.Errorf("expected field 'trading_pair', got %q", ve.Field)
	}
}

// T019 — US1: Invalid margin_type value must fail with descriptive error.
func TestUS1_InvalidMarginTypeFails(t *testing.T) {
	_, err := NewConfig(WithMarginType("leverage"))
	if err == nil {
		t.Fatal("expected ValidationError for margin_type='leverage'")
	}
	var ve *ValidationError
	if !asValidationError(err, &ve) {
		t.Fatalf("expected *ValidationError, got %T", err)
	}
	if ve.Field != "margin_type" {
		t.Errorf("expected field 'margin_type', got %q", ve.Field)
	}
	if !strings.Contains(ve.Error(), "leverage") {
		t.Errorf("error message should mention the bad value 'leverage': %s", ve.Error())
	}
}

// T020 — US1: multiplier < 1 must fail.
func TestUS1_MultiplierBelowOneFails(t *testing.T) {
	_, err := NewConfig(WithMultiplier(decimal.NewFromInt(0)))
	if err == nil {
		t.Fatal("expected ValidationError for multiplier=0")
	}
	var ve *ValidationError
	if !asValidationError(err, &ve) {
		t.Fatalf("expected *ValidationError, got %T", err)
	}
	if ve.Field != "multiplier" {
		t.Errorf("expected field 'multiplier', got %q", ve.Field)
	}
}

// T021 — US1: number_of_orders = 0 must fail.
func TestUS1_ZeroOrdersFails(t *testing.T) {
	_, err := NewConfig(WithNumberOfOrders(0))
	if err == nil {
		t.Fatal("expected ValidationError for number_of_orders=0")
	}
	var ve *ValidationError
	if !asValidationError(err, &ve) {
		t.Fatalf("expected *ValidationError, got %T", err)
	}
	if ve.Field != "number_of_orders" {
		t.Errorf("expected field 'number_of_orders', got %q", ve.Field)
	}
}

// T022 — US1: Negative account_balance must fail.
func TestUS1_NegativeAccountBalanceFails(t *testing.T) {
	_, err := NewConfig(WithAccountBalance(mustDecimal("-100")))
	if err == nil {
		t.Fatal("expected ValidationError for account_balance=-100")
	}
	var ve *ValidationError
	if !asValidationError(err, &ve) {
		t.Fatalf("expected *ValidationError, got %T", err)
	}
	if ve.Field != "account_balance" {
		t.Errorf("expected field 'account_balance', got %q", ve.Field)
	}
}

// T023 — US1: Minimal account_balance (0.01) passes validation (edge case E5).
func TestUS1_MinimalAccountBalancePasses(t *testing.T) {
	cfg, err := NewConfig(WithAccountBalance(mustDecimal("0.01")))
	if err != nil {
		t.Fatalf("unexpected error for account_balance=0.01: %v", err)
	}
	decimalEqual(t, "account_balance", mustDecimal("0.01"), cfg.AccountBalance())
}

// T024 — US1 Acceptance Scenario 1: All 13 parameters stored correctly.
func TestUS1_AcceptanceScenario1_AllParamsStored(t *testing.T) {
	cfg, err := NewConfig(
		WithTradingPair("BTC/USDT"),
		WithStartDate("2025-01-01T00:00:00Z"),
		WithEndDate("2025-06-01T00:00:00Z"),
		WithPriceEntry(mustDecimal("3.5")),
		WithPriceScale(mustDecimal("1.2")),
		WithAmountScale(mustDecimal("1.5")),
		WithNumberOfOrders(5),
		WithAmountPerTrade(mustDecimal("5000")),
		WithMarginType("isolated"),
		WithMultiplier(mustDecimal("2")),
		WithTakeProfitDistancePercent(mustDecimal("1.0")),
		WithAccountBalance(mustDecimal("2000")),
		WithMonthlyAddition(mustDecimal("500")),
		WithExitOnLastOrder(true),
	)
	if err != nil {
		t.Fatalf("NewConfig() unexpected error: %v", err)
	}
	if cfg.TradingPair() != "BTC/USDT" {
		t.Errorf("trading_pair mismatch")
	}
	if cfg.NumberOfOrders() != 5 {
		t.Errorf("number_of_orders: want 5 got %d", cfg.NumberOfOrders())
	}
	if cfg.MarginType() != "isolated" {
		t.Errorf("margin_type: want isolated got %s", cfg.MarginType())
	}
	decimalEqual(t, "price_entry", mustDecimal("3.5"), cfg.PriceEntry())
	decimalEqual(t, "multiplier", mustDecimal("2"), cfg.Multiplier())
	if !cfg.ExitOnLastOrder() {
		t.Errorf("exit_on_last_order: want true")
	}
}

// T025 — US1 Acceptance Scenario 2: Omitted params take canonical defaults.
func TestUS1_AcceptanceScenario2_DefaultsApplied(t *testing.T) {
	cfg, err := NewConfig(WithTradingPair("ETH/USDT"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	decimalEqual(t, "price_entry default", TC3PriceEntry, cfg.PriceEntry())
	decimalEqual(t, "amount_per_trade default", TC3AmountPerTrade, cfg.AmountPerTrade())
	if cfg.NumberOfOrders() != TC3NumOrders {
		t.Errorf("number_of_orders default: want %d got %d", TC3NumOrders, cfg.NumberOfOrders())
	}
}

// T026 — US1 Acceptance Scenario 3: Multiple type-like violations produce clear errors.
func TestUS1_AcceptanceScenario3_ValidationErrors(t *testing.T) {
	cases := []struct {
		name string
		opt  Option
		field string
	}{
		{"bad margin_type", WithMarginType("x"), "margin_type"},
		{"zero multiplier", WithMultiplier(decimal.Zero), "multiplier"},
		{"zero orders", WithNumberOfOrders(0), "number_of_orders"},
		{"negative balance", WithAccountBalance(mustDecimal("-1")), "account_balance"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewConfig(tc.opt)
			if err == nil {
				t.Fatalf("expected error for %s", tc.name)
			}
			var ve *ValidationError
			if !asValidationError(err, &ve) {
				t.Fatalf("expected *ValidationError got %T", err)
			}
			if ve.Field != tc.field {
				t.Errorf("field: want %q got %q", tc.field, ve.Field)
			}
		})
	}
}

// T027 — US1 Acceptance Scenario 4: Edge-case numeric values pass validation.
func TestUS1_AcceptanceScenario4_EdgeCasesPass(t *testing.T) {
	cfg, err := NewConfig(
		WithAccountBalance(mustDecimal("0.01")),
		WithAmountPerTrade(mustDecimal("0.5")),
	)
	if err != nil {
		t.Fatalf("unexpected error for edge-case values: %v", err)
	}
	decimalEqual(t, "account_balance", mustDecimal("0.01"), cfg.AccountBalance())
	decimalEqual(t, "amount_per_trade", mustDecimal("0.5"), cfg.AmountPerTrade())
}

// T028 — US1: Config round-trips to JSON and back preserving precision. SC-005, FR-014.
func TestUS1_JSONSerializationPreservesPrecision(t *testing.T) {
	cfg, err := NewConfig(
		WithPriceEntry(mustDecimal("2.123456789")),
		WithAccountBalance(mustDecimal("9999.99999999")),
	)
	if err != nil {
		t.Fatalf("NewConfig: %v", err)
	}
	data, err := cfg.ToJSON()
	if err != nil {
		t.Fatalf("ToJSON: %v", err)
	}
	// Verify the raw JSON contains the exact decimal string (not truncated)
	raw := string(data)
	if !strings.Contains(raw, "2.123456789") {
		t.Errorf("JSON lost precision for price_entry; got: %s", raw)
	}
	// Decode and compare
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
}

// T029 — US1: FromJSON round-trip produces identical Config. SC-005.
func TestUS1_JSONRoundTrip(t *testing.T) {
	orig, err := NewConfig(
		WithTradingPair("ETH/USDT"),
		WithPriceEntry(mustDecimal("1.5")),
		WithNumberOfOrders(7),
		WithMarginType("isolated"),
	)
	if err != nil {
		t.Fatalf("NewConfig: %v", err)
	}
	data, err := orig.ToJSON()
	if err != nil {
		t.Fatalf("ToJSON: %v", err)
	}
	restored, err := FromJSON(data)
	if err != nil {
		t.Fatalf("FromJSON: %v", err)
	}
	if orig.TradingPair() != restored.TradingPair() {
		t.Errorf("trading_pair mismatch after round-trip")
	}
	decimalEqual(t, "price_entry round-trip", orig.PriceEntry(), restored.PriceEntry())
	if orig.NumberOfOrders() != restored.NumberOfOrders() {
		t.Errorf("number_of_orders mismatch after round-trip")
	}
	if orig.MarginType() != restored.MarginType() {
		t.Errorf("margin_type mismatch after round-trip")
	}
}

// T030 — US1: All 13 getters return correct types and are read-only (immutable struct).
func TestUS1_GetterTypes(t *testing.T) {
	cfg, _ := NewConfig()
	// Type assertions via assignment
	var _ string          = cfg.TradingPair()
	var _ string          = cfg.StartDate()
	var _ string          = cfg.EndDate()
	var _ decimal.Decimal = cfg.PriceEntry()
	var _ decimal.Decimal = cfg.PriceScale()
	var _ decimal.Decimal = cfg.AmountScale()
	var _ int             = cfg.NumberOfOrders()
	var _ decimal.Decimal = cfg.AmountPerTrade()
	var _ string          = cfg.MarginType()
	var _ decimal.Decimal = cfg.Multiplier()
	var _ decimal.Decimal = cfg.TakeProfitDistancePercent()
	var _ decimal.Decimal = cfg.AccountBalance()
	var _ decimal.Decimal = cfg.MonthlyAddition()
	var _ bool            = cfg.ExitOnLastOrder()
}

// ── Phase 6 / US4: Constraint Validation Tests (T066–T073) ──────────────────

// T066 — US4: margin_type="cross" passes; margin_type="isolated" passes.
func TestUS4_ValidMarginTypes(t *testing.T) {
	for _, mt := range []string{"cross", "isolated"} {
		cfg, err := NewConfig(WithMarginType(mt))
		if err != nil {
			t.Errorf("margin_type=%q should be valid, got: %v", mt, err)
		}
		if cfg != nil && cfg.MarginType() != mt {
			t.Errorf("margin_type stored as %q, want %q", cfg.MarginType(), mt)
		}
	}
}

// T067 — US4: multiplier=1 and multiplier=3 pass; multiplier=0 fails.
func TestUS4_MultiplierConstraint(t *testing.T) {
	validCases := []string{"1", "2", "3", "10"}
	for _, v := range validCases {
		if _, err := NewConfig(WithMultiplier(mustDecimal(v))); err != nil {
			t.Errorf("multiplier=%s should be valid: %v", v, err)
		}
	}
	_, err := NewConfig(WithMultiplier(decimal.Zero))
	if err == nil {
		t.Error("multiplier=0 should fail")
	}
}

// T068 — US4: number_of_orders >= 1 passes; 0 and negative fail.
func TestUS4_NumberOfOrdersConstraint(t *testing.T) {
	for _, v := range []int{1, 5, 100} {
		if _, err := NewConfig(WithNumberOfOrders(v)); err != nil {
			t.Errorf("number_of_orders=%d should be valid: %v", v, err)
		}
	}
	for _, v := range []int{0, -1} {
		if _, err := NewConfig(WithNumberOfOrders(v)); err == nil {
			t.Errorf("number_of_orders=%d should fail", v)
		}
	}
}

// T069 — US4: Realistic BTC/USDT live-trading-like config passes all constraints.
func TestUS4_RealisticConfigPasses(t *testing.T) {
	_, err := NewConfig(
		WithTradingPair("BTC/USDT"),
		WithAccountBalance(mustDecimal("5000")),
		WithAmountPerTrade(mustDecimal("100")),
		WithNumberOfOrders(5),
		WithMultiplier(mustDecimal("1")),
		WithMarginType("cross"),
	)
	if err != nil {
		t.Fatalf("realistic config failed validation: %v", err)
	}
}

// T070 — US4: Negative values for amount_per_trade, monthly_addition fail.
func TestUS4_NegativeNumericsFail(t *testing.T) {
	cases := []struct {
		name string
		opt  Option
	}{
		{"negative amount_per_trade", WithAmountPerTrade(mustDecimal("-1"))},
		{"negative monthly_addition", WithMonthlyAddition(mustDecimal("-0.01"))},
		{"negative account_balance", WithAccountBalance(mustDecimal("-500"))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := NewConfig(tc.opt); err == nil {
				t.Errorf("%s: expected ValidationError, got nil", tc.name)
			}
		})
	}
}

// T071 — US4: edge case E4 — only "cross" and "isolated" are valid margin_type values.
func TestUS4_MarginTypeOnlyTwoValues(t *testing.T) {
	for _, bad := range []string{"CROSS", "Isolated", "leverage", "spot", "", " "} {
		_, err := NewConfig(WithMarginType(bad))
		if err == nil {
			t.Errorf("margin_type=%q should fail but passed", bad)
		}
	}
}

// T072 — US4: edge case E3 — number_of_orders=1 is valid (single-entry, no safety orders).
func TestUS4_SingleOrderIsValid(t *testing.T) {
	cfg, err := NewConfig(WithNumberOfOrders(1))
	if err != nil {
		t.Fatalf("number_of_orders=1 should be valid: %v", err)
	}
	if cfg.NumberOfOrders() != 1 {
		t.Errorf("number_of_orders: want 1 got %d", cfg.NumberOfOrders())
	}
}

// T073 — US4: edge case E5 — very small account_balance (0.01) is acceptable.
func TestUS4_VerySmallBalanceIsValid(t *testing.T) {
	cfg, err := NewConfig(WithAccountBalance(mustDecimal("0.01")))
	if err != nil {
		t.Fatalf("account_balance=0.01 should be valid: %v", err)
	}
	decimalEqual(t, "account_balance", mustDecimal("0.01"), cfg.AccountBalance())
}

// ── helpers ──────────────────────────────────────────────────────────────────

// asValidationError is a simple type assertion helper (avoids importing errors package).
func asValidationError(err error, target **ValidationError) bool {
	if ve, ok := err.(*ValidationError); ok {
		*target = ve
		return true
	}
	return false
}
