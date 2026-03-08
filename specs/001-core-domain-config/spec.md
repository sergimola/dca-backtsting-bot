# Feature Specification: Core Domain Configuration Data Contract and Order Sequence Math

**Feature Branch**: `001-core-domain-config`  
**Created**: 2026-03-07  
**Status**: Draft  
**Input**: Feature extracted from SDD Master Report Section 2.0-2.2 and Section 4.1

**Constitution Gates (MANDATORY)**: 

This specification satisfies the project constitution through:
- **Green Light Protocol**: All canonical test data and mathematical proofs are binding specifications. Implementation MUST produce exact Decimal values or gates will not pass.
- **Fixed-point Arithmetic**: ALL calculations mandate `Decimal` type with `ROUND_HALF_UP` rounding. NO float precision permitted per Section 2.0 of the SDD.
- **BDD Acceptance Criteria**: Each requirement includes Given/When/Then scenarios covering the core domain invariants (price sequence monotonicity, amount sequence normalization, liquidation bounds).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Core Domain Engineer: Initialize Configuration Data Contract (Priority: P1)

A core domain engineer needs to construct and validate a configuration data structure that precisely defines all DCA trading parameters (price levels, order amounts, account parameters, and execution rules). This configuration acts as the single source of truth for trading engine initialization.

**Why this priority**: The configuration data contract is the foundational input to all trading engine calculations. No backtest can execute without a valid, well-formed config object. This is the MVP: a properly validated config + formulas.

**Independent Test**: Can be fully tested by constructing a Config instance with provided parameters, validating all default values are applied correctly, and verifying the config object can be serialized/deserialized without data loss.

**Acceptance Scenarios**:

1. **Given** all 13 required config parameters, **When** a Config object is instantiated, **Then** all parameters are stored correctly with exact types (str, float, int, bool as specified).
2. **Given** a Config object with default values missing, **When** instantiation occurs, **Then** each missing parameter is populated from the canonical defaults (trading_pair='LTC/USDT', price_entry=2.0, etc.).
3. **Given** a Config object with invalid parameter types (e.g., string for `multiplier`), **When** validation is attempted, **Then** a type validation error is raised with clear diagnostic message.
4. **Given** a Config object with edge-case numeric values (account_balance=0.01, amount_per_trade=0.5), **When** validation checks domain constraints, **Then** values pass (no arbitrary range constraints imposed).

---

### User Story 2 - Mathematical Verification Engineer: Compute Price Sequence $P_n$ (Priority: P1)

A verification engineer needs to compute the exact price sequence levels using the canonical recurrence relation. The engineer must be able to provide current_price, price_entry (delta), and price_scale parameters and receive precise Decimal-typed price levels for all N orders.

**Why this priority**: The price sequence formula ($P_n$) is the mathematical foundation of the entire DCA strategy. Every safety order trigger price depends on this formula. Precision loss here propagates through all position management logic.

**Independent Test**: Can be fully tested by computing the full price sequence for canonical test data (P_0=100, delta=2%, price_scale=1.1, N=3), comparing exact outputs to expected Decimal values, and verifying the recurrence relation holds for each level.

**Acceptance Scenarios**:

1. **Given** P_0=100, delta=2.0, price_scale=1.1, and N=3, **When** the price sequence is computed, **Then** P_1 = 98.00, P_2 = 96.0396, P_3 = 94.07950484 (exact Decimal values per test data).
2. **Given** any valid current_price>0 and price_entry>0, **When** P_1 is computed, **Then** P_1 < P_0 always holds (monotonic decreasing from market price).
3. **Given** price_scale > 1.0, **When** successive differences are compared (P_1 - P_0 vs P_2 - P_1), **Then** the scale factor multiplies the deviation correctly per formula.
4. **Given** P_n and the recurrence relation, **When** the next price P_{n+1} is computed, **Then** the result matches exactly P_n * (1 - delta/100 * s_p^n) with no precision loss.

---

### User Story 3 - Mathematical Verification Engineer: Compute Order Amount Sequence $A_n$ (Priority: P1)

A verification engineer needs to compute the order amount distribution across N orders using the geometric weighting scheme. The engineer must compute the normalization factor R, apply multiplier leverage, and produce exact Decimal quote currency amounts for each order.

**Why this priority**: The amount sequence formula ($A_n$) determines capital allocation across orders. Precision errors compound through all liquidation, fee, and PnL calculations. This formula must be exact.

**Independent Test**: Can be fully tested by computing the full amount sequence for canonical test data (C=1000, amount_scale=2.0, multiplier=1, N=3), computing normalization factor R exactly, and verifying all amounts sum exactly to C*m and each A_n matches expected value within Decimal precision.

**Acceptance Scenarios**:

1. **Given** amount_per_trade=1000, amount_scale=2.0, multiplier=1, and N=3, **When** the amount sequence is computed, **Then** R = (2^3 - 1)/(2 - 1) = 7.00, A_0 = 142.857142..., A_1 = 285.714285..., A_2 = 571.428571... (exact Decimal values per test data).
2. **Given** amount_per_trade, multiplier m, and N orders, **When** all amounts are summed, **Then** sum(A_0...A_{N-1}) = amount_per_trade * multiplier exactly (no rounding loss in distribution).
3. **Given** any valid amount_scale != 1.0, **When** normalization factor is computed, **Then** R = (s_a^N - 1)/(s_a - 1) using exact arithmetic.
4. **Given** multiplier > 1, **When** amounts are scaled by multiplier, **Then** each A_n is multiplied correctly and maintains Decimal precision.
5. **Given** amount_per_trade <= 1.0, **When** this is interpreted as a fraction of account equity, **Then** C = (account_balance + total_profit) * amount_per_trade is computed with correct priority (equity, not just balance).

---

### User Story 4 - Testing Engineer: Validate Configuration Against Domain Constraints (Priority: P2)

A testing engineer needs to verify that a configuration object respects all domain constraints (e.g., margin_type must be 'cross' or 'isolated', multiplier >= 1, number_of_orders >= 1). Invalid configs must be rejected with clear diagnostic messages before trading engine execution.

**Why this priority**: Domain constraint validation prevents invalid states from propagating into the trading engine. However, this is lower priority than the core formulas themselves, as incorrect configs can be caught at the boundary.

**Independent Test**: Can be fully tested by constructing Config instances with both valid and invalid constraint violations (invalid margin_type, multiplier < 1, number_of_orders = 0, etc.), checking that validation succeeds/fails appropriately, and verifying error messages are actionable.

**Acceptance Scenarios**:

1. **Given** margin_type='cross', **When** validation is performed, **Then** validation passes. Equivalently for margin_type='isolated'.
2. **Given** margin_type='leverage', **When** validation is performed, **Then** validation fails with error message "margin_type must be 'cross' or 'isolated'".
3. **Given** multiplier=0, **When** validation is performed, **Then** validation fails (multiplier must be >= 1 for spot, possibly higher for margin).
4. **Given** number_of_orders=0, **When** validation is performed, **Then** validation fails with error message referencing minimum required orders.
5. **Given** all parameters with realistic cryptocurrency trading values (trading_pair='BTC/USDT', account_balance=5000, amount_per_trade=100), **When** validation is performed, **Then** validation passes.

---

### Canonical Test Data & Mathematical Proofs *(MANDATORY FOR CORE DOMAIN)*

The following test data derives from canonical inputs and MUST produce these exact Decimal outputs. Implementation receives ZERO tolerance for precision loss.

**Test Case 1: Price Sequence Calculation**

| Input State | Parameter | Value | Expected Output |
|-------------|-----------|-------|------------------|
| Initial | current_price (P_0) | 100 | - |
| Initial | price_entry (δ) | 2.0 | - |
| Initial | price_scale (s_p) | 1.1 | - |
| Initial | number_of_orders (N) | 3 | - |
| - | Compute P_0 | - | `100.00000000` |
| - | Compute P_1 = P_0(1 - δ/100) | - | `98.00000000` |
| - | Compute P_2 = P_1(1 - δ/100 * s_p^1) | - | `95.84400000` |
| - | Compute P_3 = P_2(1 - δ/100 * s_p^2) | - | `93.52457520` |

**Verification**: Each price must be strictly less than the previous (P_0 > P_1 > P_2 > P_3). All values must be computed with Decimal ROUND_HALF_UP.

---

**Test Case 2: Amount Sequence Calculation**

| Input State | Parameter | Value | Expected Output |
|-------------|-----------|-------|------------------|
| Initial | amount_per_trade (C) | 1000 | - |
| Initial | amount_scale (s_a) | 2.0 | - |
| Initial | multiplier (m) | 1 | - |
| Initial | number_of_orders (N) | 3 | - |
| - | Compute R = (s_a^N - 1)/(s_a - 1) | - | `7.00000000` |
| - | Compute A_0 = C * m * s_a^0 / R | - | `142.85714286` |
| - | Compute A_1 = C * m * s_a^1 / R | - | `285.71428571` |
| - | Compute A_2 = C * m * s_a^2 / R | - | `571.42857143` |
| - | Sum all A_n | - | `1000.00000000` |

**Verification**: Sum of all A_n must equal C * m exactly (1000.00 in this case). Each A_n value must match expected Decimal exactly. Later orders must be larger (A_0 < A_1 < A_2) due to geometric scaling.

---

**Test Case 3: Config Object Instantiation with Defaults**

| Input State | Action | Expected Output |
|-------------|--------|------------------|
| Minimal config (trading_pair only) | Instantiate Config | - |
| - | Retrieve default start_date | `'2024-01-02 14:00:00'` |
| - | Retrieve default price_entry | `2.0` |
| - | Retrieve default amount_scale | `2.0` |
| - | Retrieve default number_of_orders | `10` |
| - | Retrieve default amount_per_trade | `17500` |
| - | Retrieve default account_balance | `1000` |
| - | Retrieve default multiplier | `1` |
| - | Retrieve default take_profit_distance_percent | `0.5` |
| - | Retrieve default exit_on_last_order | `False` |

**Verification**: All 13 parameters are present and defaults are applied exactly as specified in the SDD Table 4.1.

---

### Edge Cases

- **E1**: What happens when amount_per_trade = 0.5 (interpreted as 50% of account equity)? System must compute C = (account_balance + accumulated_profit) * 0.5 at trade entry, not at config instantiation.
- **E2**: How does system handle price_scale = 1.0 (no geometric deviation)? Formula becomes P_n = P_{n-1}(1 - δ/100), resulting in uniform level spacing. Normalization factor R for amount_scale=1.0 should use closed form or handle division carefully.
- **E3**: What happens when number_of_orders = 1? Only P_0 and A_0 exist. No safety orders. System must not assume N >= 2.
- **E4**: Can margin_type be anything other than 'cross' or 'isolated'? No. Invalid values must be rejected at validation time.
- **E5**: What if account_balance is extremely small (0.01 quote currency)? Config should accept non-negative values. Trading feasibility is a separate concern (position sizing, minimum order constraints).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST implement the Config data structure with exactly 13 parameters as defined in Table 4.1 of the SDD, each with the correct type annotation (str, float, int, bool).

- **FR-002**: System MUST apply canonical default values to Config parameters when not explicitly provided:
  - `trading_pair` → 'LTC/USDT'
  - `start_date` → '2024-01-02 14:00:00'
  - `end_date` → '2024-01-05 14:00:00'
  - `price_entry` → 2.0
  - `price_scale` → 1.1
  - `amount_scale` → 2.0
  - `number_of_orders` → 10
  - `amount_per_trade` → 17500
  - `margin_type` → 'cross'
  - `multiplier` → 1
  - `take_profit_distance_percent` → 0.5
  - `account_balance` → 1000
  - `monthly_addition` → 0.0
  - `exit_on_last_order` → False

- **FR-003**: System MUST validate Config parameter types and reject instantiation with clear type mismatch errors (e.g., "Parameters 'trading_pair' and type-specific date strings must be str, not int").

- **FR-004**: System MUST implement the Price Sequence formula $P_n$ exactly as specified:
  - $P_0 = \text{current\_price}$
  - $P_1 = P_0(1 - \delta/100)$ where $\delta = \text{price\_entry}$
  - For $n \geq 2$: $P_n = P_{n-1}(1 - \delta/100 \cdot s_p^{(n-1)})$

- **FR-005**: System MUST compute all price levels $P_0, P_1, \ldots, P_{N-1}$ and store them as an array of Decimal values with no precision loss.

- **FR-006**: System MUST implement the Amount Sequence calculation:
  - Normalization factor: $R = (s_a^N - 1)/(s_a - 1)$ for $s_a \neq 1$
  - Amount formula: $A_n = C \cdot m \cdot s_a^n / R$

- **FR-007**: System MUST compute all order amounts $A_0, A_1, \ldots, A_{N-1}$ and store them as an array of Decimal values, ensuring $\sum A_n = C \cdot m$ exactly.

- **FR-008**: System MUST handle dynamic `amount_per_trade`: When `amount_per_trade <= 1.0`, interpret as a fraction of total equity: $C = (\text{account\_balance} + \text{total\_profit}) \times \text{amount\_per\_trade}$.

- **FR-009**: System MUST validate that `margin_type` is one of: `'cross'` or `'isolated'`. Invalid values must be rejected with a clear error message.

- **FR-010**: System MUST validate that `multiplier` >= 1. Spot trading requires `multiplier = 1`. Margin strategies require `multiplier > 1`, bounded by exchange limits).

- **FR-011**: System MUST validate that `number_of_orders` >= 1. No valid DCA strategy exists with zero orders.

- **FR-012**: System MUST validate that all numeric parameters (prices, amounts, balances) are non-negative. Negative values must be rejected.

- **FR-013**: System MUST use Python's `Decimal` type with `ROUND_HALF_UP` for ALL monetary and quantitative calculations. NO float precision permitted at any stage.

- **FR-014**: System MUST be serializable and deserializable without data loss (JSON, YAML, or language-native serialization formats). Config must round-trip exactly.

- **FR-015**: System MUST document all formulas, parameter meanings, and default values inline or via external specification that matches exactly with the SDD Master Report sections 2.1, 2.2, and 4.1.

### Key Entities *(include if feature involves data)*

- **Config (Primary Data Structure)**:
  - **Purpose**: Encapsulates all DCA trading strategy parameters. Single source of truth for backtest and live trading initialization.
  - **Attributes**:
    - `trading_pair: str` — Binance trading pair (e.g., 'BTC/USDT', 'LTC/USDT'). Default: 'LTC/USDT'.
    - `start_date: str` — ISO 8601 format backtest start. Default: '2024-01-02 14:00:00'.
    - `end_date: str` — ISO 8601 format backtest end. Default: '2024-01-05 14:00:00'.
    - `price_entry: float` — Percentage below current price for first safety order (δ). Default: 2.0.
    - `price_scale: float` — Geometric multiplier for price deviation scale (s_p). Default: 1.1.
    - `amount_scale: float` — Geometric multiplier for order sizing (s_a). Default: 2.0.
    - `number_of_orders: int` — Total DCA orders including initial market buy (N). Default: 10.
    - `amount_per_trade: float` — Capital per trade cycle (C). If ≤ 1.0, treated as fraction of equity. Default: 17500.
    - `margin_type: str` — Margin mode ('cross' or 'isolated'). Default: 'cross'.
    - `multiplier: int` — Leverage multiplier (m). Default: 1 (spot).
    - `take_profit_distance_percent: float` — TP distance above average entry (d_tp %). Default: 0.5.
    - `account_balance: float` — Starting equity. Default: 1000.
    - `monthly_addition: float` — Monthly capital injection. Default: 0.0.
    - `exit_on_last_order: bool` — Force simulation end when last safety order fills. Default: False.
  - **Relationships**: Config is consumed by the trading engine initialization and referenced throughout execution (price grid, amount grid, position management).

- **Price Sequence (Derived Entity)**:
  - **Purpose**: Array of trigger prices for safety orders, computed from price_entry, price_scale, and current market price.
  - **Structure**: Array of Decimal values $[P_0, P_1, \ldots, P_{N-1}]$ where each $P_n$ is strictly less than $P_{n-1}$.
  - **Cardinality**: N elements (number_of_orders).

- **Amount Sequence (Derived Entity)**:
  - **Purpose**: Array of quote currency amounts for each DCA order, computed from amount_per_trade, amount_scale, multiplier, and normalization.
  - **Structure**: Array of Decimal values $[A_0, A_1, \ldots, A_{N-1}]$ where sum equals $C \cdot m$ exactly.
  - **Cardinality**: N elements (number_of_orders).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Config object instantiation completes in under 1 millisecond for all valid parameter combinations (latency / performance criterion).

- **SC-002**: 100% of canonical test data cases (Test Cases 1, 2, 3) produce exact Decimal output values matching expected values to the last digit with ROUND_HALF_UP semantics.

- **SC-003**: All 15 functional requirements (FR-001 through FR-015) have automated test coverage with passing test cases. Zero allowed failing or skipped tests before merge.

- **SC-004**: Config parameter validation rejects 100% of invalid inputs (wrong types, invalid enum values, out-of-bound constraints) with clear, actionable error messages within 1 millisecond.

- **SC-005**: Configuration data can be serialized to and deserialized from a standard format (JSON, YAML) with zero loss of Decimal precision when re-instantiated.

- **SC-006**: Price sequence computation produces mathematically monotonic decreasing array ($P_0 > P_1 > \cdots > P_{N-1}$) for all valid price_entry > 0 and price_scale > 0 parameter combinations.

- **SC-007**: Amount sequence sum ($\sum A_n$) equals intended capital ($C \cdot m$) to the last Decimal place for all valid amount_scale > 0 combinations. Zero tolerance for rounding loss.

- **SC-008**: Core domain specification and formulas are documented and traceable to SDD Master Report Section 2.0-2.2 and Section 4.1 with exact section references and equation numbers.

- **SC-009**: All edge cases (E1–E5) are explicitly handled and documented in the implementation with corresponding test cases demonstrating correct behavior.

- **SC-010**: Implementation passes project constitution gates:
  - Green Light Protocol: all tests pass before merge.
  - Fixed-point Arithmetic: ZERO float precision violations; all math via Decimal ROUND_HALF_UP.
  - BDD Acceptance: All acceptance scenarios from user stories are implemented as executable test cases.

---

## Assumptions

- **ASS-001**: ISO 8601 string parsing (e.g., '2024-01-02 14:00:00') is handled by standard library or external dependency and is treated as out-of-scope for this spec. Implementation must ensure timestamp values are stored and retrieved correctly.

- **ASS-002**: Decimal precision is assumed to be at least 8 decimal places for all calculations. Exchange lot-size rounding is applied downstream during position execution, not during config initialization.

- **ASS-003**: `amount_per_trade` fraction interpretation (when ≤ 1.0) is only triggered at trade entry time, not during Config object instantiation. The Config stores the raw value; interpretation is a runtime concern.

- **ASS-004**: No live API calls are made during Config initialization. All parameters are static values provided by the user or loaded from a file. Binance pair validation (existence, minimum order size, etc.) is out-of-scope for the Config object.

- **ASS-005**: The Config data structure is designed for backtest and simulation. Live trading deployment may require additional parameters (API keys, risk limits, execution strategies), but those are not part of this core domain spec.

---

## Out of Scope

- Implementation language (Go, Rust, Python, etc.) — This spec is technology-agnostic and defines only the data contract and formulas.

- Exchange-specific constraints (minimum order size, lot size precision, trading hours) — These are applied during execution, not in the Config structure.

- Position management state machine (covered in future Feature Spec: Core Domain Position State Machine).

- Event publishing, logging, or telemetry infrastructure (covered in future Feature Spec: Execution Event Architecture).

- Backtesting orchestration or results aggregation (covered in future Feature Spec: Backtest Orchestration).

- Live trading deployment or risk management overrides (covered in future features).

---

## References

1. **SDD Master Report — Section 2.0**: Precision and Lot Size Constraints
2. **SDD Master Report — Section 2.1**: Order Sequence Formula (Price Levels $P_n$)
3. **SDD Master Report — Section 2.2**: Order Sequence Formula (Amounts $A_n$)
4. **SDD Master Report — Section 4.1**: The Config Object Table
5. **Legacy Implementation**: `src/trading_bot.py`, `src/calculate.py` (canonical reference for exact calculation logic)
