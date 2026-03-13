// Package config implements the DCA trading strategy configuration data contract
// and order sequence mathematics for the core-engine domain.
//
// # SDD References
//
//   - Section 2.0 — Precision & Lot Size Constraints (Decimal ROUND_HALF_UP mandatory)
//   - Section 2.1 — Order Sequence Formula: Price Levels P_n
//   - Section 2.2 — Order Sequence Formula: Amounts A_n
//   - Section 4.1 — The Config Object (13 parameters with canonical defaults)
//
// # Canonical Test Data (MANDATORY — zero tolerance)
//
//	Test Case 1 (Price Sequence): P_0=100, P_1=98.00, P_2=95.84400000, P_3=93.52457520
//	Test Case 2 (Amount Sequence): R=7.00, A_0=142.85714286, A_1=285.71428571, A_2=571.42857143, sum=1000.00
//	Test Case 3 (Defaults): all 13 parameters from SDD Table 4.1
package config

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/shopspring/decimal"
)

// Canonical default values — SDD Table 4.1
const (
	DefaultTradingPair                = "BTC/USDC"
	DefaultStartDate                  = "2024-01-02 14:00:00"
	DefaultEndDate                    = "2024-01-05 14:00:00"
	DefaultMarginType                 = "cross"
	DefaultNumberOfOrders             = 10
	DefaultExitOnLastOrder            = false
)

var (
	DefaultPriceEntry                = decimal.NewFromFloat(2.0)
	DefaultPriceScale                = decimal.NewFromFloat(1.1)
	DefaultAmountScale               = decimal.NewFromFloat(2.0)
	DefaultAmountPerTrade            = decimal.NewFromFloat(17500)
	DefaultMultiplier                = decimal.NewFromInt(1)
	DefaultTakeProfitDistancePercent = decimal.NewFromFloat(0.5)
	DefaultAccountBalance            = decimal.NewFromFloat(1000)
	DefaultMonthlyAddition           = decimal.NewFromFloat(0.0)
)

// Config holds all DCA trading strategy parameters.
// It is immutable after construction and validation.
// SDD Reference: Section 4.1, Table 4.1
type Config struct {
	tradingPair                string
	startDate                  string
	endDate                    string
	priceEntry                 decimal.Decimal
	priceScale                 decimal.Decimal
	amountScale                decimal.Decimal
	numberOfOrders             int
	amountPerTrade             decimal.Decimal
	marginType                 string
	multiplier                 decimal.Decimal
	takeProfitDistancePercent  decimal.Decimal
	accountBalance             decimal.Decimal
	monthlyAddition            decimal.Decimal
	exitOnLastOrder            bool
}

// Option is a functional option for constructing a Config.
type Option func(*Config)

// NewConfig constructs and validates a Config with canonical defaults plus any provided options.
// Returns an error if any parameter fails validation (FR-003, FR-009–FR-012).
func NewConfig(opts ...Option) (*Config, error) {
	c := &Config{
		tradingPair:               DefaultTradingPair,
		startDate:                 DefaultStartDate,
		endDate:                   DefaultEndDate,
		priceEntry:                DefaultPriceEntry,
		priceScale:                DefaultPriceScale,
		amountScale:               DefaultAmountScale,
		numberOfOrders:            DefaultNumberOfOrders,
		amountPerTrade:            DefaultAmountPerTrade,
		marginType:                DefaultMarginType,
		multiplier:                DefaultMultiplier,
		takeProfitDistancePercent: DefaultTakeProfitDistancePercent,
		accountBalance:            DefaultAccountBalance,
		monthlyAddition:           DefaultMonthlyAddition,
		exitOnLastOrder:           DefaultExitOnLastOrder,
	}
	for _, opt := range opts {
		opt(c)
	}
	if err := c.Validate(); err != nil {
		return nil, err
	}
	return c, nil
}

// Validate enforces all domain constraints. Returns *ValidationError on the first failure.
// FR-003, FR-009, FR-010, FR-011, FR-012 — SC-004 (<1ms)
func (c *Config) Validate() error {
	if c.tradingPair == "" {
		return &ValidationError{Field: "trading_pair", Value: c.tradingPair, Message: "must be non-empty"}
	}
	if c.marginType != "cross" && c.marginType != "isolated" {
		return &ValidationError{
			Field:   "margin_type",
			Value:   c.marginType,
			Message: fmt.Sprintf("must be 'cross' or 'isolated', got '%s'", c.marginType),
		}
	}
	
	// Date Validation
	// Accept RFC 3339 format (YYYY-MM-DDTHH:MM:SSZ) sent by the API
	layout := time.RFC3339
	start, errStart := time.Parse(layout, c.startDate)
	end, errEnd := time.Parse(layout, c.endDate)

	if errStart == nil && errEnd == nil {
		if end.Before(start) {
			return &ValidationError{
				Field:   "end_date",
				Value:   c.endDate,
				Message: "end_date must be greater than or equal to start_date",
			}
		}
	} else {
		return &ValidationError{
			Field:   "start_date/end_date",
			Value:   fmt.Sprintf("%s / %s", c.startDate, c.endDate),
			Message: "dates must be in RFC 3339 format YYYY-MM-DDTHH:MM:SSZ",
		}
	}

	one := decimal.NewFromInt(1)
	if c.multiplier.LessThan(one) {
		return &ValidationError{Field: "multiplier", Value: c.multiplier.String(), Message: "must be >= 1"}
	}
	if c.numberOfOrders < 1 {
		return &ValidationError{Field: "number_of_orders", Value: c.numberOfOrders, Message: "must be >= 1"}
	}
	zero := decimal.Zero
	if c.accountBalance.LessThan(zero) {
		return &ValidationError{Field: "account_balance", Value: c.accountBalance.String(), Message: "must be non-negative"}
	}
	if c.amountPerTrade.LessThan(zero) {
		return &ValidationError{Field: "amount_per_trade", Value: c.amountPerTrade.String(), Message: "must be non-negative"}
	}
	if c.priceEntry.LessThanOrEqual(zero) {
		return &ValidationError{Field: "price_entry", Value: c.priceEntry.String(), Message: "must be > 0"}
	}
	if c.priceScale.LessThanOrEqual(zero) {
		return &ValidationError{Field: "price_scale", Value: c.priceScale.String(), Message: "must be > 0"}
	}
	if c.amountScale.LessThanOrEqual(zero) {
		return &ValidationError{Field: "amount_scale", Value: c.amountScale.String(), Message: "must be > 0"}
	}
	if c.takeProfitDistancePercent.LessThanOrEqual(zero) {
		return &ValidationError{Field: "take_profit_distance_percent", Value: c.takeProfitDistancePercent.String(), Message: "must be > 0"}
	}
	if c.monthlyAddition.LessThan(zero) {
		return &ValidationError{Field: "monthly_addition", Value: c.monthlyAddition.String(), Message: "must be non-negative"}
	}
	return nil
}

// ── Getters ──────────────────────────────────────────────────────────────────

// TradingPair returns the Binance trading pair symbol. SDD §4.1
func (c *Config) TradingPair() string { return c.tradingPair }

// StartDate returns the ISO 8601 backtest start timestamp. SDD §4.1
func (c *Config) StartDate() string { return c.startDate }

// EndDate returns the ISO 8601 backtest end timestamp. SDD §4.1
func (c *Config) EndDate() string { return c.endDate }

// PriceEntry returns the percentage drop (δ) for the first safety order. SDD §2.1
func (c *Config) PriceEntry() decimal.Decimal { return c.priceEntry }

// PriceScale returns the geometric multiplier for price deviation (s_p). SDD §2.1
func (c *Config) PriceScale() decimal.Decimal { return c.priceScale }

// AmountScale returns the geometric multiplier for order sizing (s_a). SDD §2.2
func (c *Config) AmountScale() decimal.Decimal { return c.amountScale }

// NumberOfOrders returns the total count of DCA orders including the initial market buy (N). SDD §4.1
func (c *Config) NumberOfOrders() int { return c.numberOfOrders }

// AmountPerTrade returns the total capital per trade cycle (C). SDD §2.2, §4.1
// If <= 1.0, the caller must interpret as a fraction of account equity at runtime.
func (c *Config) AmountPerTrade() decimal.Decimal { return c.amountPerTrade }

// MarginType returns the margin mode: "cross" or "isolated". SDD §4.1
func (c *Config) MarginType() string { return c.marginType }

// Multiplier returns the leverage multiplier (m). SDD §2.2, §4.1
func (c *Config) Multiplier() decimal.Decimal { return c.multiplier }

// TakeProfitDistancePercent returns the TP distance above average entry (d_tp%). SDD §2.4
func (c *Config) TakeProfitDistancePercent() decimal.Decimal { return c.takeProfitDistancePercent }

// AccountBalance returns the starting account equity in quote currency. SDD §4.1
func (c *Config) AccountBalance() decimal.Decimal { return c.accountBalance }

// MonthlyAddition returns the monthly capital injection amount. SDD §4.1
func (c *Config) MonthlyAddition() decimal.Decimal { return c.monthlyAddition }

// ExitOnLastOrder returns whether the simulation stops when the last safety order fills. SDD §4.1
func (c *Config) ExitOnLastOrder() bool { return c.exitOnLastOrder }

// ── Functional Options ────────────────────────────────────────────────────────

func WithTradingPair(v string) Option                { return func(c *Config) { c.tradingPair = v } }
func WithStartDate(v string) Option                  { return func(c *Config) { c.startDate = v } }
func WithEndDate(v string) Option                    { return func(c *Config) { c.endDate = v } }
func WithPriceEntry(v decimal.Decimal) Option        { return func(c *Config) { c.priceEntry = v } }
func WithPriceScale(v decimal.Decimal) Option        { return func(c *Config) { c.priceScale = v } }
func WithAmountScale(v decimal.Decimal) Option       { return func(c *Config) { c.amountScale = v } }
func WithNumberOfOrders(v int) Option                { return func(c *Config) { c.numberOfOrders = v } }
func WithAmountPerTrade(v decimal.Decimal) Option    { return func(c *Config) { c.amountPerTrade = v } }
func WithMarginType(v string) Option                 { return func(c *Config) { c.marginType = v } }
func WithMultiplier(v decimal.Decimal) Option        { return func(c *Config) { c.multiplier = v } }
func WithTakeProfitDistancePercent(v decimal.Decimal) Option {
	return func(c *Config) { c.takeProfitDistancePercent = v }
}
func WithAccountBalance(v decimal.Decimal) Option  { return func(c *Config) { c.accountBalance = v } }
func WithMonthlyAddition(v decimal.Decimal) Option { return func(c *Config) { c.monthlyAddition = v } }
func WithExitOnLastOrder(v bool) Option            { return func(c *Config) { c.exitOnLastOrder = v } }

// ── JSON Serialization ────────────────────────────────────────────────────────

// configJSON is the JSON-serializable mirror of Config. shopspring/decimal implements
// json.Marshaler/Unmarshaler, preserving full precision without float conversion.
type configJSON struct {
	TradingPair                string          `json:"trading_pair"`
	StartDate                  string          `json:"start_date"`
	EndDate                    string          `json:"end_date"`
	PriceEntry                 decimal.Decimal `json:"price_entry"`
	PriceScale                 decimal.Decimal `json:"price_scale"`
	AmountScale                decimal.Decimal `json:"amount_scale"`
	NumberOfOrders             int             `json:"number_of_orders"`
	AmountPerTrade             decimal.Decimal `json:"amount_per_trade"`
	MarginType                 string          `json:"margin_type"`
	Multiplier                 decimal.Decimal `json:"multiplier"`
	TakeProfitDistancePercent  decimal.Decimal `json:"take_profit_distance_percent"`
	AccountBalance             decimal.Decimal `json:"account_balance"`
	MonthlyAddition            decimal.Decimal `json:"monthly_addition"`
	ExitOnLastOrder            bool            `json:"exit_on_last_order"`
}

// ToJSON serialises the Config to a JSON byte slice. All Decimal fields retain full
// fixed-point precision (SC-005). FR-014.
func (c *Config) ToJSON() ([]byte, error) {
	return json.Marshal(configJSON{
		TradingPair:               c.tradingPair,
		StartDate:                 c.startDate,
		EndDate:                   c.endDate,
		PriceEntry:                c.priceEntry,
		PriceScale:                c.priceScale,
		AmountScale:               c.amountScale,
		NumberOfOrders:            c.numberOfOrders,
		AmountPerTrade:            c.amountPerTrade,
		MarginType:                c.marginType,
		Multiplier:                c.multiplier,
		TakeProfitDistancePercent: c.takeProfitDistancePercent,
		AccountBalance:            c.accountBalance,
		MonthlyAddition:           c.monthlyAddition,
		ExitOnLastOrder:           c.exitOnLastOrder,
	})
}

// FromJSON deserialises a JSON byte slice into a validated Config. FR-014.
func FromJSON(data []byte) (*Config, error) {
	var j configJSON
	if err := json.Unmarshal(data, &j); err != nil {
		return nil, fmt.Errorf("FromJSON: unmarshal failed: %w", err)
	}
	return NewConfig(
		WithTradingPair(j.TradingPair),
		WithStartDate(j.StartDate),
		WithEndDate(j.EndDate),
		WithPriceEntry(j.PriceEntry),
		WithPriceScale(j.PriceScale),
		WithAmountScale(j.AmountScale),
		WithNumberOfOrders(j.NumberOfOrders),
		WithAmountPerTrade(j.AmountPerTrade),
		WithMarginType(j.MarginType),
		WithMultiplier(j.Multiplier),
		WithTakeProfitDistancePercent(j.TakeProfitDistancePercent),
		WithAccountBalance(j.AccountBalance),
		WithMonthlyAddition(j.MonthlyAddition),
		WithExitOnLastOrder(j.ExitOnLastOrder),
	)
}

// ── Sequence types ────────────────────────────────────────────────────────────

// PriceSequence is an ordered slice of Decimal price levels [P_0 … P_{N-1}].
// P_0 is the market entry price; subsequent values are safety-order trigger prices.
// SDD §2.1
type PriceSequence []decimal.Decimal

// IsMonotonicDecreasing returns true when every element is strictly less than the previous.
func (ps PriceSequence) IsMonotonicDecreasing() bool {
	for i := 1; i < len(ps); i++ {
		if !ps[i].LessThan(ps[i-1]) {
			return false
		}
	}
	return true
}

// Min returns the smallest (last) price in the sequence.
func (ps PriceSequence) Min() decimal.Decimal {
	if len(ps) == 0 {
		return decimal.Zero
	}
	return ps[len(ps)-1]
}

// Max returns the largest (first / market) price in the sequence.
func (ps PriceSequence) Max() decimal.Decimal {
	if len(ps) == 0 {
		return decimal.Zero
	}
	return ps[0]
}

// AmountSequence is an ordered slice of Decimal quote-currency amounts [A_0 … A_{N-1}].
// The sum of all elements equals amountPerTrade * multiplier exactly. SDD §2.2
type AmountSequence []decimal.Decimal

// Sum returns the total of all order amounts.
func (as AmountSequence) Sum() decimal.Decimal {
	total := decimal.Zero
	for _, a := range as {
		total = total.Add(a)
	}
	return total
}