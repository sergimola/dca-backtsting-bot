# config — Core Domain: Configuration Data Contract & Order Sequence Math

Package `config` implements the canonical DCA-bot configuration entity and the two
mathematical sequences derived from it (price grid and amount distribution).

**SDD References:** §2.1 (Price Sequence P_n), §2.2 (Amount Sequence A_n), §4.1 (Validation).

---

## Quick Start

```go
import "github.com/dca-bot/core-engine/domain/config"

// Build a Config with defaults — all 13 parameters are set automatically.
cfg, err := config.NewConfig()
if err != nil {
    log.Fatal(err)
}

// Override specific fields with functional options.
cfg, err = config.NewConfig(
    config.WithTradingPair("BTC/USDT"),
    config.WithNumberOfOrders(10),
    config.WithPriceEntry(config.MustDecimal("2.0")),
    config.WithAmountPerTrade(config.MustDecimal("17500")),
)

// Compute N price levels below the current market price.
prices, err := cfg.ComputePriceSequence(config.MustDecimal("98000"))
// → [98000, 96040, 94118.39…, …]  (10 levels, monotonically decreasing)

// Distribute total capital (C * multiplier) across N orders.
amounts, err := cfg.ComputeAmountSequence()
// → [A_0, A_1, …, A_9]  with sum(A_i) == amountPerTrade * multiplier exactly
```

---

## Canonical Test Cases (zero floating-point tolerance)

### Price Sequence — Test Case 1

| Parameter        | Value  |
|-----------------|--------|
| `price_entry` δ | 2.0    |
| `price_scale` sₚ | 1.1   |
| `number_of_orders` N | 4 |
| `current_price` | 100    |

Recurrence (§2.1):  $P_0 = P_{cur}$, $\quad P_n = P_{n-1} \times \bigl(1 - \tfrac{\delta}{100} \cdot s_p^{n-1}\bigr)$

| n | P_n          |
|---|--------------|
| 0 | 100.00000000 |
| 1 | 98.00000000  |
| 2 | 95.84400000  |
| 3 | 93.52457520  |

### Amount Sequence — Test Case 2

| Parameter          | Value |
|-------------------|-------|
| `amount_per_trade` C | 1000 |
| `amount_scale` sₐ  | 2.0  |
| `multiplier` m     | 1    |
| `number_of_orders` N | 3  |

Formula (§2.2):  $R = \tfrac{s_a^N - 1}{s_a - 1} = 7$, $\quad A_i = \tfrac{C \cdot m \cdot s_a^i}{R}$

| i | A_i            |
|---|----------------|
| 0 | 142.85714286   |
| 1 | 285.71428571   |
| 2 | 571.42857143   |
| **Σ** | **1000.00000000** |

---

## Config Parameters & Defaults

| Parameter                   | Type            | Default              | Constraint        |
|-----------------------------|-----------------|----------------------|-------------------|
| `trading_pair`              | string          | `"LTC/USDT"`         | non-empty         |
| `start_date`                | string          | `"2024-01-02 14:00:00"` | —             |
| `end_date`                  | string          | `"2024-01-05 14:00:00"` | —             |
| `price_entry` (δ)           | decimal.Decimal | `2.0`                | > 0               |
| `price_scale` (sₚ)          | decimal.Decimal | `1.1`                | > 0               |
| `amount_scale` (sₐ)         | decimal.Decimal | `2.0`                | > 0               |
| `number_of_orders` (N)      | int             | `10`                 | ≥ 1               |
| `amount_per_trade` (C)      | decimal.Decimal | `17500`              | ≥ 0               |
| `margin_type`               | string          | `"cross"`            | `"cross"` \| `"isolated"` |
| `multiplier` (m)            | decimal.Decimal | `1`                  | ≥ 1               |
| `take_profit_distance_percent` | decimal.Decimal | `0.5`            | > 0               |
| `account_balance`           | decimal.Decimal | `1000`               | ≥ 0               |
| `monthly_addition`          | decimal.Decimal | `0.0`                | ≥ 0               |
| `exit_on_last_order`        | bool            | `false`              | —                 |

---

## Error Types

| Type                     | When raised                                             |
|--------------------------|---------------------------------------------------------|
| `ValidationError`        | A Config field fails a constraint in `Validate()`       |
| `SequenceComputationError` | `currentPrice ≤ 0` in `ComputePriceSequence()`        |
| `PrecisionError`         | Fixed-point arithmetic fails an invariant               |
| `SumInvariantViolation`  | `sum(A_i) ≠ C*m` after rounding correction (should never occur in practice) |

---

## Design Decisions

- **No `float64` anywhere** — all monetary math uses `github.com/shopspring/decimal` (FR-013).
- **Immutable after construction** — `NewConfig` validates eagerly; getters return copies.
- **Functional options** — `With*()` helpers allow partial overrides without breaking the struct.
- **Sum invariant** — `ComputeAmountSequence` adjusts the last element so `sum(A_i) == C*m` exactly (no rounding leakage).
- **Price sequence length** — `ComputePriceSequence` returns exactly `N` price levels (P_0 … P_{N-1}) where P_0 is the current market price and P_1…P_{N-1} are the DCA buy levels.

---

## Running Tests

```sh
go test ./... -v                           # all tests, verbose
go test ./... -v -run ".*US1.*"            # Config Entity tests only
go test ./... -v -run ".*US2.*"            # Price Sequence tests only
go test ./... -v -run ".*US3.*"            # Amount Sequence tests only
go test ./... -v -run ".*US4.*"            # Validation Constraint tests only
go test -cover -coverprofile=coverage.out ./...
go tool cover -func=coverage.out
```

Current coverage: **88.6%** of statements.

---

## FR-to-Test Mapping

| Functional Requirement | Test(s) |
|------------------------|---------|
| FR-001 Config entity exists | `TestUS1_DefaultConfig` |
| FR-002 All 13 params stored | `TestUS1_AcceptanceScenario1_AllParamsStored`, `TestUS1_GetterTypes` |
| FR-003 Defaults applied | `TestUS1_DefaultConfig`, `TestUS1_AcceptanceScenario2_DefaultsApplied` |
| FR-004 Price sequence P_n | `TestUS2_CanonicalPriceSequence`, `TestUS2_RecurrenceRelation` |
| FR-005 Monotonic decreasing | `TestUS2_MonotonicDecreasing`, `TestUS2_IsMonotonicDecreasing_Method` |
| FR-006 Amount sequence A_n | `TestUS3_CanonicalAmountSequence`, `TestUS3_NormalizationFactorR` |
| FR-007 Sum invariant | `TestUS3_SumInvariant`, `TestUS3_AcceptanceScenario2_SumPreservation` |
| FR-008 Multiplier scaling | `TestUS3_MultiplierScalesAmounts` |
| FR-009 margin_type constraint | `TestUS4_ValidMarginTypes`, `TestUS4_MarginTypeOnlyTwoValues` |
| FR-010 multiplier ≥ 1 | `TestUS4_MultiplierConstraint` |
| FR-011 number_of_orders ≥ 1 | `TestUS4_NumberOfOrdersConstraint`, `TestUS4_SingleOrderIsValid` |
| FR-012 balance/amounts ≥ 0 | `TestUS4_NegativeNumericsFail`, `TestUS4_VerySmallBalanceIsValid` |
| FR-013 No float64 (decimal) | Enforced in all tests; decimal.Decimal throughout |
| FR-014 JSON round-trip | `TestUS1_JSONSerializationPreservesPrecision`, `TestUS1_JSONRoundTrip` |
