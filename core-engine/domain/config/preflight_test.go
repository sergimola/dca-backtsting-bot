package config

import (
	"encoding/json"
	"testing"

	"github.com/shopspring/decimal"
)

// ─── Helpers ─────────────────────────────────────────────────────────────────

// mustConfig creates a Config or panics. Test-only convenience.
func mustConfig(opts ...Option) *Config {
	c, err := NewConfig(opts...)
	if err != nil {
		panic("mustConfig: " + err.Error())
	}
	return c
}

// d is a shorthand for decimal.RequireFromString.
func d(s string) decimal.Decimal { return decimal.RequireFromString(s) }

// ─── Canonical N=3 Config ────────────────────────────────────────────────────
// Spec §Canonical Test Data:
//   base_order=100, safety_size=200, price_scale=1.5, volume_scale=2.0, max_so=3
//
// Mapped to Config fields:
//   numberOfOrders=4 (base + 3 SOs)
//   priceEntry=1.5  (δ — base deviation %)
//   priceScale=1.5  (s_p — geometric scale)
//   amountPerTrade=1500 (total volume so D_0=100, D_1=200, D_2=400, D_3=800)
//   amountScale=2.0 (s_a)
//   multiplier=1

func canonicalN3Config() *Config {
	return mustConfig(
		WithNumberOfOrders(4),
		WithPriceEntry(d("1.5")),
		WithPriceScale(d("1.5")),
		WithAmountPerTrade(d("1500")),
		WithAmountScale(d("2.0")),
		WithMultiplier(d("1")),
		WithAccountBalance(d("10000")),
		WithTakeProfitDistancePercent(d("1.0")),
	)
}

// ─── Canonical N=0 Config ────────────────────────────────────────────────────
// Spec §Canonical Test Data:
//   base_order=100, max_so=0
//
// Mapped to Config fields:
//   numberOfOrders=1 (base only, zero safety orders)
//   amountPerTrade=100

func canonicalN0Config() *Config {
	return mustConfig(
		WithNumberOfOrders(1),
		WithPriceEntry(d("1.5")),
		WithPriceScale(d("1.5")),
		WithAmountPerTrade(d("100")),
		WithAmountScale(d("1.0")),
		WithMultiplier(d("1")),
		WithAccountBalance(d("10000")),
		WithTakeProfitDistancePercent(d("1.0")),
	)
}

// ─── Test: SO1 trigger_price_pct = -1.50000000 ──────────────────────────────

func TestPreFlight_SO1_TriggerPricePct(t *testing.T) {
	cfg := canonicalN3Config()
	result, err := ComputePreFlight(cfg)
	if err != nil {
		t.Fatalf("ComputePreFlight error: %v", err)
	}
	if len(result.Ladder) < 1 {
		t.Fatal("expected at least 1 ladder entry")
	}
	got := result.Ladder[0].TriggerPricePct
	want := d("-1.50000000")
	if !got.Equal(want) {
		t.Errorf("SO1 TriggerPricePct = %s, want %s", got, want)
	}
}

// ─── Test: SO2 trigger_price_pct = -3.75000000 ──────────────────────────────

func TestPreFlight_SO2_TriggerPricePct(t *testing.T) {
	cfg := canonicalN3Config()
	result, err := ComputePreFlight(cfg)
	if err != nil {
		t.Fatalf("ComputePreFlight error: %v", err)
	}
	if len(result.Ladder) < 2 {
		t.Fatal("expected at least 2 ladder entries")
	}
	got := result.Ladder[1].TriggerPricePct
	want := d("-3.75000000")
	if !got.Equal(want) {
		t.Errorf("SO2 TriggerPricePct = %s, want %s", got, want)
	}
}

// ─── Test: SO3 trigger_price_pct = -7.12500000 ──────────────────────────────

func TestPreFlight_SO3_TriggerPricePct(t *testing.T) {
	cfg := canonicalN3Config()
	result, err := ComputePreFlight(cfg)
	if err != nil {
		t.Fatalf("ComputePreFlight error: %v", err)
	}
	if len(result.Ladder) < 3 {
		t.Fatal("expected at least 3 ladder entries")
	}
	got := result.Ladder[2].TriggerPricePct
	want := d("-7.12500000")
	if !got.Equal(want) {
		t.Errorf("SO3 TriggerPricePct = %s, want %s", got, want)
	}
}

// ─── Test: total_capital_required = 1500.00000000 (N=3) ─────────────────────

func TestPreFlight_N3_TotalCapitalRequired(t *testing.T) {
	cfg := canonicalN3Config()
	result, err := ComputePreFlight(cfg)
	if err != nil {
		t.Fatalf("ComputePreFlight error: %v", err)
	}
	got := result.TotalCapitalRequired
	want := d("1500.00000000")
	if !got.Equal(want) {
		t.Errorf("TotalCapitalRequired = %s, want %s", got, want)
	}
}

// ─── Test: max_drawdown_covered_pct = -7.12500000 (N=3) ─────────────────────

func TestPreFlight_N3_MaxDrawdownCoveredPct(t *testing.T) {
	cfg := canonicalN3Config()
	result, err := ComputePreFlight(cfg)
	if err != nil {
		t.Fatalf("ComputePreFlight error: %v", err)
	}
	got := result.MaxDrawdownCoveredPct
	want := d("-7.12500000")
	if !got.Equal(want) {
		t.Errorf("MaxDrawdownCoveredPct = %s, want %s", got, want)
	}
}

// ─── Test: total_capital_required = 100.00000000 (N=0 / base only) ──────────

func TestPreFlight_N0_TotalCapitalRequired(t *testing.T) {
	cfg := canonicalN0Config()
	result, err := ComputePreFlight(cfg)
	if err != nil {
		t.Fatalf("ComputePreFlight error: %v", err)
	}
	got := result.TotalCapitalRequired
	want := d("100.00000000")
	if !got.Equal(want) {
		t.Errorf("TotalCapitalRequired = %s, want %s", got, want)
	}
}

// ─── Test: max_drawdown_covered_pct = 0.00000000 (N=0 / base only) ──────────

func TestPreFlight_N0_MaxDrawdownCoveredPct(t *testing.T) {
	cfg := canonicalN0Config()
	result, err := ComputePreFlight(cfg)
	if err != nil {
		t.Fatalf("ComputePreFlight error: %v", err)
	}
	got := result.MaxDrawdownCoveredPct
	want := d("0.00000000")
	if !got.Equal(want) {
		t.Errorf("MaxDrawdownCoveredPct = %s, want %s", got, want)
	}
	if len(result.Ladder) != 0 {
		t.Errorf("expected empty ladder for N=0, got %d entries", len(result.Ladder))
	}
}

// ─── Test: Determinism — two identical calls produce byte-equal JSON ─────────

func TestPreFlight_Determinism(t *testing.T) {
	cfg := canonicalN3Config()

	result1, err := ComputePreFlight(cfg)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	result2, err := ComputePreFlight(cfg)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}

	j1, _ := json.Marshal(result1)
	j2, _ := json.Marshal(result2)

	if string(j1) != string(j2) {
		t.Errorf("determinism violation:\n  call1: %s\n  call2: %s", j1, j2)
	}
}

// ─── Test: Full ladder structure verification (N=3) ──────────────────────────

func TestPreFlight_N3_FullLadder(t *testing.T) {
	cfg := canonicalN3Config()
	result, err := ComputePreFlight(cfg)
	if err != nil {
		t.Fatalf("ComputePreFlight error: %v", err)
	}

	if len(result.Ladder) != 3 {
		t.Fatalf("expected 3 ladder entries, got %d", len(result.Ladder))
	}

	// Expected values per the spec's canonical test data.
	type want struct {
		level           int
		triggerPricePct string
		triggerPrice    string
		orderSize       string
		cumulativeCost  string
	}
	expects := []want{
		{1, "-1.50000000", "98.50000000", "200.00000000", "300.00000000"},
		{2, "-3.75000000", "96.25000000", "400.00000000", "700.00000000"},
		{3, "-7.12500000", "92.87500000", "800.00000000", "1500.00000000"},
	}

	for i, e := range expects {
		entry := result.Ladder[i]
		if entry.Level != e.level {
			t.Errorf("ladder[%d].Level = %d, want %d", i, entry.Level, e.level)
		}
		if !entry.TriggerPricePct.Equal(d(e.triggerPricePct)) {
			t.Errorf("ladder[%d].TriggerPricePct = %s, want %s", i, entry.TriggerPricePct, e.triggerPricePct)
		}
		if !entry.TriggerPrice.Equal(d(e.triggerPrice)) {
			t.Errorf("ladder[%d].TriggerPrice = %s, want %s", i, entry.TriggerPrice, e.triggerPrice)
		}
		if !entry.OrderSize.Equal(d(e.orderSize)) {
			t.Errorf("ladder[%d].OrderSize = %s, want %s", i, entry.OrderSize, e.orderSize)
		}
		if !entry.CumulativeCost.Equal(d(e.cumulativeCost)) {
			t.Errorf("ladder[%d].CumulativeCost = %s, want %s", i, entry.CumulativeCost, e.cumulativeCost)
		}
	}
}
