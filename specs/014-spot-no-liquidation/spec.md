# Feature Specification: Spot Trading Liquidation Bypass (Multiplier = 1)

**Feature Branch**: `014-spot-no-liquidation`
**Created**: March 23, 2026
**Status**: Draft
**Input**: User description: "Bypass forced liquidation for multiplier=1 spot trading: when leverage is 1x, the engine must not calculate or check liquidation price. Position should only close via Take Profit, Trailing Stop, or exit_on_last_order."

## Overview

When a user configures the backtesting engine with `Multiplier = 1`, they are simulating **spot trading** — purchasing the underlying asset outright with no borrowed capital. In spot trading, there is no margin, no lender, and therefore no liquidation threshold. A position can lose 99.9% of its value and remain legally and mechanically open.

The current engine incorrectly applies a futures-style liquidation check regardless of the configured multiplier. This causes spot backtests to terminate prematurely with a total loss, producing incorrect simulation results. This specification defines the behavioral change required to make `Multiplier = 1` positions immune to forced liquidation.

## Constitution Gates (MANDATORY)

- **Green Light Protocol**: All new branching logic that gates liquidation evaluation MUST be covered by automated tests demonstrating both the bypass (multiplier = 1) and the retained behavior (multiplier > 1). Tests must pass before merge.
- **Fixed-point Arithmetic**: The `liquidation_price` sentinel value for spot positions MUST be represented as `Decimal("0")` — never a float. All comparisons involving `liquidation_price` must use fixed-point decimal equality checks.
- **BDD Acceptance Criteria**: Two canonical Given/When/Then scenarios — Spot Survival and Normal Futures Liquidation — are defined below and serve as the binding behavioral contract for this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Spot Survival: Position Survives Catastrophic Price Drop (Priority: P1)

A user runs a backtest simulating spot trading (no leverage) by setting `Multiplier = 1`. The asset price collapses by 99%. The position must remain fully open throughout because, in spot trading, the user owns the asset outright — there is nothing to liquidate.

**Why this priority**: This is the core correctness bug. Any backtest with `Multiplier = 1` currently terminates with a wrong total loss. This story re-establishes mathematical correctness and is the reason this feature exists.

**Independent Test**: Can be fully tested by configuring a position with `Multiplier = 1`, entry price `$100.00`, and then feeding candles with progressively lower prices down to `$0.01`. The position MUST remain in `SAFETY_ORDER_WAIT` or `POSITION_OPEN` state throughout. No `LiquidationEvent` or position-closing event is emitted. Delivers a correct spot backtest.

**Acceptance Scenarios**:

1. **Given** a position is configured with `Multiplier = 1` and opened at an entry price of `$100.00`, **When** a candle is processed with `low = $1.00` (a 99% drop), **Then** the position state remains `OPEN`; no `LiquidationEvent` is emitted; no `PositionClosedEvent` is emitted; the `liquidation_price` field on the position is `0`.

2. **Given** a position is configured with `Multiplier = 1` and `liquidation_price = 0`, **When** the candle processing loop reaches the liquidation evaluation step, **Then** the evaluation is completely skipped; the engine advances to the Take Profit check without any comparison against candle `low`.

3. **Given** a position is configured with `Multiplier = 1` and all safety orders have filled, **When** the price continues to fall below any historically calculated liquidation threshold, **Then** the position stays open; it may only close when `take_profit_price` is reached, a trailing stop is triggered, or `exit_on_last_order` is configured and the last order has filled.

---

### User Story 2 — Normal Futures Liquidation Is Unchanged for Multiplier > 1 (Priority: P1)

A user runs a futures backtest with `Multiplier = 2`. The asset price drops below the calculated bankruptcy price. The engine correctly fires a liquidation, closing the position with full loss. This story ensures the fix for User Story 1 does not regress leveraged behavior.

**Why this priority**: Equal priority to US1. Silently disabling liquidation for leveraged positions would be a critical correctness regression. This story is the non-regression contract.

**Independent Test**: Can be fully tested by configuring a position with `Multiplier = 2`, entry price `$100.00`, and feeding a candle where `low` falls at or below the calculated `liquidation_price`. Verify `LiquidationEvent` fires and the position closes with full loss. Demonstrates the 1x bypass is narrowly scoped.

**Acceptance Scenarios**:

1. **Given** a position is configured with `Multiplier = 2` and opened at an average entry price of `$100.00` with a calculated `liquidation_price > $0`, **When** a candle is processed with `low ≤ liquidation_price`, **Then** the position is immediately closed; a `LiquidationEvent` is emitted; the realized loss equals the full position value; simulation halts for that run.

2. **Given** a position is configured with `Multiplier = 3` and `liquidation_price = $55.00`, **When** a candle is processed with `low = $54.99`, **Then** the outcome is identical to Scenario 1 above — liquidation fires correctly.

3. **Given** a position is configured with `Multiplier = 2` and a candle's `low` is above `liquidation_price`, **When** the liquidation check runs, **Then** the check passes silently and execution continues to the Take Profit step — no change to the original liqudation behavior for leveraged positions.

---

### User Story 3 — Spot Position Closes Normally via Take Profit (Priority: P2)

A user runs a spot backtest with `Multiplier = 1`. After a temporary dip (that would have incorrectly liquidated before this fix), the price recovers and hits the take profit target. The position closes with profit, not loss.

**Why this priority**: Validates that disabling liquidation does not accidentally disable other exit paths. A position that can never close would be equally broken.

**Independent Test**: Can be fully tested by opening a `Multiplier = 1` position at `$100.00`, feeding candles that dip to `$50.00` (no liquidation), then feeding a candle where `high ≥ take_profit_price`. Verify `PositionClosedEvent` (take profit) fires and profit is calculated correctly.

**Acceptance Scenarios**:

1. **Given** a spot position (`Multiplier = 1`) is open with `take_profit_price = $105.00`, **When** a candle arrives with `high = $106.00`, **Then** the position closes via take profit; a `PositionClosedEvent` with reason `TAKE_PROFIT` is emitted; profit is calculated correctly based on average entry and the take profit price.

2. **Given** a spot position (`Multiplier = 1`) that has survived multiple candles with prices below the theoretical (now-bypassed) liquidation threshold, **When** a take profit candle subsequently arrives, **Then** the position closes normally — confirming that surviving the dip did not corrupt position state.

---

### Canonical Test Data & Mathematical Proofs *(MANDATORY FOR CORE DOMAIN)*

The following test cases are **binding specifications**. Implementation MUST produce these exact values with no deviation.

| Input State | Action | Expected Exact Value (Decimal) | Notes |
|---|---|---|---|
| `Multiplier=1`, entry=`100.00`, no safety orders | Read `liquidation_price` on open | `0` | Spot: no liquidation threshold |
| `Multiplier=1`, entry=`100.00`, candle `low=1.00` | Evaluate liquidation step | Step skipped; position remains `OPEN` | No event emitted |
| `Multiplier=1`, safety order filled, avg_entry=`90.00` | Read `liquidation_price` after SO fill | `0` | Remains zero even after re-averaging |
| `Multiplier=2`, entry=`100.00`, MMR=`0.5%` → `liq≈50.25` | Candle `low=50.00` | `LiquidationEvent` emitted; loss=full balance | Futures behavior unchanged |
| `Multiplier=2`, entry=`100.00`, candle `low=51.00` | Evaluate liquidation step | Step executes; condition false; no event | Futures: check still runs |
| `Multiplier=1`, take_profit=`105.00`, candle `high=106.00` | Take profit check | `PositionClosedEvent` (TAKE_PROFIT); profit > `0` | Spot: exit via TP works |

**Rationale**: Row 1 and Row 3 lock in that `liquidation_price` is always `0` for spot, even after safety order re-averaging. Row 2 locks in the bypass. Rows 4–5 lock in futures non-regression. Row 6 confirms spot TP exit is unaffected.

### Edge Cases

- **Multiplier exactly equal to 1 (not 1.0 or "1")**: The bypass condition must use exact equality against the integer/decimal value `1`. The check must not accidentally trigger for `Multiplier = 1.5` or `Multiplier = 0.9`.
- **Safety order fills with Multiplier = 1**: When a safety order fills and average entry price is recalculated, `liquidation_price` must remain `0` — it must not be recalculated as a positive value after re-averaging.
- **`exit_on_last_order` + `Multiplier = 1`**: When the last DCA order fills and `exit_on_last_order` is configured, the position closes at the last fill price. This must work correctly even though liquidation is disabled — the two exit paths are independent.
- **Multiplier = 1 with trailing stop configured**: Trailing stop exit must remain operative. A `TrailingStopEvent` can still close the position. The liquidation bypass only eliminates the forced-loss liquidation path.
- **Price reaches exactly `$0.00`**: A candle with `low = 0.00` and `Multiplier = 1` must not trigger liquidation. The position stays open (the asset has become worthless but nothing forces a close).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When `Multiplier = 1`, the engine MUST NOT calculate a `liquidation_price` at position open. The `liquidation_price` field MUST be set to `0` (zero).
- **FR-002**: When `Multiplier = 1`, the engine MUST NOT recalculate `liquidation_price` when a safety order fills and average entry price is updated. The field MUST remain `0`.
- **FR-003**: When `Multiplier = 1`, the engine MUST completely bypass the liquidation evaluation step during candle processing — the step is not executed at all, not merely skipped by a false condition.
- **FR-004**: When `Multiplier = 1`, the engine MUST NOT emit a `LiquidationEvent` for any candle, regardless of how low the candle's `low` price falls.
- **FR-005**: When `Multiplier = 1`, a position MUST only be closeable via: (a) Take Profit price reached, (b) Trailing Stop triggered, or (c) `exit_on_last_order` configuration when the last safety order has filled.
- **FR-006**: When `Multiplier > 1`, liquidation price calculation, liquidation evaluation, and `LiquidationEvent` emission MUST behave identically to the behavior prior to this change. No regression is permitted.
- **FR-007**: The bypass condition MUST be evaluated solely on the configured `Multiplier` value. It MUST NOT depend on any runtime position state, candle data, or external configuration flags.
- **FR-008**: Any externally exposed position state (e.g., API response, stored record) MUST reflect `liquidation_price = 0` for spot positions, so downstream consumers (UI, reporting) accurately represent the absence of a liquidation threshold.

### Key Entities

- **Position**: The active trading position. Gains a behavioral contract: when `multiplier = 1`, its `liquidation_price` is permanently `0` and it cannot be force-closed via liquidation. All other state transitions (safety orders, take profit, trailing stop) remain intact.
- **Candle**: A 1-minute OHLCV data point fed to the PSM. For `Multiplier = 1` positions, the candle's `low` is never compared against `liquidation_price` during the liquidation step.
- **LiquidationEvent**: An event emitted when a leveraged position is force-closed due to price breach. For `Multiplier = 1`, this event MUST never be emitted.
- **PositionClosedEvent**: An event emitted on any position close. For `Multiplier = 1`, this event may only be emitted with reason `TAKE_PROFIT`, `TRAILING_STOP`, or `EXIT_ON_LAST_ORDER`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A backtest configured with `Multiplier = 1` where the asset price drops 99% from entry survives the entire simulation period without a forced closure — zero `LiquidationEvent`s are recorded.
- **SC-002**: A backtest configured with `Multiplier = 2` under identical price conditions correctly produces a `LiquidationEvent` when the price breaches the calculated threshold — futures behavior is unaffected.
- **SC-003**: All existing automated tests for the Position State Machine continue to pass after this change — non-regression is fully verified.
- **SC-004**: The `liquidation_price` field exposed in position state reads `0` for every `Multiplier = 1` position at every stage of its lifecycle (open, during safety order fills, at close).
- **SC-005**: A `Multiplier = 1` position that survives a price drawdown correctly closes via Take Profit when the price recovers — the alternative exit paths remain fully functional.

## Assumptions

- `Multiplier` is a configuration-time constant for a given backtest run. It is not mutable mid-simulation.
- The value `1` is the exclusive bypass trigger. Values such as `1.0`, `1.00`, or any floating-point representation of one must be treated equivalently via the project's fixed-point decimal equality standard.
- "Trailing Stop" is mentioned as a valid exit for completeness. If trailing stop is not yet implemented in the engine as of this feature, FR-005 does not add a new requirement — it merely confirms that trailing stop (when it exists) must remain operational for spot positions.
- The liquidation price formula for leveraged positions (multiplier > 1) is unchanged and out of scope for this feature.
- `exit_on_last_order` behavior is unchanged. This feature does not modify when or how `exit_on_last_order` triggers — it only ensures liquidation cannot preempt it for spot positions.
