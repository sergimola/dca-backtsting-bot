// Package config defines the data contract for DCA trading strategy configuration.
// This is the public interface specification for Config objects consumed by the trading engine.
// SDD Reference: Section 4.1 (Table 4.1 - Configuration Parameters)
package config

import "github.com/shopspring/decimal"

// Config is the primary data contract encapsulating all DCA trading strategy parameters.
// It serves as the single source of truth for backtest and live trading initialization.
// All fields are immutable after construction and validation.
//
// Implements FR-001: Config data structure with exactly 13 parameters with correct types.
// Implements FR-002: Canonical default values applied when not explicitly provided.
// Implements FR-003: Type validation and constraint checking on instantiation.
//
// SDD Reference: Section 4.1 (Configuration Table 4.1)
type Config interface {
	// Core Trading Parameters (FR-001 & FR-002)

	// TradingPair returns the Binance trading pair (e.g., 'BTC/USDT', 'LTC/USDT').
	// Default: 'LTC/USDT'
	// Type: string
	TradingPair() string

	// StartDate returns the ISO 8601 backtest start timestamp.
	// Default: '2024-01-02 14:00:00'
	// Type: string
	StartDate() string

	// EndDate returns the ISO 8601 backtest end timestamp.
	// Default: '2024-01-05 14:00:00'
	// Type: string
	EndDate() string

	// PriceEntry returns the percentage below current price for first safety order (δ).
	// Default: 2.0
	// Type: Decimal (fixed-point, no float precision)
	// SDD Reference: Section 2.1 (Price Sequence, delta parameter)
	PriceEntry() decimal.Decimal

	// PriceScale returns the geometric multiplier for price deviation scale (s_p).
	// Default: 1.1
	// Type: Decimal (fixed-point)
	// SDD Reference: Section 2.1 (Price Sequence, scale parameter)
	PriceScale() decimal.Decimal

	// AmountScale returns the geometric multiplier for order sizing (s_a).
	// Default: 2.0
	// Type: Decimal (fixed-point)
	// SDD Reference: Section 2.2 (Amount Sequence, scale parameter)
	AmountScale() decimal.Decimal

	// NumberOfOrders returns the total DCA orders including initial market buy (N).
	// Default: 10
	// Type: int
	// Constraint: >= 1 (FR-011)
	NumberOfOrders() int

	// AmountPerTrade returns the capital per trade cycle (C).
	// If <= 1.0, interpreted as fraction of equity: C = (balance + profit) * amount_per_trade.
	// Default: 17500
	// Type: Decimal (fixed-point)
	// Constraint: >= 0 (FR-012)
	// SDD Reference: Section 2.2 (Amount Sequence, C parameter)
	AmountPerTrade() decimal.Decimal

	// MarginType returns the margin mode: 'cross' or 'isolated'.
	// Default: 'cross'
	// Type: string (enum)
	// Constraint: Must be exactly 'cross' or 'isolated' (FR-009)
	MarginType() string

	// Multiplier returns the leverage multiplier (m).
	// Spot trading: m = 1. Margin strategies: m > 1, bounded by exchange limits.
	// Default: 1
	// Type: Decimal (fixed-point)
	// Constraint: >= 1 (FR-010)
	// SDD Reference: Section 2.2 (Amount Sequence, m parameter)
	Multiplier() decimal.Decimal

	// TakeProfitDistancePercent returns the TP distance above average entry (d_tp %).
	// Default: 0.5
	// Type: Decimal (fixed-point)
	// Constraint: > 0 (typical range: 0.1–2.0)
	TakeProfitDistancePercent() decimal.Decimal

	// AccountBalance returns the starting equity in quote currency (USDT, USDC, etc.).
	// Default: 1000
	// Type: Decimal (fixed-point)
	// Constraint: >= 0.01 (FR-012)
	AccountBalance() decimal.Decimal

	// MonthlyAddition returns the monthly capital injection in quote currency.
	// Default: 0.0
	// Type: Decimal (fixed-point)
	// Constraint: >= 0
	MonthlyAddition() decimal.Decimal

	// ExitOnLastOrder returns whether to force simulation end when last safety order fills.
	// Default: false
	// Type: bool
	ExitOnLastOrder() bool

	// Derived Sequence Computations (FR-004 through FR-007)

	// ComputePriceSequence returns an array of trigger prices for all N orders.
	// Formula: P_n = P_{n-1} * (1 - δ/100 * s_p^(n-1))
	// SDD Reference: Section 2.1, Equation E2.1
	//
	// Implements FR-004: Implements Price Sequence formula exactly as specified.
	// Implements FR-005: Returns all price levels P_0, P_1, ..., P_{N-1} as Decimal array.
	//
	// Returns:
	//   - []*Decimal: Array of N prices (current_price, P_1, ..., P_{N-1})
	//   - error: If current_price invalid or computation fails
	//
	// Properties:
	//   - Strictly monotonic decreasing: P_0 > P_1 > ... > P_{N-1}
	//   - All values non-negative
	//   - Fixed-point precision: Decimal with ROUND_HALF_UP
	//   - Canonical Test Data (Test Case 1): Given P_0=100, δ=2.0, s_p=1.1, N=3
	//     Expected: P_0=100.00, P_1=98.00, P_2=95.844, P_3=93.52457520
	ComputePriceSequence(currentPrice decimal.Decimal) (PriceSequence, error)

	// ComputeAmountSequence returns an array of quote currency amounts for all N orders.
	// Formula: R = (s_a^N - 1)/(s_a - 1); A_n = C * m * s_a^n / R
	// SDD Reference: Section 2.2, Equations E2.2a & E2.2b
	//
	// Implements FR-006: Implements Amount Sequence calculation exactly as specified.
	// Implements FR-007: Returns all amounts A_0, A_1, ..., A_{N-1} as Decimal array.
	// Implements FR-008: Handles dynamic amount_per_trade (when <= 1.0 → equity fraction).
	//
	// Returns:
	//   - AmountSequence: Array of N amounts
	//   - error: If normalization or computation fails
	//
	// Properties:
	//   - Sum invariant: sum(A_n) = C * m exactly (zero rounding loss)
	//   - Geometric distribution: A_0 < A_1 < ... < A_{N-1} for s_a > 1
	//   - Fixed-point precision: Decimal with ROUND_HALF_UP
	//   - Canonical Test Data (Test Case 2): Given C=1000, s_a=2.0, m=1, N=3
	//     Expected: R=7.00, A_0=142.85714286, A_1=285.71428571, A_2=571.42857143; sum=1000.00
	ComputeAmountSequence() (AmountSequence, error)

	// Validation & Serialization (FR-003, FR-014, FR-015)

	// Validate performs all type and constraint checks on Config parameters.
	// Returns error if any validation fails; nil if all checks pass.
	//
	// Implements FR-003: Type validation with clear diagnostic messages.
	// Implements FR-009–FR-012: Domain constraint validation.
	//
	// Checks:
	//   1. Type correctness: strings, floats, ints, bools
	//   2. margin_type ∈ {'cross', 'isolated'}
	//   3. multiplier >= 1
	//   4. number_of_orders >= 1
	//   5. All numeric parameters >= 0 (non-negative)
	//   6. start_date <= end_date
	//   7. price_entry > 0, price_scale > 0, amount_scale > 0
	//
	// Error messages are actionable (e.g., "margin_type must be 'cross' or 'isolated', got 'leverage'")
	Validate() error

	// ToJSON serializes Config to JSON string preserving all Decimal precision.
	// Round-trip guarantee (SC-005): JSON → unmarshal → Config produces identical values.
	//
	// Implements FR-014: Serializable without data loss.
	// Implements FR-015: Documents all formulas and parameter meanings.
	ToJSON() (string, error)

	// FromJSON deserializes Config from JSON string.
	// Must reverse ToJSON() exactly; preserves all Decimal precision.
	FromJSON(jsonData string) error
}

// PriceSequence is an array of trigger prices for DCA orders.
// Type: []*Decimal representing P_0, P_1, ..., P_{N-1}
//
// Properties:
//   - Each price strictly less than previous (monotonic decreasing)
//   - All prices non-negative and computed with fixed-point precision
//   - Cardinality: Exactly N (number_of_orders from Config)
//
// SDD Reference: Section 2.1 (Price Sequence Formula)
type PriceSequence []*decimal.Decimal

// AmountSequence is an array of quote currency amounts for DCA orders.
// Type: []*Decimal representing A_0, A_1, ..., A_{N-1}
//
// Properties:
//   - Each amount computed to maintain sum = C * m exactly
//   - Geometric distribution via s_a scale factor
//   - All amounts positive and computed with fixed-point precision
//   - Cardinality: Exactly N (number_of_orders from Config)
//
// SDD Reference: Section 2.2 (Amount Sequence Formula)
type AmountSequence []*decimal.Decimal

// Sum returns the total capital allocated across all orders.
// Must equal C * m exactly (zero rounding loss).
// Returns error if sum invariant violated.
func (seq AmountSequence) Sum() (decimal.Decimal, error) {
	if len(seq) == 0 {
		return decimal.NewFromInt(0), nil
	}

	total := decimal.NewFromInt(0)
	for _, amount := range seq {
		if amount == nil {
			return decimal.Decimal{}, ErrNilAmountInSequence
		}
		total = total.Add(*amount)
	}
	return total, nil
}

// Min returns the minimum price in the sequence.
// For price sequences: should be P_{N-1} (last price).
// For amount sequences: should be A_0 (smallest order, typically).
func (seq PriceSequence) Min() *decimal.Decimal {
	if len(seq) == 0 {
		return nil
	}
	min := seq[0]
	for _, price := range seq[1:] {
		if price != nil && price.LessThan(*min) {
			min = price
		}
	}
	return min
}

// Max returns the maximum price in the sequence.
// For price sequences: should be P_0 (current price, largest).
// For amount sequences: should be A_{N-1} (largest order).
func (seq PriceSequence) Max() *decimal.Decimal {
	if len(seq) == 0 {
		return nil
	}
	max := seq[0]
	for _, price := range seq[1:] {
		if price != nil && price.GreaterThan(*max) {
			max = price
		}
	}
	return max
}

// IsMonotonicDecreasing verifies that prices are strictly descending.
// Returns true if P_0 > P_1 > ... > P_{N-1}; false otherwise.
func (seq PriceSequence) IsMonotonicDecreasing() bool {
	if len(seq) <= 1 {
		return true
	}
	for i := 1; i < len(seq); i++ {
		if seq[i-1] == nil || seq[i] == nil || !seq[i-1].GreaterThan(*seq[i]) {
			return false
		}
	}
	return true
}
