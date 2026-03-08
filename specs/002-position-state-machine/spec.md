# Feature Specification: Core Domain Position State Machine

**Feature Branch**: `002-position-state-machine`  
**Created**: March 8, 2026  
**Status**: Draft  
**Input**: User description: "Core Domain Position State Machine. This must enforce the single-position invariant and the Pessimistic Execution 'Minute Loop' defined in Section 3.1 and 3.2 of the SDD Master Report."

## Overview

This specification defines the Position State Machine (PSM) that governs the lifecycle of a single active trading position during backtesting. The PSM enforces the **single-position-at-a-time invariant** and implements the **Pessimistic Execution "Minute Loop" Protocol** as defined in the SDD Master Report (Sections 3.1–3.2).

The state machine processes exactly one 1-minute OHLCV candle per iteration, applying strict checks in pessimistic order: Buy Orders → Liquidation Check → Take Profit → Position Re-entry or Closure.

## Constitution Gates (MANDATORY)

This feature conforms to the project constitution as follows:

- **Green Light Protocol**: All state transitions, order execution logic, and liquidation checks MUST have automated unit and integration tests that verify parity with the canonical Python bot (src/trading_bot.py). Tests pass before merge.
- **Fixed-point Arithmetic**: All price computations, position averaging, and profit calculations MUST use Python `Decimal` type with `ROUND_HALF_UP` precision. No floats in monetary calculations.
- **BDD Acceptance Criteria**: Each state transition accepts Given/When/Then scenarios that specify invariants (e.g., "Given a position is open When liquidation price is breached Then position is closed with full loss").

## User Scenarios & Testing

### User Story 1 - Process Single-Minute Candle Through Position State Machine (Priority: P1)

**Narrative**: A backtesting engine operator runs a simulation that iterates through historical market data. For each 1-minute OHLCV candle, the state machine must process the candle in strict order: check buy orders, check liquidation, check take-profit. At any point, a transition to a new state (opening position, filling safety orders, triggering liquidation, or closing via take-profit) must be dispatched as an event for audit and decision-making.

**Why this priority**: This is the core execution loop. Without correct minute-by-minute state processing, the entire backtesting engine produces meaningless results. This story directly tests the Minute Loop Protocol (SDD 3.1).

**Independent Test**: Can be fully tested by initializing an idle position, feeding it a sequence of synthetic candles (with predetermined OHLCV values), and verifying that state transitions occur in the correct pessimistic order. Delivers accurate position lifecycle simulation.

**Acceptance Scenarios**:

1. **Given** a position is `POSITION_IDLE` (no open position), **When** the first candle is processed, **Then** a new position is created and `POSITION_OPENING` state is entered; `TradeOpenedEvent` is dispatched with the initial market buy order at the first candle's close price.

2. **Given** a position is `POSITION_OPENING`, **When** the market buy order is confirmed AND `has_more_orders` is true, **Then** state transitions to `SAFETY_ORDER_WAIT` and the system is ready to accept safety order triggers.

3. **Given** a position is `SAFETY_ORDER_WAIT` **When** a candle's `low` price falls at or below the next safety order trigger price, **Then** the safety order is filled at the pre-calculated limit price ($P_n$); `BuyOrderExecutedEvent` is dispatched; the position's average entry price ($\bar{P}$) and take-profit target ($P_{tp}$) are recalculated; and liquidation price ($P_{liq}$) is updated.

4. **Given** a position has multiple safety orders filled, **When** the candle's `high` price reaches or exceeds the take-profit target ($P_{tp}$), **Then** the position is closed at $P_{tp}$; profit/loss reflects all fills at their respective prices minus all accumulated fees; `TradeClosedEvent` and `SellOrderExecutedEvent` are dispatched; and the position re-enters `POSITION_IDLE` to allow a new position on the next candle.

5. **Given** a position is open with calculated liquidation price $P_{liq}$, **When** the candle's `low` price falls at or below $P_{liq}$, **Then** the position is immediately closed with loss equal to the entire account balance (`profit = -account_balance`); `TradeClosedEvent` is dispatched; the simulation halts (BREAK).

---

### User Story 2 - Enforce Pessimistic Execution Order (Priority: P1)

**Narrative**: Backtesting results are only meaningful if order execution strictly follows a pessimistic (worst-case) sequence: buy triggers checked before liquidation checks, liquidation checked before take-profit. This ensures the simulation never "cheats" by claiming a take-profit fill on the same candle where liquidation would have triggered first.

**Why this priority**: Maintaining pessimistic order is a core invariant. Violating it breaks the canonical parity with the legacy bot and produces incorrect backtest results. This story enforces SDD 3.1 step-by-step ordering.

**Independent Test**: Can be fully tested with a single candle where both a buy order trigger and a liquidation trigger occur (e.g., `open` gaps down past both). System must fill the buy order first (updating average entry and liquidation price), then check liquidation against the *updated* price, not the stale pre-buy price. If liquidation still holds, position closes immediately. Result proves order correctness.

**Acceptance Scenarios**:

1. **Given** a candle where `low` is below both a safety order trigger AND below the current liquidation price, **When** the candle is processed, **Then** the safety order is filled first; liquidation price is recalculated; liquidation check is re-evaluated against the new price; only if liquidation still triggers is the position closed.

2. **Given** a position is open with `has_more_orders = true`, **When** a candle contains no buy triggers and no liquidation trigger, AND `high` ≥ `take_profit_price`, **Then** the take-profit is NOT filled—the candle processing stops after the fruitless buy/liquidation checks.

---

### User Story 3 - Handle Gap-Down Paradox (Pessimistic Gap Pricing) (Priority: P1)

**Narrative**: When a candle opens below (gaps down from previous close), jumping past multiple safety order limit prices, the system must NOT fill at the gap price. Instead, it must fill at the *pre-calculated limit prices* in sequence, even though the market had a more favorable gap-down. This "Gap-Down Paradox Rule" ensures the most pessimistic backtest (SDD 3.2).

**Why this priority**: Correctly handling gap-downs is critical for accurate pessimistic simulation. Incorrect handling (e.g., filling at market gap price) would produce over-optimistic backtests that don't reflect real market execution. This is an invariant that differentiates the canonical bot from naive implementations.

**Independent Test**: Can be fully tested with a candle where `open` < multiple `P_n` values. Verify that system fills each order sequentially at its respective `P_n`, not at `open`. Compare against legacy bot to confirm parity.

**Acceptance Scenarios**:

1. **Given** a candle where the `open` price is below `P[2]` and `P[3]` (multiple safety orders gap down), **When** processed, **Then** the system fills `P[2]` at exactly its pre-calculated price, then fills `P[3]` at exactly its pre-calculated price—NOT at the `open` price or any intermediate gap price.

---

### User Story 4 - Re-entry After Take-Profit (Position Restart) (Priority: P2)

**Narrative**: When a position closes due to take-profit fill, a new position must be allowed to open on the *next* candle (not the same candle). The price grid for the new position is recalculated using the sell price with a small upward offset ($P_0^{(new)} = P_{sell} \times 1.0005$). This ensures smooth multi-position backtests with no artificial gaps or missed re-entry opportunities.

**Why this priority**: Re-entry correctly after take-profit is necessary for realistic, multi-cycle backtests. Without it, single-position simulation only is possible. This story enables full-cycle testing.

**Independent Test**: Can be fully tested by running a backtest with 2+ takes profit. After each take-profit, verify that the new position opens on the next candle with a fresh grid, and profit from initial and subsequent positions both contribute to total backtest profit. Verify no position overlap (never 2 concurrent positions).

**Acceptance Scenarios**:

1. **Given** a position closes via take-profit on candle $t$, **When** candle $t+1$ is processed, **Then** a new position is opened (if more candles remain) at the re-entry price ($P_{sell} \times 1.0005$) and new orders are available for filling.

2. **Given** a position closes via take-profit with calculated profit $P_1$, **When** a subsequent position also closes with profit $P_2$, **Then** total backtest profit is $P_1 + P_2$ (i.e., never concurrent position management, strict sequential).

---

### User Story 5 - Monthly Capital Addition & Day Counter (Priority: P2)

**Narrative**: The backtesting engine can inject capital on a 30-day cycle (if `monthly_addition > 0`). The `day_counter` increments on every 1440th candle (representing 1 day in 1-minute candles). When 30 days are reached, capital is injected and a `MonthlyAdditionEvent` is dispatched. This increases the account balance for subsequent position sizing.

**Why this priority**: Monthly additions are a feature that allows realistic long-cycle backtests with recurring capital injection (e.g., automated DCA savings plans). This story enables multi-month simulations.

**Independent Test**: Can be fully tested by running a 60-day backtest with a monthly injection and verifying that on day 30 and day 60, the account balance increases by the specified amount, resulting in larger position sizes in subsequent cycles.

**Acceptance Scenarios**:

1. **Given** `monthly_addition = 100.0` and `account_balance = 1000.0`, **When** 30 days of candles are processed, **Then** the account balance becomes `1100.0` and `MonthlyAdditionEvent` is dispatched with the injection amount.

---

### User Story 6 - Early Exit on Last Order Fill (Priority: P3)

**Narrative**: A configuration option `exit_on_last_order` can halt the backtest early. If set to `true` and the final safety order (order #N) is filled, the simulation stops immediately (BREAK). This is useful for analyzing behavior when only the maximum drawdown buffer is reached.

**Why this priority**: Early exit is a specialized feature for custom backtest analysis. It is not required for core backtesting, hence P3.

**Independent Test**: Can be fully tested by running a backtest with `exit_on_last_order = true`, filling all N orders, and verifying that the simulation halts on the final fill without continuing to process remaining candles.

**Acceptance Scenarios**:

1. **Given** `exit_on_last_order = true` AND `number_of_orders = 5`, **When** the 5th order is filled, **Then** the simulation breaks and no further candles are processed, even if take-profit or liquidation conditions exist downstream.

---

### Canonical Test Data & Mathematical Proofs

This section provides hard test cases derived from the canonical Python bot to ensure zero precision loss and exact parity.

| Input State | Action | Expected Exact Value (Decimal) | Legacy Bot Reference |
|---|---|---|---|
| `P0=100.00`, `entry=2.0%`, `scale=1.1` | Calculate `P1` | `98.00000000` | SDD § 2.1, price grid formula |
| `P0=100.00`, `P1=98.00`, `entry=2.0%`, `scale=1.1` | Calculate `P2` | `95.96000000` | SDD § 2.1, apply $s_p^1 = 1.1$ |
| `amount_per_trade=100.0`, `amount_scale=2.0`, `n=3` orders | Calculate `A[0]`, `A[1]`, `A[2]` at indices 0,1,2 | `A[0]=14.285714...`, `A[1]=28.571428...`, `A[2]=57.142857...` (sum = 100.0) | SDD § 2.2, geometric weighting |
| Position: `Q1=1.0` @ `P1=98.00`, `Q2=1.0` @ `P2=95.96` | Calculate average entry `Pbar` | `96.98000000` | SDD § 2.3, size-weighted average |
| `Pbar=96.98`, `take_profit_distance=0.5%` | Calculate take-profit target | `97.48490000` | SDD § 2.4, $P_{tp} = \bar{P} \times 1.005$ |
| `account_balance=1000.0`, `position_size=10.0`, `Pbar=95.00`, `mmr=0.0067` | Calculate liquidation price | [NEEDS CLARIFICATION: must extract exact value from legacy bot trace] | SDD § 2.5, liquidation formula |
| Candle: `open=97.00`, `low=95.00`, trigger `P[2]=95.96` | Gap-down fill scenario | Fill at exactly `P[2]=95.96`, not at `open=97.00` | SDD § 3.2, Gap-Down Paradox Rule |
| Position open, `liquidation_price=90.00`, candle `low=89.50` | Liquidation trigger | Position closed, `profit = -account_balance` | SDD § 3.1 step 5 |

### Edge Cases

- **Gap-down past multiple orders**: When candle `open` is below multiple `P_n` values, system must fill each order at its pre-calculated price in strict sequence (SDD § 3.2).
- **Liquidation on opening candle**: If the first candle's `low` is below liquidation price, position closes immediately after the market buy.
- **All orders filled before end date**: Position is held open until a take-profit or liquidation trigger, or the backtest end date is reached (force close at final close price).
- **Fractional base currency rounding**: Order size Q_n must be rounded down to the exchange's allowed lot size (e.g., 8 decimals for most pairs). This is handled by the calculate module, but PSM must use rounded values for all subsequent averaging and liquidation calculations.
- **Monthly addition on day 1**: The legacy quirk: day counter increments on the first candle (`0 % 1440 == 0` is true), so `days = 1` immediately. First "month" is actually 29 subsequent day-boundaries. PSM must replicate this behavior.
- **Take-profit and liquidation both triggered on same candle**: Pessimistic order applies—buy (if any) → liquidation check (applies first) → take-profit (only if not liquidated). The take-profit is never filled.
- **Re-entry price with tiny multiplier effect**: When `multiplier > 1` (margin), the re-entry price applied to a new position must still use $P_0^{(new)} = P_{sell} \times 1.0005$; margin does not affect the offset formula.

## Requirements

### Functional Requirements

- **FR-001**: PSM MUST implement a deterministic finite state machine with exactly 5 states: `POSITION_IDLE`, `POSITION_OPENING`, `SAFETY_ORDER_WAIT`, `POSITION_CLOSED` (terminal), and internal transition states for liquidation/take-profit processing.

- **FR-002**: On receipt of each 1-minute OHLCV candle, PSM MUST execute the Minute Loop Protocol in strict order:
  1. Dispatch `PriceChangedEvent` with OHLCV data.
  2. Check monthly 30-day addition; if boundary met, dispatch `MonthlyAdditionEvent`.
  3. Process buy orders (if `low` ≤ any unfilled `P_n`), filling in sequence at their respective limit prices (applying Gap-Down Paradox Rule).
  4. Recalculate liquidation price after each buy fill.
  5. Check liquidation (if `low` ≤ `P_liq`); if triggered, close position with total loss and BREAK.
  6. Check take-profit (if `high` ≥ `P_tp`); if triggered, close position with calculated profit, dispatch events, and allow re-entry on next candle.
  7. If `exit_on_last_order` is true and the final order was just filled, BREAK.

- **FR-003**: PSM MUST enforce the **single-position-at-a-time invariant**: never allow two concurrent open positions. When a position closes (via take-profit or liquidation), a new position may only open on the next candle (`t+1`), not the closing candle (`t`).

- **FR-004**: PSM MUST calculate average entry price ($\bar{P}$) as a size-weighted average of all fills: $\bar{P} = \frac{\sum P_j \cdot Q_j}{\sum Q_j}$ (using `Decimal` arithmetic, `ROUND_HALF_UP`).

- **FR-005**: PSM MUST recalculate take-profit target ($P_{tp} = \bar{P} \times (1 + \frac{d_{tp}}{100})$) after every buy order fill and maintain it until the position closes.

- **FR-006**: PSM MUST recalculate liquidation price ($P_{liq} = \frac{M - Q \cdot \bar{P}}{Q \cdot (mmr - 1)}$, clamped to 0 if negative) after every buy order fill and on position opening.

- **FR-007**: PSM MUST strictly honor pre-calculated order limit prices ($P_n$) even if a candle's `open` or `low` prices would allow a more favorable fill (Gap-Down Paradox Rule / Pessimistic Execution, SDD § 3.2).

- **FR-008**: PSM MUST dispatch the following events in chronological order:
  - `TradeOpenedEvent` (when Market Buy #1 is executed)
  - `BuyOrderExecutedEvent` (for each safety order fill)
  - `LiquidationPriceUpdatedEvent` (after each buy, and on position opening)
  - `TradeClosedEvent` (when position closes)
  - `SellOrderExecutedEvent` (when position closes via take-profit)
  - `MonthlyAdditionEvent` (on 30-day boundaries)

- **FR-009**: PSM MUST use Python `Decimal` with `ROUND_HALF_UP` for all price, quantity, and profit calculations. No float-based arithmetic allowed in PSM.

- **FR-010**: PSM MUST support both spot (`multiplier=1`, `margin_type='N/A'`) and margin (`multiplier > 1`, `margin_type='cross'` or `'isolated'`) positions. Liquidation formula applies to both; spot positions have `P_liq` clamped to 0 (no liquidation risk).

- **FR-011**: PSM MUST handle `amount_per_trade ≤ 1.0` as a fraction of equity: $C = (\text{account\_balance} + \text{total\_profit}) \times \text{amount\_per\_trade}$.

- **FR-012**: PSM MUST track cumulative account balance and total profit across all positions, updating `account_balance` after each position close and applying monthly additions to it.

### Key Entities

- **Position**: Core state object holding all information for a single open trade.
  - **Attributes**: `trade_id`, `open_timestamp`, `open_price` (Market Buy #1), `orders` (list of OrderFill objects), `average_entry_price` ($\bar{P}$), `take_profit_target` ($P_{tp}$), `liquidation_price` ($P_{liq}$), `profit`, `fees_accumulated`, `is_open`, `position_quantity` ($Q_{total}$).
  - **Relationships**: One Position per iteration of the Minute Loop (never concurrent). Position commits all fills to an immutable `orders` list; fills are never revoked.

- **OrderFill**: Represents a single executed buy or sell order.
  - **Attributes**: `order_index`, `order_number` (1-indexed for humans), `order_type` (`MARKET` for #1; `LIMIT` for safety orders), `executed_price`, `executed_quantity`, `timestamp`, `fee`.

- **State**: Enumeration encoding the current state.
  - **Values**: `POSITION_IDLE`, `POSITION_OPENING`, `SAFETY_ORDER_WAIT`, `POSITION_CLOSED`.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Exact Parity with Canonical Bot: 100% of backtests using PSM produce identical cumulative profit values (to the last decimal place using `Decimal` arithmetic) as the legacy bot on the same input data across all test cases (minimum 10 diverse scenarios).

- **SC-002**: Order Execution Correctness: In 100% of test scenarios, the Minute Loop processes candles in strict pessimistic order (Buy → Liquidation → Take-Profit), never violating SDD § 3.1 ordering.

- **SC-003**: Gap-Down Handling: In 100% of gap-down test cases (where `open` is below multiple `P_n`), orders fill at their pre-calculated limit prices, not at market prices, proving SDD § 3.2 compliance.

- **SC-004**: Single-Position Invariant: Across all backtests, never allow two concurrent open positions. New positions open only on the candle following a close (not on the closing candle itself).

- **SC-005**: State Transition Correctness: State machine transitions occur only when conditions strictly match (e.g., `low` ≤ `P_n` for buy trigger, `high` ≥ `P_tp` for take-profit). No spurious or premature transitions.

- **SC-006**: Event Dispatch Completeness: For every state transition and order execution, the correct event(s) is/are dispatched with complete and accurate payload (e.g., `BuyOrderExecutedEvent` includes exact `fee`, `liquidation_price`, `order_number`).

- **SC-007**: Liquidation Logic: In 100% of liquidation scenarios, closed positions show `profit = -account_balance` (total loss), and simulation halts (no further candles processed).

- **SC-008**: Re-entry After Take-Profit: After a take-profit close on candle $t$, a new position opens on candle $t+1$ (if more candles exist) with re-entry price exactly $P_{sell} \times 1.0005$.

- **SC-009**: Test Coverage: Minimum 85% code coverage for PSM core logic (all state transitions, order fills, liquidation checks, re-entry). All critical paths tested with both happy-path and edge-case scenarios.

- **SC-010**: Decimal Precision: All monetary calculations maintain full `Decimal` precision with no precision loss between input and output. Rounding occurs only at explicit Decimal scale specifications (e.g., lot size truncation for base currency).

### Assumptions

- OHLCV data is provided sorted in chronological order with no gaps (consecutive 1-minute candles).
- Market prices (open, high, low, close) are sourced from Binance 1-minute candles and are accurate and representative.
- Configuration parameters (e.g., `multiplier`, `maintenance_margin_rate`, `number_of_orders`) are pre-validated and within acceptable ranges.
- The legacy bot (src/trading_bot.py) is the canonical source of truth; any deviation from its output signifies a PSM flaw, not a legacy bot flaw.
- No external state is modified by PSM during candle processing; all state is contained within the Position object and Event output.
- Events are synchronous; there is no asynchronous event processing or eventual consistency.
