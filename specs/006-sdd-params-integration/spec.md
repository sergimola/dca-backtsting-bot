# Feature Specification: SDD 4.1 Parameters Integration — UI & Engine Config Refactor

**Feature Branch**: `006-sdd-params-integration`  
**Created**: 2026-03-12  
**Status**: Draft  
**Input**: User description: "Frontend Refactor: UI must collect all SDD 4.1 parameters: trading_pair, start_date, end_date, price_entry, price_scale, amount_scale, number_of_orders, amount_per_trade, margin_type, multiplier, take_profit_distance_percent, account_balance, and exit_on_last_order. Remove manual Amounts and Sequences list management. Go Engine Interface (Crucial): Update the cmd/engine/main.go and the Node.js BacktestService to use a new JSON schema that includes these multipliers. Ensure the Go main.go correctly maps these JSON fields to the orchestrator.Config struct so ComputePriceSequence can use them. Data Management: The UI now provides trading_pair and dates. The API should eventually use these for the downloader, but for this feature, ensure the Market Data CSV Path is still available or derived."

**Constitution Gates (MANDATORY)**:
- **Green Light Protocol**: All existing orchestrator tests must continue to pass after the engine mapping changes. New acceptance scenarios in this spec must be covered by integration tests before merging.
- **Fixed-point arithmetic**: No new float arithmetic may be introduced into the Go engine or Node.js service layer. All monetary values (account_balance, amount_per_trade) must be passed as strings or integers at system boundaries, with fixed-point conversion handled inside the core engine.
- **BDD acceptance criteria**: Each user story below provides Given/When/Then scenarios that must be automated as integration tests covering the full request-response path (UI form → API → Go engine) before Phase 0 approval.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configuring a Backtest via Structured Parameters (Priority: P1)

A trader opens the backtesting UI and fills in all DCA strategy parameters — trading pair, date range, price and amount geometry, leverage, take-profit distance, and account size — using clearly labelled individual fields. They submit the form and receive a full backtest result without ever editing a raw list of prices or amounts.

**Why this priority**: This is the core value proposition of the entire UI. The existing approach of manually managing price/amount sequence lists is error-prone and inaccessible to non-technical users. Replacing it with parameterised inputs derived from SDD Section 4.1 aligns the UI with the canonical engine contract and eliminates a class of user input errors.

**Independent Test**: Can be fully tested by submitting a form with all 13 SDD 4.1 parameters via the UI and verifying the returned backtest result contains trade history, profit summary, and no validation errors. Delivers the complete end-to-end workflow as a working MVP.

**Acceptance Scenarios**:

1. **Given** the backtest form is open, **When** the trader fills in all 13 fields (trading_pair, start_date, end_date, price_entry, price_scale, amount_scale, number_of_orders, amount_per_trade, margin_type, multiplier, take_profit_distance_percent, account_balance, exit_on_last_order) and submits, **Then** a backtest result is returned and displayed with no error messages.
2. **Given** the form is submitted with `number_of_orders = 10`, `price_entry = 2.0`, and `price_scale = 1.1`, **Then** the engine internally computes 10 price levels using the SDD 2.1 recurrence — the user does not need to provide them.
3. **Given** the form is submitted with `amount_per_trade = 0.5` (fraction of equity) and `account_balance = 2000`, **Then** the engine treats total capital as 1000 USDT per the SDD 2.2 dynamic positioning rule, without the user performing this calculation manually.
4. **Given** the form is open, **When** the trader searches for "BTC", **Then** the trading_pair field provides autocomplete suggestions containing valid Binance pairs.
5. **Given** a prior run's parameters are stored, **When** the trader revisits the form, **Then** the fields are pre-populated with the last used values.

---

### User Story 2 - Leverage and Margin Configuration (Priority: P2)

A trader configures a margin backtest by setting `multiplier` to a value greater than 1 and selecting `margin_type = cross`. They run the backtest and observe that the simulated profit and liquidation behaviour reflects the leverage applied, including the asymmetric fee model described in SDD Section 2.6.

**Why this priority**: Leverage is a first-class SDD 4.1 parameter that directly changes position sizing ($A_n = C \cdot m \cdot s_a^n / R$) and liquidation risk. Without this field, users cannot simulate margin strategies, which is a primary use case for the engine.

**Independent Test**: Can be tested independently by submitting a configuration with `multiplier = 3`, `margin_type = cross`, and verifying that the returned per-order amounts are 3× larger than an equivalent spot run, and that a liquidation event appears in the result when price falls to the expected liquidation threshold.

**Acceptance Scenarios**:

1. **Given** `multiplier = 1` (spot), **When** a backtest runs, **Then** the liquidation price in the result is 0 (no liquidation risk), consistent with SDD Section 2.5.
2. **Given** `multiplier = 3` and `margin_type = cross`, **When** a backtest runs, **Then** the per-order allocated amounts are 3× the spot equivalent and a non-zero liquidation price is reported.
3. **Given** `margin_type = cross` is selected, **When** the result is returned, **Then** buy fees are applied at the margin limit rate (0.02%) and sell fees at the market rate (0.06%), per SDD Section 2.6.
4. **Given** the UI displays the `multiplier` field, **When** the user enters a value of 0 or a negative number, **Then** the form shows a validation error before submission and does not call the API.

---

### User Story 3 - Early Exit on Last Safety Order (Priority: P3)

A trader enables the `exit_on_last_order` option to simulate a risk-bounded strategy: the backtest stops as soon as the final safety order fills, rather than running to the end date. The result shows the partial run statistics up to that stop point.

**Why this priority**: `exit_on_last_order` is a SDD 3.1 execution control flag that changes simulation semantics. It is necessary for studying drawdown-bounded strategies and should be controllable from the UI rather than hardcoded.

**Independent Test**: Can be tested by submitting a backtest where the market drop triggers all orders within the date range, with `exit_on_last_order = true`, and confirming the result's end timestamp is earlier than `end_date` and the last event is a final order fill.

**Acceptance Scenarios**:

1. **Given** `exit_on_last_order = true` and the last safety order fills before `end_date`, **When** the backtest runs, **Then** the simulation ends at the candle where the last order filled and the result includes no further trade events.
2. **Given** `exit_on_last_order = false`, **When** all orders fill before `end_date`, **Then** the simulation continues processing candles until `end_date`, allowing take-profit to trigger if reached.
3. **Given** `exit_on_last_order = true` but the market does not fall far enough to trigger the last order, **When** the backtest runs to `end_date`, **Then** the simulation ends normally at `end_date` without early termination.

---

### User Story 4 - Market Data Still Resolved After Form Change (Priority: P4)

After the trading_pair and date fields are added to the form, the system continues to locate or derive the correct market data file for the backtest run. The trader does not need to separately specify a CSV file path when the trading_pair and dates are already provided.

**Why this priority**: The form change introduces trading_pair and start_date/end_date as explicit inputs. If the market data lookup is not updated to use these values, existing backtests will break silently or require users to manually keep a file path in sync with their form inputs.

**Independent Test**: Can be tested by submitting a run for a trading pair and date range for which cached market data exists, confirming the engine receives a valid CSV path derived from those inputs and returns results, without the user entering any file path.

**Acceptance Scenarios**:

1. **Given** market data for `LTC/USDT` from 2024-01-02 to 2024-01-05 exists in the server's data store, **When** a backtest is submitted with those exact trading_pair and date values, **Then** the engine runs successfully using that data without the user specifying a file path.
2. **Given** the required market data is not available, **When** a backtest is submitted, **Then** the API returns a clear error describing the missing data range and trading pair, not a generic engine failure.
3. **Given** the user previously relied on a manual CSV path field, **When** the updated form is presented, **Then** the form no longer shows a separate CSV path input — the path is derived internally.

---

### Canonical Test Data & Mathematical Proofs *(MANDATORY FOR CORE DOMAIN)*

These cases cover the JSON-to-Config mapping path and must be validated as integration tests at the engine boundary (Go stdin/stdout contract) before merge.

| Input State | Action | Expected Exact Value (Decimal) | SDD Reference |
|-------------|--------|--------------------------------|---------------|
| `price_entry=2.0, price_scale=1.1, P0=100, N=3` | Compute P1 | `98.00000000` | SDD §2.1: P1 = P0×(1−δ/100) |
| `price_entry=2.0, price_scale=1.1, P0=100, N=3` | Compute P2 | `95.84400000` | SDD §2.1: P2 = P1×(1−δ/100×sp^1) |
| `amount_per_trade=1000, amount_scale=2.0, multiplier=3, N=3` | Compute A0 | `428.57142857` | SDD §2.2: A0 = C×m×sa^0/R, R=7 |
| `amount_per_trade=1000, amount_scale=2.0, multiplier=3, N=3` | Compute A1 | `857.14285714` | SDD §2.2: A1 = C×m×sa^1/R |
| `multiplier=1, account_balance=1000, Q_total=10, avg_entry=95` | Compute P_liq | `0.00000000` (clamped) | SDD §2.5: spot clamp |
| `multiplier=3, account_balance=1000, Q_total=30, avg_entry=95` | Compute P_liq | Positive non-zero value | SDD §2.5: margin liquidation |

**Rationale**: The Go engine must produce these exact values when the JSON input fields are mapped to `orchestrator.Config`. Any deviation indicates the JSON-to-struct mapping silently dropped a field (e.g., `multiplier` defaulting to 1 due to a missing binding).

### Edge Cases

- **`amount_per_trade ≤ 1`**: The system must interpret values ≤ 1 as a fraction of `account_balance`, not as an absolute amount. A form submission of `amount_per_trade = 0.5` with `account_balance = 2000` must result in effective capital of `1000 USDT`.
- **`multiplier = 1` with `margin_type = cross`**: Spot accounts have no liquidation risk. The engine must not produce a positive liquidation price under these conditions.
- **Missing market data**: If the server cannot resolve a CSV file for the given trading pair and date range, the API must return a structured error before invoking the engine — not allow the engine to crash on a missing file.
- **`exit_on_last_order = true` with only one order**: If `number_of_orders = 1`, the simulation should stop after the initial market buy on the first candle.
- **`price_scale = 1.0`**: All price deviations are equal (no geometric growth). The engine must handle this without division errors or numeric instability.
- **`amount_scale = 1.0`**: Uniform order sizing — all SDD §2.2 normalization must use the linear fallback ($R = N$) rather than the geometric formula to avoid a degenerate denominator.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The backtesting form MUST provide individual input controls for all 13 SDD 4.1 parameters: `trading_pair`, `start_date`, `end_date`, `price_entry`, `price_scale`, `amount_scale`, `number_of_orders`, `amount_per_trade`, `margin_type`, `multiplier`, `take_profit_distance_percent`, `account_balance`, and `exit_on_last_order`.
- **FR-002**: The backtesting form MUST NOT present manual list inputs for price sequences or amount sequences. These values are computed by the engine from the geometric parameters.
- **FR-003**: The `margin_type` field MUST be a constrained selector offering exactly two options: `cross` and `isolated`.
- **FR-004**: The `exit_on_last_order` field MUST be a boolean toggle (checkbox or switch).
- **FR-005**: The form MUST perform client-side validation before submission: `number_of_orders` must be a positive integer; `multiplier` must be a positive integer ≥ 1; `price_entry`, `price_scale`, `amount_scale`, and `take_profit_distance_percent` must be positive decimal numbers; `account_balance` and `amount_per_trade` must be positive decimal numbers; `start_date` must precede `end_date`.
- **FR-006**: The API service MUST construct the request payload to the Go engine using all 13 SDD 4.1 parameters as a single JSON object, mapping each UI field to its corresponding engine field name exactly as defined in SDD §4.1.
- **FR-007**: The Go engine entry point MUST read all 13 SDD 4.1 fields from the JSON input and bind them to the `orchestrator.Config` struct without silently dropping any field (particularly `multiplier`, `price_scale`, `amount_scale`, `margin_type`, and `exit_on_last_order`).
- **FR-008**: The Go engine MUST pass `multiplier`, `price_scale`, and `amount_scale` through to `ComputePriceSequence` and `ComputeAmountSequence` so that the geometric order grid reflects the user's inputs.
- **FR-009**: The API service MUST derive the market data file path from `trading_pair` and the date range when no explicit path is provided. The derived path must follow the established file naming convention used by the existing data store.
- **FR-010**: If the derived market data file does not exist, the API MUST return a structured error response with the trading pair and date range identified, before invoking the Go engine binary.
- **FR-011**: The system MUST preserve backward compatibility: any existing saved or persisted backtest configurations must continue to be readable and runnable after this change.

### Key Entities

- **BacktestConfig**: The complete parameter set for one backtest run. Contains all 13 SDD 4.1 fields. This is the single source of truth passed between the UI, API, and engine. No partial configs are permitted — all 13 fields must be present and valid.
- **MarketDataRef**: A reference to a historical OHLCV dataset, derived from `trading_pair` + `start_date` + `end_date`. Resolved server-side to a file path before engine invocation.
- **BacktestResult**: The output returned to the UI after a run. Contains trade history, per-trade profit, total profit, number of fills, drawdown, and the simulation's actual end timestamp.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user with knowledge of their DCA parameters can configure and submit a complete backtest in under 2 minutes using only the 13 structured form fields, with no need to manually compute or enter price/amount lists.
- **SC-002**: Every SDD 4.1 parameter submitted via the form is demonstrably used in the backtest computation — verified by showing that changing each parameter independently produces a different numerical result, with zero silent omissions.
- **SC-003**: Switching `multiplier` from 1 to 3 in the form and re-running produces a result where per-order capital allocations are exactly 3× larger, confirming the engine correctly applies the multiplier in the amount formula.
- **SC-004**: Submitting a backtest for a valid trading pair and date range with existing market data succeeds without the user providing a CSV path, in 100% of test cases across all currently cached datasets.
- **SC-005**: All existing automated integration tests continue to pass after this feature is delivered, with zero regressions to previously working backtest scenarios.
- **SC-006**: A backtest submitted with `exit_on_last_order = true` returns a result whose end timestamp is earlier than `end_date` when the last order fills before the date range closes.

## Assumptions

- The market data store contains pre-downloaded OHLCV CSV files whose names encode the trading pair and date range in a deterministic, parseable format. The derivation logic in the API will follow this existing convention.
- `isolated` margin type is accepted as a valid `margin_type` value by the engine even if the current canonical bot only fully models `cross` margin. The engine may treat `isolated` as functionally equivalent to `cross` until isolated margin liquidation logic is specified separately.
- The Go engine binary interface (stdin JSON → stdout JSON) is the established integration contract and is not changed by this feature — only the JSON schema is expanded to include all 13 SDD 4.1 fields.
- Autocomplete for `trading_pair` uses a static list of supported Binance pairs; live exchange API lookup is out of scope for this feature.
- `monthly_addition` (SDD §4.1) is explicitly out of scope for this feature's UI. It defaults to `0.0` in the engine and is not surfaced in the form.
