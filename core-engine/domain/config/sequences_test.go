// sequences_test.go — Unit tests for Price Sequence (US2) and Amount Sequence (US3).
//
// TDD: All tests were written before the implementation in sequences.go.
// SDD References: Section 2.1 (P_n), Section 2.2 (A_n).
//
// Canonical Test Data:
//
//	Test Case 1 (Price):  P_0=100, δ=2.0, s_p=1.1, N=3
//	                       → [100.00000000, 98.00000000, 95.84400000, 93.52457520]
//
//	Test Case 2 (Amount): C=1000, s_a=2.0, m=1, N=3
//	                       → R=7, [142.85714286, 285.71428571, 571.42857143], sum=1000
package config

import (
	"testing"

	"github.com/shopspring/decimal"
)

// ── Helpers (T011, T012) ──────────────────────────────────────────────────────

// assertMonotonicDecreasing fails the test if the sequence is not strictly decreasing.
func assertMonotonicDecreasing(t *testing.T, seq PriceSequence) {
	t.Helper()
	for i := 1; i < len(seq); i++ {
		if !seq[i].LessThan(seq[i-1]) {
			t.Errorf("price sequence not monotonic at index %d: seq[%d]=%s >= seq[%d]=%s",
				i, i, seq[i].String(), i-1, seq[i-1].String())
		}
	}
}

// assertSumInvariant fails the test if sum(seq) != expectedSum.
func assertSumInvariant(t *testing.T, seq AmountSequence, expectedSum decimal.Decimal) {
	t.Helper()
	actual := seq.Sum()
	if !actual.Equal(expectedSum) {
		t.Errorf("sum invariant violated: expected %s, got %s", expectedSum.String(), actual.String())
	}
}

// ── Canonical test data constants (T013, T014) ────────────────────────────────

var (
	// Test Case 1 — Price Sequence
	// 4 price levels produced for N=4 (P_0…P_3): SDD §2.1 canonical example.
	TC1CurrentPrice = mustDecimal("100")
	TC1PriceEntry   = mustDecimal("2.0")
	TC1PriceScale   = mustDecimal("1.1")
	TC1NumOrders    = 4
	TC1Expected     = []string{"100.00000000", "98.00000000", "95.84400000", "93.52457520"}

	// Test Case 2 — Amount Sequence
	TC2Capital      = mustDecimal("1000")
	TC2AmountScale  = mustDecimal("2.0")
	TC2Multiplier   = mustDecimal("1")
	TC2NumOrders    = 3
	TC2ExpectedR    = mustDecimal("7")
	TC2Expected     = []string{"142.85714286", "285.71428571", "571.42857143"}
	TC2ExpectedSum  = mustDecimal("1000")
)

// configForPriceTest builds a Config tuned for Test Case 1 inputs.
func configForPriceTest(t *testing.T, priceEntry, priceScale string, n int) *Config {
	t.Helper()
	cfg, err := NewConfig(
		WithPriceEntry(mustDecimal(priceEntry)),
		WithPriceScale(mustDecimal(priceScale)),
		WithNumberOfOrders(n),
	)
	if err != nil {
		t.Fatalf("configForPriceTest: %v", err)
	}
	return cfg
}

// configForAmountTest builds a Config tuned for Test Case 2 inputs.
func configForAmountTest(t *testing.T, amountPerTrade, amountScale, multiplier string, n int) *Config {
	t.Helper()
	cfg, err := NewConfig(
		WithAmountPerTrade(mustDecimal(amountPerTrade)),
		WithAmountScale(mustDecimal(amountScale)),
		WithMultiplier(mustDecimal(multiplier)),
		WithNumberOfOrders(n),
	)
	if err != nil {
		t.Fatalf("configForAmountTest: %v", err)
	}
	return cfg
}

// ── Phase 4 / US2: Price Sequence Tests (T039–T047) ─────────────────────────

// T039 — US2: Canonical Test Case 1 — exact Decimal values required (zero tolerance).
func TestUS2_CanonicalPriceSequence(t *testing.T) {
	cfg := configForPriceTest(t, "2.0", "1.1", TC1NumOrders)
	seq, err := cfg.ComputePriceSequence(TC1CurrentPrice)
	if err != nil {
		t.Fatalf("ComputePriceSequence: %v", err)
	}
	if len(seq) != TC1NumOrders {
		t.Fatalf("expected %d prices, got %d", TC1NumOrders, len(seq))
	}
	for i, expStr := range TC1Expected {
		expected := mustDecimal(expStr)
		if !seq[i].Equal(expected) {
			t.Errorf("P_%d: expected %s, got %s", i, expected.String(), seq[i].String())
		}
	}
}

// T040 — US2: Price sequence is strictly monotonic decreasing for various parameters.
func TestUS2_MonotonicDecreasing(t *testing.T) {
	cases := []struct{ pe, ps string; n int }{
		{"2.0", "1.0", 5},
		{"2.0", "1.1", 5},
		{"0.5", "1.2", 8},
		{"5.0", "2.0", 4},
	}
	for _, tc := range cases {
		cfg := configForPriceTest(t, tc.pe, tc.ps, tc.n)
		seq, err := cfg.ComputePriceSequence(mustDecimal("100"))
		if err != nil {
			t.Errorf("ComputePriceSequence(pe=%s,ps=%s,n=%d) error: %v", tc.pe, tc.ps, tc.n, err)
			continue
		}
		assertMonotonicDecreasing(t, seq)
	}
}

// T041 — US2 Acceptance Scenario 3: Larger price_scale means faster-growing deviations.
func TestUS2_ScaleFactorEffect(t *testing.T) {
	n := 4
	cfgFlat := configForPriceTest(t, "2.0", "1.0", n)
	cfgGrow := configForPriceTest(t, "2.0", "2.0", n)

	seqFlat, _ := cfgFlat.ComputePriceSequence(mustDecimal("100"))
	seqGrow, _ := cfgGrow.ComputePriceSequence(mustDecimal("100"))

	// From index 2 onwards, the growing-scale prices should be lower (larger drop)
	for i := 2; i < n; i++ {
		if !seqGrow[i].LessThan(seqFlat[i]) {
			t.Errorf("P_%d with scale=2.0 (%s) should be < P_%d with scale=1.0 (%s)",
				i, seqGrow[i], i, seqFlat[i])
		}
	}
}

// T042 — US2 Acceptance Scenario 4: Recurrence relation P_n = P_{n-1}*(1 - δ/100 * s_p^{n-1}).
func TestUS2_RecurrenceRelation(t *testing.T) {
	cfg := configForPriceTest(t, "2.0", "1.1", 5)
	seq, err := cfg.ComputePriceSequence(mustDecimal("100"))
	if err != nil {
		t.Fatalf("ComputePriceSequence: %v", err)
	}
	delta := cfg.PriceEntry()
	sp    := cfg.PriceScale()
	h     := decimal.NewFromInt(100)
	one   := decimal.NewFromInt(1)

	for i := 1; i < len(seq); i++ {
		exp := decimal.NewFromInt(int64(i - 1))
		scalePow   := sp.Pow(exp)
		deviation  := delta.Div(h).Mul(scalePow)
		factor     := one.Sub(deviation)
		expected   := seq[i-1].Mul(factor).Round(8)
		if !seq[i].Equal(expected) {
			t.Errorf("recurrence broken at i=%d: expected %s, got %s", i, expected, seq[i])
		}
	}
}

// T043 — US2: Edge case E2 — price_scale=1.0 yields uniform percentage spacing.
func TestUS2_UniformSpacing_ScaleOne(t *testing.T) {
	n := 5
	cfg := configForPriceTest(t, "2.0", "1.0", n)
	seq, err := cfg.ComputePriceSequence(mustDecimal("100"))
	if err != nil {
		t.Fatalf("ComputePriceSequence: %v", err)
	}
	// With scale=1.0, every step uses the same 2% deviation, so differences are proportional
	// to previous price (not constant absolute). Monotonicity is sufficient.
	assertMonotonicDecreasing(t, seq)
	// Verify P_1 = 100 * (1 - 0.02) = 98.00
	if !seq[1].Equal(mustDecimal("98.00000000")) {
		t.Errorf("P_1 with scale=1.0: expected 98.00000000, got %s", seq[1])
	}
}

// T044 — US2: Edge case E3 — number_of_orders=1 returns single-element [P_0].
func TestUS2_SingleOrderReturnsEntryOnly(t *testing.T) {
	cfg := configForPriceTest(t, "2.0", "1.1", 1)
	seq, err := cfg.ComputePriceSequence(mustDecimal("100"))
	if err != nil {
		t.Fatalf("ComputePriceSequence: %v", err)
	}
	if len(seq) != 1 {
		t.Fatalf("expected len=1, got %d", len(seq))
	}
	if !seq[0].Equal(mustDecimal("100")) {
		t.Errorf("P_0 should be currentPrice=100, got %s", seq[0])
	}
}

// T045 — US2: currentPrice <= 0 must return SequenceComputationError.
func TestUS2_InvalidCurrentPriceFails(t *testing.T) {
	cfg := configForPriceTest(t, "2.0", "1.1", 3)
	for _, badPrice := range []string{"0", "-50"} {
		_, err := cfg.ComputePriceSequence(mustDecimal(badPrice))
		if err == nil {
			t.Errorf("expected error for currentPrice=%s", badPrice)
			continue
		}
		if _, ok := err.(*SequenceComputationError); !ok {
			t.Errorf("expected *SequenceComputationError, got %T", err)
		}
	}
}

// T046 — US2 Acceptance Scenario 1: P_1 < P_0 for any valid price_entry > 0.
func TestUS2_P1AlwaysLessThanP0(t *testing.T) {
	cases := []struct{ pe, ps string }{
		{"0.5", "1.0"}, {"2.0", "1.1"}, {"5.0", "2.0"},
	}
	for _, tc := range cases {
		cfg := configForPriceTest(t, tc.pe, tc.ps, 3)
		seq, err := cfg.ComputePriceSequence(mustDecimal("100"))
		if err != nil {
			t.Errorf("error: %v", err)
			continue
		}
		if !seq[1].LessThan(seq[0]) {
			t.Errorf("P_1 (%s) should be < P_0 (%s)", seq[1], seq[0])
		}
	}
}

// T047 — US2 Acceptance Scenario 2: PriceSequence.IsMonotonicDecreasing() invariant.
func TestUS2_IsMonotonicDecreasing_Method(t *testing.T) {
	cfg := configForPriceTest(t, "2.0", "1.1", TC1NumOrders)
	seq, _ := cfg.ComputePriceSequence(TC1CurrentPrice)
	if !seq.IsMonotonicDecreasing() {
		t.Error("IsMonotonicDecreasing() returned false for canonical sequence")
	}
}

// ── Phase 5 / US3: Amount Sequence Tests (T052–T061) ─────────────────────────

// T052 — US3: Canonical Test Case 2 — exact Decimal values (zero tolerance).
func TestUS3_CanonicalAmountSequence(t *testing.T) {
	cfg := configForAmountTest(t, "1000", "2.0", "1", TC2NumOrders)
	seq, err := cfg.ComputeAmountSequence(decimal.Zero)
	if err != nil {
		t.Fatalf("ComputeAmountSequence: %v", err)
	}
	if len(seq) != TC2NumOrders {
		t.Fatalf("expected %d amounts, got %d", TC2NumOrders, len(seq))
	}
	for i, expStr := range TC2Expected {
		expected := mustDecimal(expStr)
		if !seq[i].Equal(expected) {
			t.Errorf("A_%d: expected %s, got %s", i, expected.String(), seq[i].String())
		}
	}
	assertSumInvariant(t, seq, TC2ExpectedSum)
}

// T053 — US3: Sum invariant holds for various parameter combinations.
func TestUS3_SumInvariant(t *testing.T) {
	cases := []struct{ C, sa, m string; n int }{
		{"10", "1.5", "1", 3},
		{"100", "2.0", "2", 5},
		{"1000", "3.0", "1", 4},
		{"500", "1.5", "3", 6},
	}
	for _, tc := range cases {
		cfg := configForAmountTest(t, tc.C, tc.sa, tc.m, tc.n)
		seq, err := cfg.ComputeAmountSequence(decimal.Zero)
		if err != nil {
			t.Errorf("AmountSequence error: %v", err)
			continue
		}
		expected := mustDecimal(tc.C).Mul(mustDecimal(tc.m))
		assertSumInvariant(t, seq, expected)
	}
}

// T054 — US3: Normalization factor R = (s_a^N - 1)/(s_a - 1).
func TestUS3_NormalizationFactorR(t *testing.T) {
	// With C=7, s_a=2, N=3, R=7 → each A_i = 7*2^i/7 = 2^i → [1,2,4], sum=7
	cfg := configForAmountTest(t, "7", "2.0", "1", 3)
	seq, err := cfg.ComputeAmountSequence(decimal.Zero)
	if err != nil {
		t.Fatalf("ComputeAmountSequence: %v", err)
	}
	assertSumInvariant(t, seq, mustDecimal("7"))
	// A_0=1, A_1=2, A_2=4
	if !seq[0].Equal(mustDecimal("1.00000000")) {
		t.Errorf("A_0 with C=7,s_a=2,N=3: expected 1.00000000, got %s", seq[0])
	}
}

// T055 — US3 Acceptance Scenario 4: multiplier scales total capital by m.
// Each individual A_i is rounded independently to 8dp, so element-wise exact
// doubling cannot be guaranteed; the sum invariant is the authoritative check.
func TestUS3_MultiplierScalesAmounts(t *testing.T) {
	cfgM1 := configForAmountTest(t, "1000", "2.0", "1", 3)
	cfgM2 := configForAmountTest(t, "1000", "2.0", "2", 3)

	seq1, _ := cfgM1.ComputeAmountSequence(decimal.Zero)
	seq2, _ := cfgM2.ComputeAmountSequence(decimal.Zero)

	// Total capital deployed must match C*m for each config
	assertSumInvariant(t, seq1, mustDecimal("1000"))
	assertSumInvariant(t, seq2, mustDecimal("2000"))

	// Each seq2 amount must be strictly greater than the corresponding seq1 amount
	for i := range seq1 {
		if !seq2[i].GreaterThan(seq1[i]) {
			t.Errorf("A_%d(m=2) %s should be > A_%d(m=1) %s", i, seq2[i], i, seq1[i])
		}
	}
}

// T056 — US3: For amount_scale > 1, amounts are strictly increasing.
func TestUS3_AmountsGeometricOrdering(t *testing.T) {
	cfg := configForAmountTest(t, "1000", "2.0", "1", 5)
	seq, _ := cfg.ComputeAmountSequence(decimal.Zero)
	for i := 1; i < len(seq); i++ {
		if !seq[i].GreaterThan(seq[i-1]) {
			t.Errorf("A_%d (%s) should be > A_%d (%s)", i, seq[i], i-1, seq[i-1])
		}
	}
}

// T057 — US3: Edge case E2 — amount_scale=1.0 distributes evenly (uniform).
func TestUS3_UniformDistribution_ScaleOne(t *testing.T) {
	cfg := configForAmountTest(t, "300", "1.0", "1", 3)
	seq, err := cfg.ComputeAmountSequence(decimal.Zero)
	if err != nil {
		t.Fatalf("ComputeAmountSequence: %v", err)
	}
	// Each should be 100 (= 300/3)
	expected := mustDecimal("100")
	for i, a := range seq {
		if !a.Equal(expected) {
			t.Errorf("A_%d with scale=1.0: expected %s, got %s", i, expected, a)
		}
	}
	assertSumInvariant(t, seq, mustDecimal("300"))
}

// T058 — US3 Acceptance Scenario 5: amount_per_trade ≤ 1.0 is treated as a fraction of
// AccountBalance. V = AccountBalance × AmountPerTrade × Multiplier.
func TestUS3_FractionalAmountPerTradeScaledByBalance(t *testing.T) {
	cfg, err := NewConfig(WithAmountPerTrade(mustDecimal("0.5")))
	if err != nil {
		t.Fatalf("NewConfig: %v", err)
	}
	// Config stores 0.5 raw; ComputeAmountSequence(dynamicBalance) applies V = dynamicBalance × 0.5 × 1
	// Passing mustDecimal("1000") replicates the former DefaultAccountBalance=1000 behaviour: V = 500 USDT
	decimalEqual(&testing.T{}, "amount_per_trade", mustDecimal("0.5"), cfg.AmountPerTrade())
	seq, err := cfg.ComputeAmountSequence(mustDecimal("1000"))
	if err != nil {
		t.Fatalf("ComputeAmountSequence: %v", err)
	}
	// Sum must equal V = 500, not 0.5
	assertSumInvariant(t, seq, mustDecimal("500"))
}

// T059 — US3: Edge case E3 — number_of_orders=1 returns single-element [C*m].
func TestUS3_SingleOrderReturnsTotal(t *testing.T) {
	cfg := configForAmountTest(t, "1000", "2.0", "1", 1)
	seq, err := cfg.ComputeAmountSequence(decimal.Zero)
	if err != nil {
		t.Fatalf("ComputeAmountSequence: %v", err)
	}
	if len(seq) != 1 {
		t.Fatalf("expected len=1, got %d", len(seq))
	}
	if !seq[0].Equal(mustDecimal("1000")) {
		t.Errorf("A_0 with N=1: expected 1000, got %s", seq[0])
	}
}

// T060 — US3 Acceptance Scenario 1: Exact amounts match Test Case 2 expected values.
func TestUS3_AcceptanceScenario1_ExactAmounts(t *testing.T) {
	// Duplicate of T052 as the explicit acceptance-scenario form
	cfg := configForAmountTest(t, "1000", "2.0", "1", 3)
	seq, _ := cfg.ComputeAmountSequence(decimal.Zero)
	decimalEq := func(label, expStr string, actual decimal.Decimal) {
		exp := mustDecimal(expStr)
		if !actual.Equal(exp) {
			t.Errorf("%s: expected %s, got %s", label, expStr, actual)
		}
	}
	decimalEq("A_0", "142.85714286", seq[0])
	decimalEq("A_1", "285.71428571", seq[1])
	decimalEq("A_2", "571.42857143", seq[2])
}

// T061 — US3 Acceptance Scenario 2: Sum == C*m for many combos (zero rounding loss).
func TestUS3_AcceptanceScenario2_SumPreservation(t *testing.T) {
	combos := []struct{ C, sa, m string; n int }{
		{"1000", "2.0", "1", 10},
		{"17500", "2.0", "1", 10},
		{"500", "1.5", "2", 7},
	}
	for _, tc := range combos {
		cfg := configForAmountTest(t, tc.C, tc.sa, tc.m, tc.n)
		seq, err := cfg.ComputeAmountSequence(decimal.Zero)
		if err != nil {
			t.Errorf("error: %v", err)
			continue
		}
		expected := mustDecimal(tc.C).Mul(mustDecimal(tc.m))
		assertSumInvariant(t, seq, expected)
	}
}

// ── Feature 013: PSM Dynamic Trade Sizing Tests (T005–T007) ─────────────────

// T005 — TS013 US1: percentage-mode uses dynamic balance, not static config balance.
// apt=1.0 (100% of balance) with dynamicBalance=5000 → V must be 5000, not the
// static default (~17500 or 1000). Proves the correct balance path is taken.
func TestTS013_US1_PercentageUsesDynamicBalance(t *testing.T) {
	cfg := configForAmountTest(t, "1.0", "1.0", "1", 1)
	seq, err := cfg.ComputeAmountSequence(mustDecimal("5000"))
	if err != nil {
		t.Fatalf("ComputeAmountSequence: %v", err)
	}
	// sum must equal dynamicBalance × apt × m = 5000 × 1.0 × 1 = 5000
	assertSumInvariant(t, seq, mustDecimal("5000.00000000"))
}

// T006 — TS013 US1: half-percentage of grown balance.
// apt=0.5 with dynamicBalance=4000 → V = dynamicBalance × 0.5 × 1 = 2000.
func TestTS013_US1_HalfPercentageOfGrownBalance(t *testing.T) {
	cfg := configForAmountTest(t, "0.5", "1.0", "1", 1)
	seq, err := cfg.ComputeAmountSequence(mustDecimal("4000"))
	if err != nil {
		t.Fatalf("ComputeAmountSequence: %v", err)
	}
	// V = 4000 × 0.5 × 1 = 2000
	assertSumInvariant(t, seq, mustDecimal("2000.00000000"))
}

// T007 — TS013 US1: percentage mode with multiplier scales total by m.
// apt=1.0, m=3, dynamicBalance=5000 → V = dynamicBalance × apt × m = 5000 × 1.0 × 3 = 15000.
func TestTS013_US1_PercentageWithMultiplier(t *testing.T) {
	cfg := configForAmountTest(t, "1.0", "1.0", "3", 1)
	seq, err := cfg.ComputeAmountSequence(mustDecimal("5000"))
	if err != nil {
		t.Fatalf("ComputeAmountSequence: %v", err)
	}
	// V = 5000 × 1.0 × 3 = 15000
	assertSumInvariant(t, seq, mustDecimal("15000.00000000"))
}

// ── Feature 013: User Story 2 — Absolute Amount Immune to Balance Growth (T009–T011) ──

// T009 — TS013 US2: absolute amt ignores dynamicBalance entirely.
// apt=500 > 1.0 → absolute path: V = apt × m = 500 × 1 = 500, regardless of balance.
func TestTS013_US2_AbsoluteIgnoresBalance(t *testing.T) {
	cfg := configForAmountTest(t, "500", "1.0", "1", 1)
	seq, err := cfg.ComputeAmountSequence(mustDecimal("50000"))
	if err != nil {
		t.Fatalf("ComputeAmountSequence: %v", err)
	}
	// V = 500 × 1 = 500 (dynamicBalance=50000 is irrelevant)
	assertSumInvariant(t, seq, mustDecimal("500.00000000"))
}

// T010 — TS013 US2: absolute amount with multiplier.
// apt=500, m=2 → V = 500 × 2 = 1000, balance still ignored.
func TestTS013_US2_AbsoluteWithMultiplier(t *testing.T) {
	cfg := configForAmountTest(t, "500", "1.0", "2", 1)
	seq, err := cfg.ComputeAmountSequence(mustDecimal("50000"))
	if err != nil {
		t.Fatalf("ComputeAmountSequence: %v", err)
	}
	// V = 500 × 2 = 1000
	assertSumInvariant(t, seq, mustDecimal("1000.00000000"))
}

// T011 — TS013 US2: absolute amount when balance is below the apt "floor".
// Even if dynamicBalance < apt, no clamping: V = apt × m = 500 × 1 = 500.
func TestTS013_US2_AbsoluteWhenBalanceBelowFloor(t *testing.T) {
	cfg := configForAmountTest(t, "500", "1.0", "1", 1)
	seq, err := cfg.ComputeAmountSequence(mustDecimal("400"))
	if err != nil {
		t.Fatalf("ComputeAmountSequence: %v", err)
	}
	// No clamping: V = 500 regardless of balance=400
	assertSumInvariant(t, seq, mustDecimal("500.00000000"))
}

// ── Feature 013: User Story 3 — Boundary Condition apt=1.0 (T012–T014) ──────

// T012 — TS013 US3: apt exactly 1.0 is percentage mode (≤ 1.0 branch).
// dynamicBalance=2000 → V = 2000 × 1.0 × 1 = 2000.
func TestTS013_US3_BoundaryExactlyOneIsPercentage(t *testing.T) {
	cfg := configForAmountTest(t, "1.0", "1.0", "1", 1)
	seq, err := cfg.ComputeAmountSequence(mustDecimal("2000"))
	if err != nil {
		t.Fatalf("ComputeAmountSequence: %v", err)
	}
	assertSumInvariant(t, seq, mustDecimal("2000.00000000"))
}

// T013 — TS013 US3: apt just above 1.0 flips to absolute mode (> 1.0 branch).
// apt=1.01 → V = 1.01 × 1 = 1.01, balance is ignored.
func TestTS013_US3_BoundaryAboveOneIsAbsolute(t *testing.T) {
	cfg := configForAmountTest(t, "1.01", "1.0", "1", 1)
	seq, err := cfg.ComputeAmountSequence(mustDecimal("2000"))
	if err != nil {
		t.Fatalf("ComputeAmountSequence: %v", err)
	}
	// absolute: V = 1.01 × 1 = 1.01 (balance 2000 irrelevant)
	assertSumInvariant(t, seq, mustDecimal("1.01000000"))
}

// T014 — TS013 US3: apt=0.5 is percentage mode.
// dynamicBalance=2000 → V = 2000 × 0.5 × 1 = 1000.
func TestTS013_US3_BoundaryHalfPercentage(t *testing.T) {
	cfg := configForAmountTest(t, "0.5", "1.0", "1", 1)
	seq, err := cfg.ComputeAmountSequence(mustDecimal("2000"))
	if err != nil {
		t.Fatalf("ComputeAmountSequence: %v", err)
	}
	// V = 2000 × 0.5 × 1 = 1000
	assertSumInvariant(t, seq, mustDecimal("1000.00000000"))
}

// ── Feature 013: Polish — FR-005 Guard + FR-006 Sum Invariant (T015–T017) ────

// T015 — TS013 FR-005: zero dynamicBalance in percentage mode returns error.
func TestTS013_FR005_ZeroBalanceReturnsError(t *testing.T) {
	cfg := configForAmountTest(t, "1.0", "1.0", "1", 1)
	_, err := cfg.ComputeAmountSequence(decimal.Zero)
	if err == nil {
		t.Fatal("expected error for dynamicBalance=0, got nil")
	}
	if _, ok := err.(*SequenceComputationError); !ok {
		t.Errorf("expected *SequenceComputationError, got %T: %v", err, err)
	}
}

// T016 — TS013 FR-005: negative dynamicBalance in percentage mode returns error.
func TestTS013_FR005_NegativeBalanceReturnsError(t *testing.T) {
	cfg := configForAmountTest(t, "0.5", "1.0", "1", 1)
	_, err := cfg.ComputeAmountSequence(mustDecimal("-100"))
	if err == nil {
		t.Fatal("expected error for dynamicBalance=-100, got nil")
	}
	if _, ok := err.(*SequenceComputationError); !ok {
		t.Errorf("expected *SequenceComputationError, got %T: %v", err, err)
	}
}

// T017 — TS013 FR-006: sum invariant is preserved with dynamic balance across N orders.
// apt=1.0, sa=2.0, m=1, N=10, dynamicBalance=5000 → sum must equal exactly 5000.
func TestTS013_FR006_SumInvariantPreservedWithDynamicBalance(t *testing.T) {
	cfg := configForAmountTest(t, "1.0", "2.0", "1", 10)
	seq, err := cfg.ComputeAmountSequence(mustDecimal("5000"))
	if err != nil {
		t.Fatalf("ComputeAmountSequence: %v", err)
	}
	assertSumInvariant(t, seq, mustDecimal("5000.00000000"))
}
