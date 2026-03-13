// Package config — Price and Amount sequence computation.
// SDD Reference: Section 2.1 (Price Sequence P_n), Section 2.2 (Amount Sequence A_n)
//
// All arithmetic uses github.com/shopspring/decimal with ROUND_HALF_UP semantics.
// Float64 is strictly forbidden. FR-013.
package config

import (
	"fmt"
	"os"

	"github.com/shopspring/decimal"
)

// precision is the number of decimal places retained for intermediate and final values.
const precision = int32(8)

var (
	hundred = decimal.NewFromInt(100)
)

// ComputePriceSequence computes all N price levels [P_0 … P_{N-1}] for the given
// currentPrice using the Config's priceEntry (δ) and priceScale (s_p) parameters.
//
// Recurrence (SDD §2.1):
//
//	P_0 = currentPrice
//	P_1 = P_0 × (1 − δ/100)
//	P_n = P_{n-1} × (1 − δ/100 × s_p^{n-1}),  n ≥ 2
//
// Canonical test data (zero tolerance):
//
//	P_0=100, δ=2.0, s_p=1.1, N=4 → [100.00000000, 98.00000000, 95.84400000, 93.52457520]
func (c *Config) ComputePriceSequence(currentPrice decimal.Decimal) (PriceSequence, error) {
	if currentPrice.LessThanOrEqual(decimal.Zero) {
		return nil, &SequenceComputationError{
			Sequence: "price",
			Message:  "currentPrice must be > 0, got " + currentPrice.String(),
		}
	}

	n := c.numberOfOrders
	seq := make(PriceSequence, n)
	seq[0] = currentPrice

	delta := c.priceEntry   // δ — percentage
	sp    := c.priceScale   // s_p — geometric scale

	for i := 1; i < n; i++ {
		// exponent is (i-1) for the price_scale: index 1 → s_p^0=1, index 2 → s_p^1, …
		exp := decimal.NewFromInt(int64(i - 1))
		scalePow := sp.Pow(exp)                          // s_p^{i-1}
		deviation := delta.Div(hundred).Mul(scalePow)    // δ/100 × s_p^{i-1}
		factor := decimal.NewFromInt(1).Sub(deviation)    // 1 − deviation
		seq[i] = seq[i-1].Mul(factor).Round(precision)
	}
	return seq, nil
}

// ComputeAmountSequence distributes the Total Volume V across N orders using a geometric
// weighting scheme. SDD §2.2:
//
//	V   = AccountBalance × AmountPerTrade × Multiplier
//	       (AmountPerTrade ≤ 1.0 → fraction of AccountBalance;
//	        AmountPerTrade > 1.0 → absolute USDT amount → V = AmountPerTrade × Multiplier)
//
//	R   = (s_a^N − 1) / (s_a − 1)     (s_a ≠ 1)
//	R   = N                             (s_a = 1)
//	D_n = (V / R) × s_a^n              (USDT dollar amount per order tier)
//
// The returned AmountSequence contains the USDT dollar amounts D_n for each order.
// To obtain Base Currency Quantities call ComputeBaseQuantities(prices).
//
// Canonical test data (zero tolerance, amountPerTrade as absolute USDT):
//
//	C=1000, s_a=2.0, m=1, N=3 → R=7, [142.85714286, 285.71428571, 571.42857143], sum=1000
func (c *Config) ComputeAmountSequence() (AmountSequence, error) {
	n  := c.numberOfOrders
	sa := c.amountScale
	m  := c.multiplier
	apt := c.amountPerTrade

	one := decimal.NewFromInt(1)
	N   := decimal.NewFromInt(int64(n))

	// SDD §2.2: compute Total Volume V
	// AmountPerTrade ≤ 1.0 → fraction of AccountBalance
	// AmountPerTrade > 1.0 → absolute USDT (V = AmountPerTrade × Multiplier)
	var V decimal.Decimal
	if apt.LessThanOrEqual(one) {
		V = c.accountBalance.Mul(apt).Mul(m)
	} else {
		V = apt.Mul(m)
	}

	// Normalization factor R
	var R decimal.Decimal
	if sa.Equal(one) {
		R = N
	} else {
		saN := sa.Pow(N)
		R = saN.Sub(one).Div(sa.Sub(one))
	}

	D0 := V.Div(R)
	fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] SDD §2.2 Sizing: V=%s USDT, R=%s, D_0=%s USDT (AmountPerTrade=%s, AccountBalance=%s, Multiplier=%s)\n",
		V, R, D0, apt, c.accountBalance, m)

	seq := make(AmountSequence, n)
	for i := 0; i < n; i++ {
		exp   := decimal.NewFromInt(int64(i))
		saPow := sa.Pow(exp)           // s_a^i
		seq[i] = D0.Mul(saPow).Round(precision)
	}

	// Sum invariant: adjust last element so sum(D_n) == V exactly (FR-007, SC-007)
	actualSum := seq.Sum()
	diff := V.Sub(actualSum)
	if !diff.IsZero() {
		seq[n-1] = seq[n-1].Add(diff)
	}

	return seq, nil
}

// ComputeBaseQuantities converts the USDT dollar amounts from ComputeAmountSequence into
// Base Currency (BTC) quantities by dividing each D_n by the corresponding limit price.
// SDD §2.2: Quantity[n] = D_n / P_n
//
// The returned AmountSequence contains pre-computed BTC quantities ready for use in
// NewPosition — no further price division is needed at order execution time.
func (c *Config) ComputeBaseQuantities(prices PriceSequence) (AmountSequence, error) {
	if len(prices) == 0 {
		return nil, &SequenceComputationError{Sequence: "base_quantity", Message: "prices must not be empty"}
	}

	dollarsSeq, err := c.ComputeAmountSequence()
	if err != nil {
		return nil, err
	}
	if len(prices) != len(dollarsSeq) {
		return nil, &SequenceComputationError{
			Sequence: "base_quantity",
			Message:  fmt.Sprintf("prices length %d != amounts length %d", len(prices), len(dollarsSeq)),
		}
	}

	qty := make(AmountSequence, len(dollarsSeq))
	for i, d := range dollarsSeq {
		if prices[i].IsZero() {
			return nil, &SequenceComputationError{
				Sequence: "base_quantity",
				Message:  fmt.Sprintf("price[%d] is zero", i),
			}
		}
		qty[i] = d.Div(prices[i]).Round(precision)
		fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   Order %d: D=%s USDT / P=%s → Qty=%s BTC\n",
			i, d, prices[i], qty[i])
	}
	return qty, nil
}
