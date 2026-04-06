# Feature Specification: Annualized Return (IRR / Money-Weighted Return)

**Feature Branch**: `020-annualized-return`
**Created**: 2026-04-06
**Status**: Draft
**Input**: User description: "Create a calculation for the Internal Rate of Return (IRR) to represent the true annualized yield (APY), accounting for the specific timing of all capital injections. Extract Cash Flows from tradeEvents DEPOSIT events. Use final balance as terminal value. Append annualizedReturn as a percentage to pnlSummary. Handle edge cases for short backtests and no recurring deposits. Update wide events, tradeEvents, all UIs and Grafana dashboards."

**Constitution Gates (MANDATORY)**:
- **Green Light Protocol**: All new IRR computation logic must be covered by unit tests producing exact Decimal-precision results before merging. Mathematical edge cases (< 1 year, no deposits, zero final balance) require explicit test cases.
- **Fixed-point arithmetic**: The Newton-Raphson IRR solver MUST use Decimal.js for all intermediate and final computations. No `number` arithmetic for cash flows or discount factors.
- **BDD acceptance criteria**: Every functional requirement below is accompanied by a Given/When/Then scenario that constitutes a passing automated test.

Failure to document and provide automated tests for these gates will block Phase 0 approval.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Annualized Return Displayed on Single Run Results (Priority: P1)

A trader completes a backtest spanning 18 months with an initial balance and monthly capital injections. After the run, they need the equivalent annual yield — so they can compare this strategy against a bond or index fund. The results page must show `annualizedReturn` next to `roi`, `maxDrawdown`, and `totalFees`.

**Why this priority**: Without time-weighting, a 20% cumulative return over 18 months and a 20% return over 6 months are indistinguishable in the current UI. This is the core business problem.

**Independent Test**: Run a backtest with known deposit timestamps and final balance. Assert that `pnlSummary.annualizedReturn` in the result payload matches the IRR computed from those cash flows. No UI or database changes are required.

**Acceptance Scenarios**:

1. **Given** a completed backtest with `account_balance = 1000`, two deposits of 500 each at months 6 and 12, and a final balance of 2400 at 18 months, **When** the result payload is retrieved, **Then** `pnlSummary.annualizedReturn` is present and matches the IRR for cash flows `[-1000, -500, -500, +2400]` at `[t=0, t=0.5yr, t=1yr, t=1.5yr]` expressed as a percentage per year.

2. **Given** a backtest with no deposit events (only initial balance), **When** the result is retrieved, **Then** `pnlSummary.annualizedReturn` is computed using only the initial balance outflow and the final balance as the inflow.

3. **Given** a backtest shorter than 30 days, **When** the result is retrieved, **Then** `pnlSummary.annualizedReturn` correctly extrapolates to an annual rate (large values are not suppressed or clamped).

4. **Given** a backtest where the final balance is zero (full liquidation), **When** the result is retrieved, **Then** `pnlSummary.annualizedReturn` is `-100.00`.

---

### User Story 2 — Annualized Return Visible in Sweep Leaderboard (Priority: P2)

A trader runs an optimizer sweep of 200 parameter combinations. They want to sort and compare runs by annualized yield in the leaderboard, not just total ROI. The sweep run summary must store and expose `annualizedReturn` alongside existing metrics.

**Why this priority**: The optimizer leaderboard is the primary comparison tool. Without annualized return, strategies run over different date ranges cannot be fairly ranked.

**Independent Test**: Run a sweep with two configs over different date ranges. Verify each result record includes a numerically correct `annualizedReturn` and the session results endpoint exposes the field.

**Acceptance Scenarios**:

1. **Given** multiple sweep runs with different durations and deposit schedules, **When** the session results endpoint is queried, **Then** each result record includes an `annualizedReturn` field as a percentage.

2. **Given** a completed sweep session with persisted run summaries, **When** the Grafana sweep leaderboard queries the run summary data, **Then** `annualized_return` is a queryable column that can be used for sorting and ranking.

---

### User Story 3 — Promoted Runs Carry Annualized Return in Analytics (Priority: P3)

When a promoted run's wide-event data is replayed, the associated run metadata (including `annualizedReturn`) is available for join queries against the wide-event table.

**Why this priority**: Enrichment for advanced analytics. Does not block P1 or P2.

**Independent Test**: Promote a run. Verify `annualized_return` is set in the persisted summary and can be joined against wide-event records.

**Acceptance Scenarios**:

1. **Given** a promoted run, **When** the run summary record is queried, **Then** `annualized_return` matches the value in the original result payload.

---

### Canonical Test Data & Mathematical Proofs *(MANDATORY)*

The IRR is the rate `r` (per year) such that:

  NPV = sum of [ CF_i / (1+r)^t_i ] = 0

where `CF_i` is the cash flow at fractional year `t_i` from backtest start, outflows negative, terminal inflow positive.

**`annualizedReturn` = `r x 100` (percent per year).**

The solver MUST use Newton-Raphson with at least 100 iterations and convergence tolerance of `1e-10`. If Newton-Raphson diverges, bisection between `-99.99%` and `+10000%` is the mandatory fallback.

| Cash Flows                    | Times (years)      | Expected annualizedReturn | Notes                      |
|-------------------------------|--------------------|---------------------------|----------------------------|
| [-1000, +1100]                | [0.0, 1.0]         | 10.0000%                  | Simple 1-year, no deposits |
| [-1000, +1050]                | [0.0, 0.5]         | 10.2500%                  | 6-month: (1.05^2 - 1)*100  |
| [-1000, -500, +1650]          | [0.0, 0.5, 1.0]    | ~10.0000%                 | One mid-year deposit       |
| [-1000, +0]                   | [0.0, 1.0]         | -100.0000%                | Full loss                  |
| [-1000, +1000]                | [0.0, 1.0]         | 0.0000%                   | Break-even                 |

**Rationale**: These test cases are binding. The IRR solver MUST produce these outputs (to 4 decimal places) before merge.

### Edge Cases

- **No capital deployed** (zero initial balance and no deposits): `annualizedReturn` is `null` and omitted from the payload.
- **Sub-day backtest**: IRR is computed normally; the annualized projection may be extremely large — this is correct and not suppressed.
- **Newton-Raphson divergence**: Fallback to bisection. If bisection also fails, `annualizedReturn` is `null`.
- **All cash flows non-negative** (no outflows): No valid IRR; `annualizedReturn` is `null`.
- **Final balance equals all invested capital exactly**: IRR = `0.0000%`.
- **Single long backtest, no deposits**: IRR depends purely on final-to-initial balance ratio and holding duration.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST compute an `annualizedReturn` value (IRR as % per year) for every completed backtest and include it in the `pnlSummary` object of the result payload.
- **FR-002**: The IRR computation MUST treat all DEPOSIT events from `tradeEvents` as timestamped capital outflows. For a `DEPOSIT` event, the `balance` field represents **the amount injected in that event** (not a running account balance), so it is used directly as the outflow magnitude. Each deposit's `rawTimestamp` provides the exact injection time.
- **FR-003**: The initial `account_balance` from the backtest configuration MUST be the first capital outflow at `t = 0` (the backtest start date).
- **FR-004**: The terminal inflow MUST be the `balance` field of the **last** event in the `tradeEvents` array. For all non-DEPOSIT events (ENTRY, EXIT, SAFETY_ORDER, etc.), `balance` represents the **running account equity** after that event — so the last event's `balance` is the final portfolio value at end-of-backtest.
- **FR-005**: If the terminal balance is zero, `annualizedReturn` MUST be `-100.0000`.
- **FR-006**: If no capital was deployed (zero initial balance and no deposits), `annualizedReturn` MUST be `null` and omitted from the payload.
- **FR-007**: The IRR solver MUST use fixed-point arithmetic for all intermediate calculations — no native floating-point.
- **FR-008**: `annualizedReturn` MUST be **persisted** in the database as a raw numeric string with 4 decimal places (e.g., `"10.0000"`, **not** `"10.0000%"`). In API responses (live SSE stream and result payloads), it is transmitted as a `number` (matching the conventions of `roi`, `maxDrawdown`, and `totalFees` in the same object). The `%` symbol is strictly the responsibility of the UI and Grafana formatting layers.
- **FR-009**: The Grafana sweep leaderboard dashboard (`04-sweep-leaderboard.json`) MUST be updated with: (a) "Best Annualized Return" and "Avg Annualized Return" stat panels mirroring the existing Best ROI / Avg ROI stat panels, and (b) an `Annualized Return %` column in the Run Leaderboard table. `annualized_return` is queried from `sweep_run_summaries` only (no ClickHouse wide-events schema change). Wide-event dashboards that need the value MUST access it via a JOIN to `sweep_run_summaries`.
- **FR-010**: The single-run detail view UI MUST display `annualizedReturn` labeled as "Annualized Return (IRR)" next to existing metrics. When `null`, the display value MUST be `"N/A"`.
- **FR-011**: The run card and execution list view MUST display `annualizedReturn` when present. When `null` or absent, show `"N/A"`.
- **FR-012**: The optimizer sweep leaderboard UI MUST display `annualizedReturn` per run. When `null`, show `"N/A"`.
- **FR-013**: When IRR cannot be computed (per FR-006 or solver failure), `annualizedReturn` is `null` and the API must still return successfully with all other fields intact.
- **FR-014**: The run-overview dashboard (`01-run-overview.json`) and promoted-comparison dashboard (`04-sweep-promoted-comparison.json`) MUST display `annualizedReturn` alongside `roi` wherever ROI is currently displayed.

### Key Entities

- **Cash Flow Series**: Ordered (timestamp, amount) pairs — initial balance and all DEPOSIT events as outflows, terminal balance as inflow.
- **IRR (Internal Rate of Return)**: Annualized discount rate making NPV of Cash Flow Series = 0. Expressed as % per year.
- **Terminal Value**: Final account balance — last `balance` field in `tradeEvents`.
- **Annualized Return**: The single new metric added to `pnlSummary`; equals IRR * 100.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `annualizedReturn` is present and within `0.0001%` of the exact IRR in 100% of completed backtest results where capital was deployed.
- **SC-002**: The Newton-Raphson solver converges within 100 iterations for all 5 canonical test cases listed above.
- **SC-003**: All existing unit and integration tests continue to pass (zero regressions).
- **SC-004**: The optimizer leaderboard UI renders `annualizedReturn` for all runs in a session result.
- **SC-005**: `annualized_return` is a queryable column on `sweep_run_summaries`; Grafana leaderboard shows "Best Annualized Return" and "Avg Annualized Return" stat panels plus a leaderboard table column.
- **SC-006**: The feature is additive only — no breaking changes to existing API consumers.
- **SC-007**: All UI components display `"N/A"` (not `0`, not blank) when `annualizedReturn` is `null` or absent.
- **SC-008**: No columns are added to the `sweep_wide_events` ClickHouse table; wide-event Grafana panels that need `annualized_return` access it via JOIN to `sweep_run_summaries`.

---

## Assumptions

- The `rawTimestamp` field on every `StoredTradeEvent` is a valid ISO 8601 UTC timestamp. Time differences for IRR are measured in fractional years (days / 365.25).
- **`balance` field semantics differ by event type**: For `eventType: "DEPOSIT"`, `balance` is the **injection amount** for that single deposit event (e.g., `250` means 250 units of quote currency were injected). For all other event types (ENTRY, EXIT, SAFETY_ORDER, etc.), `balance` is the **running account equity** after that event. The IRR computation relies on these two distinct interpretations: DEPOSIT.balance → outflow magnitude; last-event.balance → terminal inflow.
- The last event in `tradeEvents` always carries the final account balance in its `balance` field — an existing contract upheld by the Go engine.
- The backtest `start_date` config field anchors `t = 0` for the initial balance cash flow.
- For sweep runs, `annualizedReturn` is computed immediately after the engine emits its final `result` line and before persistence.

---

## Clarifications

### Session 2026-04-06

- Q: For `DEPOSIT` events, does `balance` mean the injection amount or the running account balance? And for the final event, does `balance` mean the terminal portfolio value? → A: Yes — the `balance` field has dual semantics by event type. `DEPOSIT.balance` = injection amount (outflow magnitude). All other events' `balance` = running account equity; therefore the last event's `balance` = terminal inflow. These two interpretations must not be conflated in the IRR computation.
- Q: Should `annualizedReturn` be serialised as a bare numeric string ("10.0000") or include the percent symbol ("10.0000%")? → A: Bare numeric string, no percent symbol — formatting is solely the responsibility of the UI and Grafana layers. Matches existing `roi`, `maxDrawdown`, and `totalFees` conventions in the same object.
- Q: Should `annualized_return` be added as a column to the `sweep_wide_events` ClickHouse table, or kept in `sweep_run_summaries` and accessed via JOIN? → A: Join-only — keep in `sweep_run_summaries`; Grafana wide-event panels access via JOIN. No ClickHouse schema migration required.
- Q: When `annualizedReturn` is `null` (solver failed, no capital, sub-day), what should all UI components display? → A: Display `"N/A"` across all components (RunCard, PnlSummary, sweep leaderboard table, optimizer quant matrix).
- Q: Should the Grafana leaderboard get dedicated stat panels for "Best Annualized Return" and "Avg Annualized Return" (mirroring existing Best ROI / Avg ROI), or only a column in the table? → A: Add both stat panels and a leaderboard table column, mirroring the existing ROI stats layout.
- Q: Should `annualizedReturn` appear in the run-overview (`01-run-overview.json`) and promoted-comparison (`04-sweep-promoted-comparison.json`) Grafana dashboards? → A: Yes — add alongside `roi` in both dashboards wherever ROI is currently displayed.