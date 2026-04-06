# Feature Specification: Engine Stop-Loss Mechanism

**Feature Branch**: `019-engine-stop-loss`  
**Created**: April 3, 2026  
**Status**: Draft  
**Input**: User description: "Implement configurable Stop-Loss mechanism in Go engine with timeout-based execution, Cornix-style SL price calculation modes, and Optimizer UI integration"

**Constitution Gates (MANDATORY)**:

- **Green Light Protocol**: All stop-loss logic (trigger evaluation, timeout countdown, execution, re-entry) MUST have automated unit tests with canonical decimal test vectors. Tests pass before merge.
- **Fixed-point arithmetic**: SL trigger prices, execution prices, realized losses, and fee calculations MUST use `shopspring/decimal`. No floats in monetary math.
- **BDD acceptance criteria**: Each user story includes Given/When/Then scenarios covering the stop-loss execution invariants, timeout mechanics, and re-entry behavior.

---

## Background & Motivation

Exhaustive backtesting analysis (April 2026) across 47 DCA sweep runs revealed that every strategy becomes trapped in underwater positions during sustained downtrends. When the bot fills all safety orders and the market continues falling, 100% of trade capital remains locked in a losing position for 2–6 months with drawdowns of 30–52%.

Simulation shows that a configurable stop-loss (specifically −5% with 1-hour timeout) would:

- Cap maximum drawdowns from −52% to −6%
- Free capital for re-entry at lower prices
- Increase overall portfolio value by 14–47% across tested runs
- Eliminate months-long periods of zero trading activity

The mechanism follows a Cornix-style stop-loss model: a percentage-based trigger with configurable baseline calculation and optional timeout confirmation before execution.

---

## Clarifications

### Session 2026-04-03

- Q: How does `exitOnLastOrder` interact with `stop_loss_enabled` when both are true and all safety orders have filled? → A: Stop-loss takes precedence. When `stop_loss_enabled = true`, the `exitOnLastOrder` flag is effectively overridden — the SL mechanism governs the exit instead.
- Q: Can a stop-loss trigger on the very same candle that opens a position (the entry candle)? → A: Yes. The pessimistic execution order (Buy → Liquidation → SL → TP) applies to every candle including the opening candle. If the entry candle's Low breaches the SL trigger after the base order fills at Open, the SL evaluates. **Scope refinement**: for `first_entry` baseline, the trigger is computed at position open and is immediately active on the first candle. For `average_entries` baseline, the trigger is zero (inactive) until the first safety order fills, because the average entry price is undefined before any SO fills; SL evaluation on the opening candle only fires in `average_entries` mode once a SO has filled (which may happen on the opening candle itself if multiple price levels are crossed).
- Q: When a run ends with 0 take-profits and 0 stop-losses, should win rate be 0 or null? → A: Zero (0.0000). This ensures consistent numeric sorting in the Leaderboard without null-handling edge cases.

---

## User Scenarios & Testing

### User Story 1 — Immediate Stop-Loss Execution (Priority: P1) 🎯 MVP

A backtest operator configures a DCA strategy with stop-loss enabled and zero timeout. When the market price drops below the SL trigger, the position closes immediately at the breaching candle's Close price as a taker (market) order. The bot resets to idle state and re-enters on the next candle's Open. The realized loss is reflected in the account balance, and the stop counts toward total stops triggered.

**Why this priority**: This is the minimum viable stop-loss. Without immediate execution working correctly, no timeout variant can be trusted. Delivers the core capital-protection benefit.

**Independent Test**: Run a single backtest with known candle data where one candle's Low breaches the SL threshold. Verify the position closes at that candle's Close, the account balance decreases by the correct loss + taker fee, the stop counter increments, and the next candle opens a fresh position.

**Acceptance Scenarios**:

1. **Given** a position is open with base order entry at $100.00, SL enabled at 5%, baseline `first_entry`, timeout 0 min, **When** a candle arrives with Low = $94.50 (≤ $95.00 trigger), **Then** the position is closed at that candle's Close price; a taker fee is applied; `total_stops_triggered` increments by 1; the account balance is updated.

2. **Given** a position is open with 3 safety orders filled, average entry $95.00, SL enabled at 5%, baseline `average_entries`, timeout 0 min, **When** a candle's Low = $90.20 (≤ $90.25 trigger), **Then** the position is closed at that candle's Close; the realized loss is computed from the volume-weighted average entry; taker fee is applied.

3. **Given** a stop-loss just executed, **When** the immediately subsequent candle arrives, **Then** the engine evaluates the candle's Open price for a new position entry (standard re-entry logic); the remaining account balance is the available capital.

4. **Given** a position is open with SL enabled, **When** a candle's Low is above the SL trigger price, **Then** no stop action occurs; the position continues with normal DCA logic (safety orders, take-profit evaluation).

5. **Given** stop-loss is disabled (`stop_loss_enabled = false`), **When** any candle is processed, **Then** the engine behaves identically to the pre-feature logic; no SL evaluation occurs.

---

### User Story 2 — Timeout-Based Stop-Loss Execution (Priority: P1)

A backtest operator configures a stop-loss with a non-zero timeout (e.g., 60 minutes). The engine tracks how long the price remains below the SL trigger. If the price stays below the threshold continuously for the configured timeout duration, the stop executes. If the price recovers above the trigger before the timeout expires, the breach is reset and no stop occurs. This prevents whipsaw stops on momentary wicks.

**Why this priority**: The analysis showed that 0-minute and 1-hour timeouts produce nearly identical results for -5% thresholds, but timeouts are critical for tighter thresholds (e.g., -3%) where wicks cause false triggers. This is core to the feature's value.

**Independent Test**: Construct a candle sequence where the SL trigger is breached, then 30 minutes later the price recovers above the trigger, then later breaches again and stays below for the full timeout. Verify: first breach resets, second breach triggers the stop.

**Acceptance Scenarios**:

1. **Given** a position with SL at 5%, baseline `first_entry`, entry at $100.00, timeout 60 min, **When** candle at T+0 has Low = $94.80 (breach), and candles at T+1 through T+59 all have Low ≤ $95.00, and candle at T+60 has Low ≤ $95.00, **Then** the stop executes at T+60's Close price.

2. **Given** an active SL breach started at T+0, timeout 60 min, **When** candle at T+30 has Low = $95.50 (above trigger), **Then** the breach timestamp is reset to null; the timeout counter restarts; no stop occurs.

3. **Given** a breach was reset at T+30, **When** candle at T+45 breaches again and Low remains ≤ SL trigger through T+105, **Then** the stop executes at T+105's Close price (60 minutes from the second breach, not the first).

4. **Given** a position with timeout 120 min and an active breach, **When** a take-profit condition is met during the timeout window (candle High ≥ TP target), **Then** the take-profit executes; the SL breach state is cleared; no stop occurs. (TP has priority over pending SL timeout.)

5. **Given** a position with timeout > 0 and an active breach, **When** a safety order fill trigger is met on the same candle, **Then** the safety order fills first (pessimistic execution order: buys → SL check → TP check); the SL trigger price recalculates if baseline is `average_entries`; the breach may reset if the new trigger price is now below the candle's Low.

---

### User Story 3 — SL Trigger Price Modes: `first_entry` vs `average_entries` (Priority: P2)

The SL trigger price calculation depends on the configured baseline mode:

- **`first_entry`**: SL trigger = `base_order_price × (1 − stop_loss_percent / 100)`. This price is calculated once on position open and never changes regardless of safety order fills.
- **`average_entries`**: SL trigger = `average_entry_price × (1 − stop_loss_percent / 100)`. This recalculates every time a safety order fills, moving the trigger lower as the average entry is brought down.

**Why this priority**: Both modes must work, but `average_entries` is the recommended default based on the analysis. The `first_entry` mode is simpler to implement but more aggressive (stops sooner).

**Independent Test**: Run two backtests with identical candle data and DCA parameters, one with each baseline mode. Verify the `first_entry` run triggers its stop earlier (at a higher price) than the `average_entries` run when multiple safety orders have filled.

**Acceptance Scenarios**:

1. **Given** baseline = `first_entry`, position opened at $100.00, SL = 5%, 2 safety orders filled (avg entry now $96.50), **When** evaluating SL trigger, **Then** trigger price is $95.00 (from $100.00), not $91.675 (from $96.50).

2. **Given** baseline = `average_entries`, position opened at $100.00, SL = 5%, **When** safety order 1 fills and avg entry becomes $97.00, **Then** SL trigger recalculates to $92.15 (from $97.00).

3. **Given** baseline = `average_entries`, position opened at $100.00, SL = 5%, **When** safety orders 1, 2, 3 fill and avg entry drops to $93.00, **Then** SL trigger is $88.35; a candle with Low = $89.00 does NOT trigger the stop.

4. **Given** baseline = `first_entry`, same scenario as above, **Then** SL trigger remains $95.00; a candle with Low = $89.00 DOES trigger the stop (or starts the timeout).

---

### User Story 4 — Win Rate and KPI Reporting (Priority: P2)

The engine's run result payload and the Optimizer's KPI display must reflect stop-loss activity. Win Rate must now account for losses from stops: `Win Rate = Take-Profits / (Take-Profits + Stop-Losses)`. A new `total_stops_triggered` integer field must appear in the engine output, Postgres summary row, and Leaderboard grid.

**Why this priority**: Without updated KPIs, the operator cannot compare stop-loss strategies in the Optimizer. This is needed for meaningful sweep analysis.

**Independent Test**: Run a backtest that produces 8 take-profit closes and 2 stop-loss closes. Verify win rate = 80%, total_stops_triggered = 2, and both appear in the API response and Leaderboard.

**Acceptance Scenarios**:

1. **Given** a completed run with 10 TPs and 3 SLs, **When** computing win rate, **Then** `win_rate = 10 / (10 + 3) = 0.7692` (76.92%).

2. **Given** a completed run with 5 TPs and 0 SLs, **When** computing win rate, **Then** `win_rate = 5 / (5 + 0) = 1.0000` (100%) — backward-compatible with pre-feature behavior.

3. **Given** a completed run with 0 TPs and 0 SLs (e.g., position still open at backtest end), **When** computing win rate, **Then** `win_rate = 0.0000` (0%) — zero, not null, for consistent Leaderboard sorting.

4. **Given** a completed batch sweep, **When** viewing the Leaderboard, **Then** the `total_stops_triggered` column is visible, sortable, and filterable.

---

### User Story 5 — Optimizer UI: SL Parameter Configuration & Sweepability (Priority: P2)

The Optimizer Configurator form must expose the 4 new stop-loss parameters. `stop_loss_percent` and `stop_loss_timeout_minutes` must be sweepable (supporting fixed, range, and array value modes) so operators can run parameter sweeps to find optimal SL settings.

**Why this priority**: The Optimizer UI is how the operator discovers the right SL parameters for a given asset. Without sweepability, they must run individual backtests manually.

**Independent Test**: Configure a sweep with `stop_loss_percent` = range [3, 5, 8, 10] and `stop_loss_timeout_minutes` = range [0, 60, 120]. Verify the Optimizer generates 12 permutations and all run successfully.

**Acceptance Scenarios**:

1. **Given** the Optimizer Configurator form, **When** `stop_loss_enabled` is toggled on, **Then** the SL parameter fields (`stop_loss_percent`, `stop_loss_baseline`, `stop_loss_timeout_minutes`) become visible and editable.

2. **Given** `stop_loss_percent` field in the Configurator, **When** the operator selects "Range" mode and enters [3, 5, 8], **Then** the sweep generates separate runs for each percent value, crossed with all other swept parameters.

3. **Given** `stop_loss_timeout_minutes` field, **When** the operator enters array [0, 30, 60, 120], **Then** each value produces distinct engine runs.

4. **Given** `stop_loss_baseline` field, **When** the operator selects a value, **Then** only `first_entry` or `average_entries` are available; this field is NOT sweepable (single selection per sweep).

5. **Given** `stop_loss_enabled = false` in the sweep config, **When** the sweep runs, **Then** the 3 SL parameter fields are ignored and the engine runs without SL logic.

---

### User Story 6 — Wide Events: Stop-Loss Events in ClickHouse (Priority: P3)

When a stop-loss executes, the engine must emit a wide event with `event_type = 'stop_loss_executed'` containing the execution price, realized loss, and accumulated fees. This enables Grafana dashboards to visualize stop-loss events on equity curves and drawdown timelines.

**Why this priority**: Observability of stop-loss behavior is important for tuning parameters but not required for the core feature to work.

**Independent Test**: Promote a run with stop-losses to ClickHouse. Query `sweep_wide_events WHERE event_type = 'position_closed' AND close_reason = 'stop_loss'` and verify rows exist with correct fields.

**Acceptance Scenarios**:

1. **Given** a promotion of a run that had 3 stop-loss executions, **When** querying ClickHouse, **Then** 3 rows exist with `event_type = 'position_closed'` and `close_reason = 'stop_loss'`, each containing the execution price, realized PnL, and fee.

2. **Given** a Grafana equity curve panel, **When** a promoted run with stops is selected, **Then** stop-loss events appear as distinct markers on the timeline.

---

### Canonical Test Data & Mathematical Proofs

| Input State | Action | Expected Exact Value (Decimal) | Notes |
|---|---|---|---|
| Entry=$100.00, SL%=5, baseline=`first_entry` | Calc SL trigger | `95.00000000` | $100 \times (1 - 0.05)$ |
| Entry=$100.00, SO1 fills, avg_entry=$97.00, SL%=5, baseline=`average_entries` | Calc SL trigger | `92.15000000` | $97 \times (1 - 0.05)$ |
| Entry=$100.00, SO1+SO2+SO3, avg_entry=$93.00, SL%=5, baseline=`first_entry` | Calc SL trigger | `95.00000000` | Unchanged from entry |
| Entry=$100.00, SO1+SO2+SO3, avg_entry=$93.00, SL%=5, baseline=`average_entries` | Calc SL trigger | `88.35000000` | $93 \times (1 - 0.05)$ |
| Position: qty=0.5 BTC, avg_entry=$100.00, candle Close=$94.00, taker_fee=0.04% | Execute SL | realized_loss = `−3.01880000` | $(94 - 100) \times 0.5 - (94 \times 0.5 \times 0.0004)$ |
| 10 TPs, 3 SLs | Win rate | `0.76923077` | $10 / 13$ |
| 0 TPs, 0 SLs | Win rate | `0.00000000` | Guard against division by zero |

---

### Edge Cases

- **SL trigger and TP target hit on the same candle (Low ≤ SL AND High ≥ TP)**: Pessimistic execution order dictates SL evaluates after buy orders but the existing PSM processes buys → liquidation → TP. The stop-loss check must be inserted into the pessimistic order. The specified order is: Buy Orders → Liquidation → Stop-Loss → Take-Profit. On a candle where both SL and TP conditions are met, SL executes (pessimistic — assumes worst case).
- **SL trigger exactly equals candle Low**: This IS a breach. The condition is `Low ≤ SL_trigger` (inclusive).
- **All safety orders filled, then SL triggers**: The full position quantity at the volume-weighted average entry is closed. The realized loss may be significant. This is the core scenario the feature is designed to handle.
- **Monthly capital injection during SL flat period**: When the bot is idle after a stop (before re-entry), monthly additions still credit to the account balance, increasing available capital for the next position.
- **SL trigger price below zero**: If `average_entry × (1 − SL_percent/100)` produces a negative number (e.g., SL=150%), the trigger is floored at zero. However, validation should reject `stop_loss_percent > 100`.
- **Timeout spans backtest end**: If a breach is active but the backtest ends before the timeout expires, the position remains open (same as current behavior for open-at-end positions). No stop executes.
- **Re-entry on candle after stop**: The engine opens a new position using the subsequent candle's Open price as the entry price, following the standard position-opening logic. The position uses the remaining account balance for sizing.
- **Breach during the same candle as a safety order fill (average_entries mode)**: The safety order fills first (pessimistic: buys first). The average entry then recalculates. If the new SL trigger (from updated average entry) is still ≤ the candle's Low, the breach begins (or continues). If the recalculated trigger is now below the Low, no breach occurs.
- **SL on the position-opening candle**: The SL evaluates on the same candle that opens the position. If the base order fills at Open and the candle's Low then breaches the SL trigger, the stop fires (or starts the timeout). This follows from the pessimistic execution order applying to every candle.
- **`exitOnLastOrder = true` with SL enabled**: When `stop_loss_enabled = true`, the `exitOnLastOrder` flag is overridden. The SL mechanism governs position exit timing. If `stop_loss_enabled = false`, `exitOnLastOrder` retains its original behavior.

---

## Requirements

### Functional Requirements

- **FR-001**: The engine Config MUST accept four new fields: `stop_loss_enabled` (bool), `stop_loss_percent` (decimal), `stop_loss_baseline` (enum: `first_entry` | `average_entries`), `stop_loss_timeout_minutes` (int).
- **FR-002**: When `stop_loss_enabled = false`, the engine MUST behave identically to the pre-feature engine. No SL evaluation occurs.
- **FR-003**: When `stop_loss_enabled = true` and `stop_loss_baseline = first_entry`, the SL trigger price MUST be `base_order_execution_price × (1 − stop_loss_percent / 100)`, computed once at position open, immutable for the position's lifetime.
- **FR-004**: When `stop_loss_enabled = true` and `stop_loss_baseline = average_entries`, the SL trigger price MUST be `volume_weighted_avg_entry × (1 − stop_loss_percent / 100)`, recalculated after each safety order fill.
- **FR-005**: SL trigger evaluation MUST compare the candle's Low price: breach occurs when `candle.Low ≤ SL_trigger_price`.
- **FR-006**: When `stop_loss_timeout_minutes = 0` and a breach occurs, the position MUST close immediately at the breaching candle's Close price.
- **FR-007**: When `stop_loss_timeout_minutes > 0` and a breach occurs, the engine MUST record a `breach_timestamp`. If subsequent candles' Low remains ≤ SL trigger for the configured duration, the position closes at the confirming candle's Close price.
- **FR-008**: If, during an active timeout countdown, any candle's Low rises above the SL trigger price, the `breach_timestamp` MUST reset to null. The timeout restarts from zero on the next breach.
- **FR-009**: SL execution MUST be processed as a taker (market) order, applying the exchange's taker fee rate.
- **FR-010**: After SL execution, the engine MUST transition the position to idle state and evaluate re-entry conditions on the Open price of the immediately subsequent candle.
- **FR-011**: The pessimistic execution order within each candle MUST be: Buy Orders → Liquidation Check → **Stop-Loss Check** → Take-Profit Check.
- **FR-012**: If both SL and TP conditions are met on the same candle, SL MUST execute (pessimistic).
- **FR-013**: During an active SL timeout, if a take-profit condition is met, the TP MUST execute and the SL breach state MUST be cleared.
- **FR-014**: Win Rate MUST be computed as `total_take_profits / (total_take_profits + total_stop_losses)`. If both are zero, win rate is `0.0000`.
- **FR-015**: The engine result payload MUST include a new integer field `total_stops_triggered`.
- **FR-016**: The Postgres `sweep_run_summaries` table MUST include a new `total_stops_triggered` integer column.
- **FR-017**: The Optimizer Configurator UI MUST expose the 4 SL parameters. `stop_loss_percent` and `stop_loss_timeout_minutes` MUST be sweepable (fixed, range, array).
- **FR-018**: `stop_loss_baseline` MUST NOT be sweepable — it is a single selection per sweep.
- **FR-019**: When `stop_loss_enabled` is toggled off in the UI, the SL parameter fields MUST be hidden or disabled.
- **FR-020**: Validation: `stop_loss_percent` MUST be > 0 and ≤ 100 when SL is enabled. `stop_loss_timeout_minutes` MUST be ≥ 0.
- **FR-021**: When a stop-loss executes in wide-event mode, the engine MUST emit a `position_closed` wide event with `close_reason = 'stop_loss'` containing execution price, realized PnL, and fee. The `event_type` field retains `'position_closed'` (consistent with every other close event type); no new `event_type` value is introduced. This requires zero ClickHouse DDL changes.
- **FR-022**: All SL trigger price calculations, execution prices, realized losses, and fees MUST use fixed-point decimal arithmetic.
- **FR-023**: When `stop_loss_enabled = true`, the `exitOnLastOrder` config flag MUST be overridden — SL governs position exit. When `stop_loss_enabled = false`, `exitOnLastOrder` retains its original behavior.
- **FR-024**: SL trigger evaluation MUST apply on every candle including the position-opening candle, consistent with the pessimistic execution order.
- **FR-025**: *(Cross-reference — no new constraint)* The zero-guard in FR-014 already mandates `0.0000` (not null) when both counts are zero. This FR is retained for traceability to the Session 2026-04-03 clarification. See FR-014 and the canonical test vector row "0 TPs, 0 SLs → 0.00000000".

### Key Entities

- **Stop-Loss Configuration**: The 4 parameters (`enabled`, `percent`, `baseline`, `timeout_minutes`) — part of the Config struct.
- **SL Breach State**: Per-position runtime state tracking `breach_timestamp` (nullable), `sl_trigger_price` (decimal). Cleared on position close, re-entry, or breach recovery.
- **Stop-Loss Execution Event**: The realization of a stop — contains execution price, realized loss, total fee, and the candle timestamp.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Backtests with SL enabled produce correct results: a run with known candle data triggers stops at the mathematically exact candle and price, matching the canonical test vectors to full decimal precision.
- **SC-002**: A sweep of 12+ SL parameter combinations (4 percent values × 3 timeout values) completes without errors and produces distinct result rows with varying `total_stops_triggered` values.
- **SC-003**: Runs with `stop_loss_enabled = false` produce byte-identical results to the pre-feature engine — zero regression.
- **SC-004**: Maximum drawdown for a run with SL enabled at −5%/60min is measurably lower than the same run without SL, across both BTC and ETH test data.
- **SC-005**: The `total_stops_triggered` KPI is visible, sortable, and filterable in the Optimizer Leaderboard.
- **SC-006**: Win Rate correctly reflects stop-loss losses: a run with 10 TPs and 3 SLs shows 76.92% win rate.

---

## Assumptions

- The bot operates long-only positions. Stop-loss triggers when price falls below a threshold (not above).
- The exchange taker fee rate is already configured in the engine and does not need a new parameter.
- Monthly capital additions continue during flat periods (between SL execution and re-entry).
- The re-entry logic after a stop-loss is identical to the standard position-opening logic (Open price of next candle).
- The existing pessimistic execution order (SDD 3.1) is extended, not replaced. Buy Orders and Liquidation checks remain unchanged.
- The `stop_loss_baseline` enum has exactly two values. No additional modes are planned.

---

## Scope Boundaries

### In Scope

- Go engine: Config changes, SL evaluation logic, timeout tracking, execution, re-entry, KPI updates
- Orchestrator API: Postgres schema migration, summaries endpoint update, sweep config passthrough
- Frontend: Optimizer Configurator SL fields, Leaderboard `total_stops_triggered` column
- Wide events: `stop_loss_executed` event type emission
- Existing test suites updated to account for SL fields

### Out of Scope

- Trailing stop-loss (dynamic threshold that follows price upward)
- Partial position close (stop always closes 100% of position)
- Stop-loss on short positions (bot is long-only)
- Changes to the Grafana dashboard panels (existing panels will display new event types automatically)
- Changes to the ClickHouse `sweep_wide_events` DDL (existing schema already supports new event types via `LowCardinality(String)`)
