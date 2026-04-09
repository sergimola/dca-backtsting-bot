# Feature Specification: Unified ROI Calculation

**Feature Branch**: `021-roi-unification`  
**Created**: 2026-04-07  
**Status**: Draft  
**Input**: User description: "The ROI needs to be calculated in every single place using the same formula: it needs to consider the total amount added, that is initial amount + monthly additions. Take the opportunity to make sure the code is more maintainable and we don't duplicate the code all over the place. Ideally we would have a single place where ROI is calculated for single executions full dashboard, list of single executions and sweeps leaderboard. The annual rate in the single execution and the sweep leaderboard (in each row) need to match also."

**Constitution Gates (MANDATORY)**:
- **Green Light Protocol**: All existing unit and integration tests must pass. New tests for the shared ROI utility must be added before merging.
- **Fixed-point arithmetic**: ROI computation in the shared utility must use `Decimal.js` (frontend) to avoid floating-point precision errors when computing the denominator. No raw JS `number` division for ROI.
- **BDD acceptance criteria**: Provided in User Stories below. Every covered context (dashboard, run list, sweep leaderboard) has a Given/When/Then scenario proving ROI and annualized return are identical for the same input data.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Single Run Dashboard Shows Correct ROI (Priority: P1)

A user runs a backtest with an initial balance of $1,000 and $200/month additions over 12 months.
When they open the full dashboard for that run, the ROI displayed must account for all $2,400 of
additional capital injected ($200 × 12), not just the $1,000 starting balance.

> **Note**: The numbers in this narrative are illustrative only. The canonical test cases in the
> Mathematical Proofs table below are the binding specification for implementers.

**Why this priority**: This is the most visible surface (full backtest dashboard). Currently the
frontend re-computes ROI using only the initial balance, making it disagree with the engine's own
ROI value whenever monthly additions are configured. This misleads users into thinking they earned
more % return than they actually did.

**Independent Test**: Can be fully tested by running a backtest with `monthly_addition > 0`, then
comparing the ROI shown on the full dashboard against the engine's `pnlSummary.roi` value. Both
must be identical.

**Acceptance Scenarios**:

1. **Given** a completed single backtest with initial balance B and monthly additions totaling D, **When** the user opens the full results dashboard, **Then** the displayed ROI equals `netProfit / (B + D) × 100`, matching the engine's reported ROI.
2. **Given** a completed backtest with monthly additions of zero, **When** the user opens the full results dashboard, **Then** the displayed ROI equals `netProfit / B × 100`, unchanged from current behavior.
3. **Given** a completed backtest with no trade events (list-view fallback), **When** the user opens the full results dashboard, **Then** the ROI shown equals the engine's `pnlSummary.roi` directly.

---

### User Story 2 - Run List Rows Show Correct ROI (Priority: P2)

A user looks at the list of all their runs. Each run card shows a quick ROI figure. For runs
configured with monthly capital additions, that figure must use the same denominator as the
engine — it must not overstate ROI by ignoring injected capital.

**Why this priority**: Even if the full dashboard is fixed, users comparing runs side-by-side via
the list rely on per-row ROI. If the list overstates ROI relative to the sweep leaderboard, users
pick the wrong configurations.

**Independent Test**: Run a single backtest with `monthly_addition > 0`. The ROI shown on the run
card in the list must equal the engine's `pnlSummary.roi` for that run.

**Acceptance Scenarios**:

1. **Given** a completed run with monthly additions, **When** the user views the run list, **Then** each run card's ROI value equals `netProfit / (initialBalance + totalAdditions) × 100`.
2. **Given** a completed run whose trade events list is empty (list-view omission mode), **When** the user views the run list, **Then** the run card falls back to `pnlSummary.roi` from the engine without re-deriving the value locally.

---

### User Story 3 - Sweep Leaderboard ROI Matches Single-Run ROI (Priority: P2)

A user promotes a sweep result into a single detailed run. The ROI shown in the sweep leaderboard
row for that configuration must equal the ROI shown when the promoted run completes on the full
dashboard. There must be no numeric discrepancy between the two views.

**Why this priority**: If an optimizer result claims 12% ROI but the promoted detailed run shows 8%,
trust in the optimizer is destroyed. Both must derive ROI with the same formula over the same
capital base.

**Independent Test**: Run a sweep with `monthly_addition > 0`. Pick any result row. Note its ROI.
Promote it to a single detailed run. Compare the two ROI figures — they must agree within rounding.

**Acceptance Scenarios**:

1. **Given** a sweep result row with some ROI value, **When** the user promotes that configuration to a detailed run, **Then** the detailed run's dashboard ROI agrees with the leaderboard row ROI within ±0.01%.
2. **Given** multiple sweep result rows with varying initial balances but the same monthly addition, **When** the leaderboard is displayed, **Then** each row's ROI uses the correct per-run denominator `(balance + totalAdditions)`.

---

### User Story 4 - Annualized Return Consistent Across All Surfaces (Priority: P3)

A user compares the annualized return (annual rate) shown on the single-run dashboard against the
annualized return shown for the matching configuration in the sweep leaderboard. Both must produce
the same value.

**Why this priority**: The annualized return is derived from ROI and total capital. If the capital
base used for the IRR calculation differs between the two surfaces, the annual rates diverge even
though both use the same `computeAnnualizedReturn` function.

**Independent Test**: Run a sweep, note the annualized return for a configuration. Promote it to a
detailed run. The full dashboard's annualized return must match the leaderboard row's value within
±0.1%.

**Acceptance Scenarios**:

1. **Given** a sweep result with a known annualized return, **When** that exact configuration is executed as a single detailed run, **Then** the dashboard's annualized return equals the sweep leaderboard row's annualized return.
2. **Given** a run without monthly additions, **When** both the dashboard and leaderboard show annualized return, **Then** both values remain equal (regression: no changes to the zero-addition case).

---

### Canonical Test Data & Mathematical Proofs

The canonical ROI formula is defined in the Go engine (`cmd/engine/aggregator.go` line 137-141):

> `ROI = (realizedPnl + unrealizedPnl) / (accountBalance + totalAdditions) × 100`

All frontend and backend re-derivations of ROI must produce the same result as this formula.

| Scenario | initialBalance | totalAdditions | netProfit | Expected ROI | Notes |
|----------|---------------|----------------|-----------|--------------|-------|
| No additions | `1000.00` | `0.00` | `50.00` | `5.0000%` | Baseline: denominator = initial only |
| With additions | `1000.00` | `200.00` | `50.00` | `4.1667%` | Denominator widens; ROI drops vs baseline |
| With additions | `1000.00` | `1200.00` | `200.00` | `18.1818%` | 12 months × $100/month |
| Zero balance | `0.00` | `0.00` | `0.00` | `0.0000%` | Guard: no division by zero |
| Additions only | `0.00` | `500.00` | `25.00` | `5.0000%` | Denominator = additions alone |

**Annualized return test case** (used to verify single-run and sweep produce identical values):

| initialBalance | totalAdditions | netProfit | durationDays | Expected annualizedReturn (approx) |
|---------------|----------------|-----------|--------------|-------------------------------------|
| `1000.00` | `200.00` | `50.00` | `365` | ≈ `4.16%` (same as annual ROI for 1-year run) |
| `1000.00` | `200.00` | `50.00` | `182` | ≈ `8.47%` (compounded to annual rate) |

### Edge Cases

- **Zero initial balance with additions only**: denominator = `totalAdditions`; no divide-by-zero.
- **Zero both initial and additions**: ROI = 0, annualized return = 0; no error thrown.
- **Trade events list is empty** (list-view omission): fall back to `pnlSummary.roi` from the engine; do not re-derive.
- **Monthly addition configured but no DEPOSIT events emitted** (e.g., run ended before first injection date): `totalAdditions = 0`; formula reduces to `netProfit / initialBalance`.
- **Negative net profit**: formula holds; ROI is negative; annualized return is negative.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST define a single shared ROI utility (frontend-only) that accepts `(netProfit, initialBalance, totalAdditions)` and returns `netProfit / (initialBalance + totalAdditions) × 100`, handling the zero-denominator edge case.
- **FR-002**: The single-run full dashboard MUST consume `pnlSummary.roi` from the engine as the authoritative ROI value; local re-derivation from `netProfit / accountBalance` is removed. The shared utility is used only as a fallback when `pnlSummary.roi` is absent.
- **FR-003**: The run list view (RunCard, metricsCalculator) MUST consume `pnlSummary.roi` directly from the engine; local ROI re-derivation in the list layer is removed entirely. When `tradeEvents` is empty, `pnlSummary.roi` remains the source (no change in behavior).
- **FR-004**: The sweep leaderboard rows MUST display `pnlSummary.roi` as sourced from the engine; no additional local re-derivation is permitted in the leaderboard rendering path.
- **FR-005**: The annualized return computation MUST use the same total capital base (`initialBalance + totalAdditions`) in both the single-run post-processing path and the sweep post-processing path. The orchestrator TS paths (BackgroundWorker.ts, optimizer.routes.ts) already satisfy this requirement and are out of scope for this feature.
- **FR-006**: All frontend sites that compute `roi = netProfit / someBalance` MUST be removed or replaced. The orchestrator TS layer is out of scope. Tracking, sorting, and comparison of existing roi values are not affected.
- **FR-007**: The shared utility MUST use fixed-point arithmetic (no raw floating-point division) for the ROI computation.
- **FR-008**: All existing automated tests that depend on the old frontend ROI formula (dividing by `accountBalance` alone) MUST be updated to reflect the correct denominator.
- **FR-009**: New unit tests MUST cover the shared utility for all canonical test cases in the table above, including the zero-denominator edge case.

### Key Entities

- **ROI Shared Utility**: A pure, side-effect-free function exposed from a single module. Takes `(netProfit, initialBalance, totalAdditions)` and returns the ROI percentage as a `Decimal`-safe value.
- **Total Capital Base**: `initialBalance + totalAdditions`. The denominator used by both the ROI formula and the final-equity calculation that feeds the annualized return (IRR) solver.
- **pnlSummary.roi**: The authoritative ROI value produced by the Go engine. Frontend views that have access to it SHOULD consume it directly rather than re-deriving.
- **annualizedReturn**: Computed from `(initialBalance, tradeEvents/cashflows, finalEquity)`. `finalEquity = totalCapital × (1 + roi/100)`. Consistency requires both surfaces use the same `totalCapital`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For any backtest with monthly additions > 0, the ROI displayed on the full single-run dashboard equals the engine's `pnlSummary.roi` to within ±0.01% (rounding only).
- **SC-002**: For any backtest with monthly additions > 0, the ROI displayed on the run list card equals the engine's `pnlSummary.roi` to within ±0.01%.
- **SC-003**: For any sweep configuration promoted to a single detailed run, the annualized return shown on the detailed run dashboard matches the annualized return shown in the sweep leaderboard row for that configuration to within ±0.1%.
- **SC-004**: Zero sites that compute `roi = netProfit / denominator` exist outside the shared utility after implementation (verified by code search). `maxRoi` comparison and tracking logic is excluded from this count.
- **SC-005**: All automated tests pass without modification to expected ROI values (tests updated where the old formula was wrong, not where it was right).
- **SC-006**: The shared utility has 100% branch coverage in its unit tests, including the zero-denominator guard.

## Clarifications

### Session 2026-04-07

- Q: Should the shared ROI utility scope be frontend-only, or must it also replace duplicated finalEquity logic in the orchestrator TS layer (BackgroundWorker.ts, optimizer.routes.ts)? → A: Frontend-only. The orchestrator paths already use the correct denominator (`accountBalance + totalDeposits`). They are out of scope; touching them adds risk with no user-visible benefit.
- Q: In the run list view (RunCard / metricsCalculator), when tradeEvents are present, should the ROI be re-derived locally using the shared utility, or should it always consume `pnlSummary.roi` directly from the engine? → A: Always consume `pnlSummary.roi` directly. The engine is the authoritative source; re-deriving in the list adds complexity and another potential divergence point. Local re-derivation in RunCard and metricsCalculator is removed entirely.
- Q: The sweep path synthesizes DEPOSIT events from config when tradeEvents are empty; the single-run path uses actual DEPOSIT events. Should the spec require a unified deposit source, or is ±0.1% tolerance sufficient? → A: ±0.1% tolerance (SC-003) is sufficient. Changing the deposit-sourcing strategy is out of scope. Both paths are correct by design; exact parity is not required.
- Q: For the full dashboard, should it always consume `pnlSummary.roi` as authoritative (no re-derivation), or independently recompute as a cross-check? → A: Consume `pnlSummary.roi` as authoritative. The shared utility is used only as a fallback when `pnlSummary.roi` is absent, which should not occur in practice.
- Q: Does SC-004 ("zero ROI calculation sites outside the shared utility") include maxRoi comparison/tracking logic in optimizer.routes.ts? → A: No. SC-004 applies only to sites that compute `roi = netProfit / denominator`. Tracking, sorting, and comparison of existing roi values are explicitly excluded.
