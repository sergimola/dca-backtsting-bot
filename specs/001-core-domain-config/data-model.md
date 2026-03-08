# Data Model: Core Domain Configuration & Order Sequence Math

**Date**: 2026-03-07  
**Feature**: 001-core-domain-config  
**Phase**: 1 (Design)

---

## Entity Relationship Diagram

```
┌─────────────────────────────────────┐
│         Config (Primary)            │
├─────────────────────────────────────┤
│ • trading_pair: string              │
│ • start_date: string (ISO 8601)     │
│ • end_date: string (ISO 8601)       │
│ • price_entry: Decimal (δ%)         │
│ • price_scale: Decimal (s_p)        │
│ • amount_scale: Decimal (s_a)       │
│ • number_of_orders: int (N)         │
│ • amount_per_trade: Decimal (C)     │
│ • margin_type: string               │
│ • multiplier: Decimal (m)           │
│ • take_profit_distance_percent: DD  │
│ • account_balance: Decimal          │
│ • monthly_addition: Decimal         │
│ • exit_on_last_order: bool          │
│                                     │
│ • PriceSequence(): []*Decimal      │
│ • AmountSequence(): []*Decimal     │
└────────┬────────────────────────┬───┘
         │                        │
         │ computes              │ computes
         │                        │
    ┌────▼───────────────┐   ┌───▼──────────────────┐
    │ Price Sequence     │   │ Amount Sequence      │
    ├────────────────────┤   ├────────────────────┤
    │ P_0, P_1, ... P_N  │   │ A_0, A_1, ... A_N  │
    │                    │   │                    │
    │ Type: []*Decimal   │   │ Type: []*Decimal   │
    │ Len: N elements    │   │ Len: N elements    │
    │ Strict Monotonic ↓ │   │ Sum = C*m exactly  │
    └────────────────────┘   └────────────────────┘
```

---

## Entity 1: Config (Primary Data Structure)

### Purpose
Encapsulates all Dollar-Cost Averaging (DCA) trading strategy parameters. Acts as the single source of truth for backtesting and live trading initialization. Immutable after construction and validation.

### Master Definition

| Parameter | Type | Default | Unit/Range | Constraint | SDD Ref |
|-----------|------|---------|-----------|-----------|---------|
| `trading_pair` | string | `'LTC/USDT'` | pair symbol | Non-empty; format 'ASSET/QUOTE' | 4.1 |
| `start_date` | string | `'2024-01-02 14:00:00'` | ISO 8601 | Valid timestamp | 4.1 |
| `end_date` | string | `'2024-01-05 14:00:00'` | ISO 8601 | Valid timestamp; >= start_date | 4.1 |
| `price_entry` | Decimal | `2.0` | percentage (δ%) | > 0; typically 0.5–5.0 | 2.1 |
| `price_scale` | Decimal | `1.1` | geometric scale (s_p) | > 0; typically 1.0–2.0 | 2.1 |
| `amount_scale` | Decimal | `2.0` | geometric scale (s_a) | > 0; typically 1.5–3.0 | 2.2 |
| `number_of_orders` | int | `10` | count (N) | >= 1; feasible: 1–100 | 4.1 |
| `amount_per_trade` | Decimal | `17500` | USDT or fraction (C) | >= 0; if <= 1.0 → interpreted as equity fraction | 4.1 |
| `margin_type` | string | `'cross'` | enum: 'cross', 'isolated' | Must be exactly one of two values | 4.1 |
| `multiplier` | Decimal | `1` | leverage (m) | >= 1; spot: =1; margin: >1 | 4.1 |
| `take_profit_distance_percent` | Decimal | `0.5` | percentage (d_tp %) | > 0; typically 0.1–2.0 | 4.1 |
| `account_balance` | Decimal | `1000` | USDT | >= 0.01; typically >= 100 | 4.1 |
| `monthly_addition` | Decimal | `0.0` | USDT | >= 0 | 4.1 |
| `exit_on_last_order` | bool | `false` | boolean | Logic gate | 4.1 |

### Validation Rules (Constraints)

1. **Type Validation** (FR-003):
   - String parameters: non-empty, correct format (trading_pair matches pair pattern, dates are ISO 8601).
   - Numeric parameters: parsed to Decimal; negative values rejected.
   - Boolean parameters: true/false only.

2. **Domain Constraints** (FR-009 through FR-012):
   - `margin_type`: exactly 'cross' or 'isolated'. Invalid values → error message: "margin_type must be 'cross' or 'isolated', got '{value}'".
   - `multiplier`: >= 1. If < 1 → error "multiplier must be >= 1".
   - `number_of_orders`: >= 1. If <= 0 → error "number_of_orders must be >= 1".
   - All numeric parameters (prices, amounts, balance): >= 0. Negative → error "parameter_name must be non-negative".

3. **Logical Constraints**:
   - `start_date` <= `end_date`: If violated, error "start_date must be <= end_date".
   - `amount_per_trade > 0` only for meaningful backtests; = 0 allowed for data-only simulations.
   - `price_entry > 0`: Required for DCA grid construction.
   - `price_scale > 0` and `amount_scale > 0`: Required for geometric scaling formulas.

### Default Application (FR-002)

When a Config parameter is not explicitly provided, apply canonical default from table above. Example:

```go
// Pseudocode: Config instantiation
cfg := &Config{
    trading_pair: params.trading_pair || "LTC/USDT",          // default
    start_date: params.start_date || "2024-01-02 14:00:00",   // default
    price_entry: params.price_entry || decimal.NewFromInt(2), // default
    // ... all 13 parameters
}
```

### Relationships

- **Consumed By**: TradingEngine (future feature). Used to initialize price grid, amount grid, and position state machine.
- **Produces**: PriceSequence (computed on-demand or cached), AmountSequence (computed on-demand or cached).
- **Stored As**: JSON/YAML serialization for backtest configuration files.

### State Transitions

Config is immutable after construction and validation. No state machine; single logical state:
- **Valid** (after construction + validation pass): Read-only; can be serialized, used to compute sequences.
- **Invalid** (validation fails): Constructor returns error; Config object not created.

---

## Entity 2: Price Sequence (Derived)

### Purpose
Array of trigger prices for DCA safety orders. Computed from current market price, price_entry (δ), price_scale (s_p), and number_of_orders (N). Represents descending price levels at which successive buy orders are placed.

### Mathematical Definition (SDD Section 2.1, Equation E2.1)

```
P_0 = current_price
P_1 = P_0 * (1 - δ/100)
For n >= 2:
  P_n = P_{n-1} * (1 - δ/100 * s_p^(n-1))
```

### Formula Expansion Example

Given: P_0=100, δ=2.0, s_p=1.1, N=3

```
P_0 = 100.00000000
P_1 = 100 * (1 - 2.0/100)
    = 100 * 0.98
    = 98.00000000

P_2 = 98 * (1 - 2.0/100 * 1.1^1)
    = 98 * (1 - 0.02 * 1.1)
    = 98 * (1 - 0.022)
    = 98 * 0.978
    = 95.84400000

P_3 = 95.844 * (1 - 2.0/100 * 1.1^2)
    = 95.844 * (1 - 0.02 * 1.21)
    = 95.844 * (1 - 0.0242)
    = 95.844 * 0.9758
    = 93.52457520
```

### Properties

1. **Monotonic Decreasing**: P_0 > P_1 > P_2 > ... > P_{N-1} always holds for all valid parameters (price_entry > 0).
2. **Fixed-Point Precision**: All values stored as Decimal with ROUND_HALF_UP; no float approximation.
3. **Cardinality**: Exactly N elements (number_of_orders from Config).
4. **Non-Negative**: All prices > 0 (assuming valid current_price > 0 and scaling factors > 0).

### Computation Algorithm (FR-004, FR-005)

```
Input: current_price (Decimal), price_entry (δ), price_scale (s_p), number_of_orders (N)
Output: []*Decimal array of N prices

prices := make([]*Decimal, N)
prices[0] = current_price

delta_factor := Decimal(1) - price_entry / Decimal(100)

for i := 1; i < N; i++:
    scale_exponent := Decimal(i - 1)
    scale_multiplier := price_scale ^ scale_exponent
    adjustment := (price_entry / Decimal(100)) * scale_multiplier
    factor := Decimal(1) - adjustment
    prices[i] = prices[i-1] * factor

return prices
```

### Edge Cases

- **price_scale = 1.0**: Scale multiplier = 1 → adjustment constant → Price deviation uniform (linear degradation).
- **number_of_orders = 1**: Array contains only P_0 (current price). No scaling applied.
- **price_entry = 0**: All prices = current_price (degenerate case; invalid per FR-009).

### Validation (SDD Section 2.0)

Each price level P_n must:
- Be strictly less than P_{n-1} (monotonicity check).
- Have precision >= 8 decimal places (Decimal requirement).
- Round via ROUND_HALF_UP only; zero float rounding.

---

## Entity 3: Amount Sequence (Derived)

### Purpose
Array of quote currency amounts for each DCA order. Computed from amount_per_trade (C), amount_scale (s_a), multiplier (m), number_of_orders (N), and normalization factor (R). Ensures capital is distributed geometrically across all orders with sum = C * m exactly.

### Mathematical Definition (SDD Section 2.2, Equations E2.2a / E2.2b)

```
Normalization Factor:
  If s_a != 1.0:
    R = (s_a^N - 1) / (s_a - 1)
  If s_a = 1.0:
    R = N

Amount Formula:
  A_n = C * m * s_a^n / R

Sum Invariant:
  sum(A_0, A_1, ..., A_{N-1}) = C * m (exactly)
```

### Formula Expansion Example

Given: C=1000, s_a=2.0, m=1, N=3

```
R = (2.0^3 - 1) / (2.0 - 1)
  = (8 - 1) / 1
  = 7.00000000

A_0 = 1000 * 1 * 2.0^0 / 7
    = 1000 * 1 * 1 / 7
    = 1000 / 7
    = 142.85714286

A_1 = 1000 * 1 * 2.0^1 / 7
    = 1000 * 2 / 7
    = 2000 / 7
    = 285.71428571

A_2 = 1000 * 1 * 2.0^2 / 7
    = 1000 * 4 / 7
    = 4000 / 7
    = 571.42857143

Sum = 142.85714286 + 285.71428571 + 571.42857143
    = 999.99999999 ≈ 1000.00000000 (exact)
```

### Properties

1. **Geometric Distribution**: Amounts scale exponentially by s_a, ensuring later orders are larger (typically).
2. **Sum Invariant**: Total capital allocated = C * m exactly (FR-007). Zero rounding loss in distribution.
3. **Strictly Ordered**: A_0 < A_1 < A_2 < ... < A_{N-1} for s_a > 1.
4. **Fixed-Point Precision**: All values stored as Decimal; no float approximation.
5. **Cardinality**: Exactly N elements (number_of_orders from Config).

### Computation Algorithm (FR-006, FR-007)

```
Input: amount_per_trade (C), amount_scale (s_a), multiplier (m), number_of_orders (N)
Output: []*Decimal array of N amounts

amounts := make([]*Decimal, N)

// Compute normalization factor R
if s_a == Decimal(1):
    R = Decimal(N)
else:
    numerator = s_a^N - Decimal(1)
    denominator = s_a - Decimal(1)
    R = numerator / denominator

// Compute each amount
capital = C * m
for i := 0; i < N; i++:
    scale_power = s_a ^ i
    amounts[i] = capital * scale_power / R

return amounts
```

### Edge Cases

- **amount_scale = 1.0**: Geometric scale → uniform distribution. R = N exactly. Each A_n = C * m / N.
- **number_of_orders = 1**: Array contains only A_0 = C * m (entire capital in first order).
- **amount_per_trade ≤ 1.0** (Fractional Equity): C = (account_balance + accumulated_profit) * amount_per_trade. Applied at trade-entry time, not Config instantiation (ASS-003).
- **multiplier > 1** (Leverage): Total capital = C * m; each amount scales proportionally (FR-007).

### Sum Invariant Verification (SC-007)

After computing all amounts, verify:
```
sum(amounts) == (C * m).Truncate(8)  // 8 decimal places
```

If sum deviates, raise error "Amount sequence sum invariant violated" (critical failure).

### Validation (SDD Section 2.0)

Each amount level A_n must:
- Be positive (> 0).
- Have precision >= 8 decimal places (Decimal requirement).
- Sum exactly to C * m with zero rounding loss.
- Maintain s_a-relative scaling: A_{n+1} / A_n ≈ s_a (within Decimal precision).

---

## Entity 4: Sequence Output (Type Definition)

### Type Definition

Both Price and Amount sequences are exported as:
```
type Sequence struct {
    Values       []*Decimal   // Actual prices or amounts
    Count        int          // N (number_of_orders)
    Sum          *Decimal     // For Amount sequences only; nil for Price
    Min          *Decimal     // Minimum value
    Max          *Decimal     // Maximum value
    IsMonotonic  bool         // Monotonic increasing/decreasing property
}
```

Or simplified (if no wrapper needed):
```
type PriceSequence []*Decimal
type AmountSequence []*Decimal

// Constructor functions
func (c *Config) ComputePriceSequence(currentPrice *Decimal) (PriceSequence, error)
func (c *Config) ComputeAmountSequence() (AmountSequence, error)
```

### Serialization

Both sequences must be JSON serializable (Round-trip guarantee).

```json
{
  "prices": [
    "100.00000000",
    "98.00000000",
    "95.84400000",
    "93.52457520"
  ],
  "amounts": [
    "142.85714286",
    "285.71428571",
    "571.42857143"
  ],
  "sum": "1000.00000000"
}
```

---

## State Transitions & Invariants

### Immutability Contract

Once Config is constructed and validated:
1. All parameters remain read-only.
2. Sequences can be computed multiple times; results must be identical (cached or recomputed).
3. No mutations to Config state machine (single-state: Valid).

### Invariant Checks

1. **Price Monotonicity** (SC-006): P_0 > P_1 > ... > P_{N-1} for all valid parameters.
2. **Amount Sum** (SC-007): sum(A_n) = C * m exactly (no tolerance).
3. **Decimal Precision** (SC-002): Canonical test cases produce exact Decimal values to the last digit.

---

## Composition & Growth Path

### Current Feature Scope (001-core-domain-config)
Implements: Config entity, PriceSequence formula, AmountSequence formula.

### Future Extensions (Out-of-Scope for this feature)
- **Position State Machine** (Feature 002): Models open position state (filled amount, average entry price, liquidation level, PnL).
- **Execution Event Architecture** (Feature 003): Event sourcing for trade lifecycle (open, scale, close, liquidate).
- **Backtest Orchestration** (Feature 004): Grid search, parameter space iteration, result aggregation.

### Decoupling Strategy
Config is a pure data structure; orchestrator (TypeScript/Python) consumes Config and passes to trading engine. Core-engine never attempts to orchestrate or schedule; it receives fully-formed Config and executes deterministically.

---

## Traceability to SDD Master Report

| Entity | SDD Section | Equation | Reference |
|--------|-------------|----------|-----------|
| Config (13 params) | Section 4.1, Table 4.1 | N/A | Definition of all parameters |
| Config Defaults | Section 4.1, Table 4.1 | N/A | Canonical defaults |
| Price Sequence | Section 2.1 | E2.1: $P_n = P_{n-1}(1 - \delta/100 \cdot s_p^{n-1})$ | Full formula |
| Amount Sequence | Section 2.2 | E2.2a: $R = (s_a^N - 1)/(s_a - 1)$ <br> E2.2b: $A_n = C \cdot m \cdot s_a^n / R$ | Full formulas |
| Precision Constraints | Section 2.0 | Decimal ROUND_HALF_UP | Arithmetic rules |

---

## Phase 1 Data Model: ✅ COMPLETE

All entities defined with:
- Purpose and responsibilities
- Mathematical formulas (SDD-referenced)
- Validation rules and constraints
- Edge case handling
- Serialization requirements  
- Traceability to SDD master report
