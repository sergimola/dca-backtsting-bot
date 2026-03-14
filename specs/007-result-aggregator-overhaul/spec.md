# Feature Specification: Result Aggregator Overhaul

**Feature Branch**: `007-result-aggregator-overhaul`  
**Created**: 2026-03-13  
**Status**: Draft  
**Input**: User description: "Overhaul the ResultAggregator to use incremental Trade IDs, calculate Gross vs. Net profit per trade, fix the Safety Order 0 bug, and redesign the React Accordion to display these professional metrics."

**Constitution Gates (MANDATORY)**:
- **Green Light Protocol**: All existing tests must remain green; new BDD scenarios added for trade grouping logic, gross/net profit calculation, and safety order chart data must pass before merge.
- **Fixed-point arithmetic**: All monetary calculations (fee summation, gross profit derivation) MUST use `Decimal.js` arithmetic — no native JS floating-point math.
- **BDD acceptance criteria**: Given/When/Then scenarios are provided in each User Story below covering the three core invariants: trade ID sequencing, profit decomposition, and safety order chart correctness.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reliable Trade Numbering (Priority: P1)

A user runs a backtest and views the results. Each completed trade in the accordion should be labelled "Trade #1", "Trade #2", etc., in strict chronological order — regardless of how the Go engine internal IDs are structured. The user needs this to cross-reference trades with their own notes and to discuss results unambiguously.

**Why this priority**: Trade identification is the foundation for every other metric displayed in the accordion and is required before gross/net profit labelling makes sense.

**Independent Test**: Run a backtest producing 5 trades. The accordion must show Trade #1 through Trade #5 in order. Trade labels must not skip numbers, repeat, or include engine-internal identifiers.

**Acceptance Scenarios**:

1. **Given** a completed backtest with 3 `PositionOpened` events in the event stream, **When** the results accordion is rendered, **Then** exactly 3 trade accordions appear labelled "Trade #1", "Trade #2", and "Trade #3" in chronological order.
2. **Given** the Go engine emits `trade_id` values that are UUIDs or non-sequential numbers, **When** trade IDs are assigned on the frontend, **Then** the displayed trade labels are still sequential integers starting at 1, ignoring the engine-provided value.
3. **Given** a second backtest is run in the same browser session, **When** the new results are displayed, **Then** the trade counter resets to 1 for the new result set.

---

### User Story 2 - Gross vs. Net Profit Breakdown Per Trade (Priority: P1)

A user wants to understand the true cost of each trade. For each accordion entry the user must see three distinct monetary values: the gross profit (before fees), the total fees paid on that trade, and the net profit (after fees). This allows them to judge whether the DCA strategy is profitable on a fee-adjusted basis.

**Why this priority**: Without the gross/net split, users cannot distinguish genuine strategy underperformance from excessive fee drag. This is the most analytically valuable change in this overhaul.

**Independent Test**: Open a single trade accordion for a trade with a known entry fee, one safety order fee, and an exit fee. Verify that Gross = Net + Fees, and that all three values are displayed in the accordion header with the correct sign and colour.

**Acceptance Scenarios**:

1. **Given** a closed trade where the Go engine reports Net Profit of `-$2.50` and the events carry fees of `$0.80` total, **When** the accordion header is rendered, **Then** it displays `Gross: -$1.70 | Fees: -$0.80 | Net: -$2.50`.
2. **Given** a closed trade where Net Profit is `+$5.00` and total fees are `$1.20`, **When** the accordion header is rendered, **Then** "Net" is coloured green and the header shows `Gross: +$6.20 | Fees: -$1.20 | Net: +$5.00`.
3. **Given** a trade with Net Profit of `-$3.00`, **When** the accordion header is rendered, **Then** "Net" is coloured red.
4. **Given** a trade whose exit event (`PositionClosed`) has not yet appeared in the stream (open position), **When** the accordion header is rendered, **Then** the Gross and Net fields display a placeholder (e.g., "–") rather than an incorrect zero.
5. **Given** fee values across entry, safety orders, and exit, **When** total fees are summed, **Then** the result is computed using exact decimal arithmetic with no floating-point rounding error.

---

### User Story 3 - Correct Safety Order Usage Chart (Priority: P2)

A user views the "Safety Order Usage" bar chart after a backtest. The chart must show only actual DCA buy orders (not the initial entry), and the X-axis must start at level 1 (SO1), not level 0. This lets the user identify which safety order levels are triggered most often.

**Why this priority**: The current "SO0" bar pollutes the chart with meaningless data (the entry order) and shifts all real safety order levels by one visual position, making the chart untrustworthy.

**Independent Test**: Run a backtest where SO1 fires 3 times and SO2 fires 1 time. The chart must show two bars: SO1=3 and SO2=1. No SO0 bar must appear.

**Acceptance Scenarios**:

1. **Given** a backtest with entry orders (`PositionOpened`) and safety orders (`BuyOrderExecuted`), **When** safety order usage counts are computed, **Then** `PositionOpened` events are explicitly skipped and never added to the safety order usage data — even if the engine attaches an index field to them.
2. **Given** a `BuyOrderExecuted` event whose payload identifies it as the first safety order level, **When** the chart data is built, **Then** it is recorded under key `1` (SO1), not `0`.
3. **Given** a backtest where only SO1 and SO3 were ever triggered, **When** the chart is rendered, **Then** the X-axis shows levels 1 through 3 (or up to the configured maximum), with SO2 showing 0 and no SO0 column present.
4. **Given** a backtest with no safety orders triggered at all, **When** the chart is rendered, **Then** the chart shows no bars (or all bars at zero) and no SO0 entry is injected.
5. **Given** the previous implementation that counted `PositionOpened` as a safety order, **When** the fix is applied, **Then** the total safety order count decreases by the number of trades (one `PositionOpened` removed per trade).

---

### User Story 4 - Legible Accordion Header and Accurate P&L Label (Priority: P3)

A user reading the results page must immediately understand what each number means. The accordion headers must use a consistent gray/slate visual style with high-contrast pill labels. The main summary metric must be explicitly labelled "Total Net P&L" so users understand that fees have already been deducted from the displayed figure.

**Why this priority**: Cosmetic but trust-critical — mislabelled P&L causes user confusion; poor contrast makes the interface inaccessible.

**Independent Test**: Load results page and visually verify (or a snapshot test) that: (1) accordion headers are slate-coloured with no coloured backgrounds, (2) pill text passes a 4.5:1 contrast ratio, (3) the summary card heading reads "Total Net P&L".

**Acceptance Scenarios**:

1. **Given** the results page is rendered, **When** the user views any trade accordion header, **Then** the header background is gray/slate and no coloured background is applied to the header bar itself.
2. **Given** the results page is rendered, **When** the user reads the main P&L summary card, **Then** the label reads "Total Net P&L" (not "Total P&L" or "Realised P&L").
3. **Given** any status pill (e.g., ENTRY, SAFETY_ORDER, EXIT) inside an accordion row, **When** the user reads the text, **Then** the text colour contrasts sufficiently against the pill background to be legible.

---

### Canonical Test Data & Mathematical Proofs

The following table provides binding test cases for the profit decomposition logic. All values are expressed as exact decimals. Implementations MUST produce these exact outputs.

| Input State | Action | Expected Exact Value (Decimal) | Notes |
|-------------|--------|--------------------------------|-------|
| Net Profit = `2.50000000`, Entry fee = `0.30000000`, SO1 fee = `0.25000000`, SellOrderExecuted fee = `0.20000000` | Compute Gross Profit | `3.25000000` | Gross = Net + entry_fee + SO fees + SellOrderExecuted.fee |
| Net Profit = `-5.00000000`, Total fees = `1.50000000` | Compute Gross Profit | `-3.50000000` | Gross is less negative than Net |
| Net Profit = `0.00000000`, Total fees = `0.80000000` | Compute Gross Profit | `0.80000000` | Break-even net means positive gross |
| 3 trades: Net = `+2.00`, `-1.50`, `+0.75` | Compute Total Net P&L | `1.25000000` | Summation of net profits |
| Entry fee (PositionOpened) = `0.1`, SO1 fee (BuyOrderExecuted) = `0.2`, SO2 fee (BuyOrderExecuted) = `0.3`, Exit fee (SellOrderExecuted) = `0.15` | Sum trade total fees | `0.75000000` | Decimal add, no float drift; SellOrderExecuted is the exit fee source |

### Edge Cases

- What happens when a `PositionOpened` event appears without a subsequent `PositionClosed`? The trade is treated as open; gross/net profit display a placeholder, fees are still summed from available events.
- What happens when the event stream contains zero `BuyOrderExecuted` events (no safety orders fired)? The safety order chart renders with all counts at zero; no SO0 entry is created.
- What happens when two `PositionOpened` events appear with identical engine-provided `trade_id` values? The incremental counter still assigns distinct sequential IDs; grouping is driven solely by the counter, not the engine ID.
- What happens when fee fields are absent or null on an event? Missing fees are treated as zero; they do not break the summation.
- What happens when a `BuyOrderExecuted` event has a safety order index of 0 (legacy data)? The system maps index 0 to level 1 so that displayed levels always start at 1.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The results processing layer MUST maintain its own sequential trade counter that increments by 1 each time a `PositionOpened` event is encountered, and assign this integer as the trade identifier for all UI grouping purposes.
- **FR-002**: The results processing layer MUST ignore the `trade_id` field emitted by the Go engine when grouping or labelling trades in the UI.
- **FR-003**: For each grouped trade, the system MUST calculate Trade Total Fees using the following explicit formula:
  `Trade Total Fees = PositionOpened.entry_fee + SUM(BuyOrderExecuted.fee for all safety orders in the trade) + SellOrderExecuted.fee`
  where `SellOrderExecuted` is the exit-fill event accompanying the `PositionClosed` event.
- **FR-004**: For each grouped trade, the system MUST calculate Trade Gross Profit using the following explicit formula:
  `Trade Gross Profit = PositionClosed.profit + PositionOpened.entry_fee + SUM(BuyOrderExecuted.fee) + SellOrderExecuted.fee`
  This reconstructs the gross (pre-fee) profit from the net profit reported by the engine.
- **FR-005**: The trade accordion header MUST display the trade label, gross profit, total fees (as a negative value), and net profit in the format: `Trade #X  |  Gross: +$X.XX  |  Fees: -$Y.YY  |  Net: ±$Z.ZZ`.
- **FR-006**: Net profit in the accordion header MUST be coloured green when it is greater than zero and red when it is less than or equal to zero.
- **FR-007**: `PositionOpened` events MUST NOT contribute to the safety order usage counts used by the safety order chart.
- **FR-008**: `BuyOrderExecuted` events MUST be counted in the safety order usage chart; the safety order level displayed MUST be 1-based (the first safety order level maps to level 1 on the chart X-axis).
- **FR-009**: The safety order usage chart X-axis MUST start at 1; no level-0 column may appear.
- **FR-010**: All fee summation and profit arithmetic MUST use exact decimal arithmetic — no native floating-point operations.
- **FR-011**: The accordion header background and styling MUST use a consistent gray/slate colour scheme with no trade-status-dependent background colours on the header bar.
- **FR-012**: The main P&L summary metric label MUST read "Total Net P&L" to communicate that displayed figures are fee-adjusted.
- **FR-013**: Pill labels inside accordion rows (e.g., ENTRY, SAFETY_ORDER, EXIT) MUST have sufficient text-to-background contrast to be legible.

### Key Entities

- **Trade Group**: A sequence of events (entry, zero or more safety orders, optional exit) belonging to one DCA cycle. Identified by a sequential integer trade number assigned during result processing, independent of any engine-provided ID.
- **Trade Gross Profit**: The profit earned before fees are deducted. Computed as: `PositionClosed.profit + PositionOpened.entry_fee + SUM(BuyOrderExecuted.fee) + SellOrderExecuted.fee`. Expressed as an exact decimal.
- **Trade Net Profit**: The fee-adjusted profit as reported by the Go engine in the `PositionClosed` event. The authoritative source of truth for realised gain/loss.
- **Trade Total Fees**: Sum of fees from three event types: `PositionOpened.entry_fee`, all `BuyOrderExecuted.fee` values, and `SellOrderExecuted.fee`. Always expressed as a positive magnitude; displayed with a leading negative sign in the UI.
- **Safety Order Usage Count**: A 1-indexed map from safety order level (1, 2, 3, …) to the number of times that level was triggered across all trades. Entry orders never contribute to this map.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every trade in the results accordion is labelled with a unique sequential integer starting at 1; no trade label is duplicated, skipped, or sourced from the engine-internal ID.
- **SC-002**: For every closed trade, the displayed Gross Profit equals displayed Net Profit plus displayed Fees (to at least 8 decimal places), verifiable by automated test.
- **SC-003**: The safety order usage chart contains no level-0 column in any backtest result; all levels start at 1.
- **SC-004**: The main summary heading reads "Total Net P&L" with no abbreviation or alternative wording.
- **SC-005**: All accordion header backgrounds are gray/slate; no trade produces a differently coloured accordion header bar.
- **SC-006**: All existing automated tests continue to pass after the changes are applied (Green Light Protocol satisfied).
- **SC-007**: The gross/net/fee arithmetic test cases in the Canonical Test Data table above produce the specified exact decimal outputs in automated unit tests.

## Assumptions

- The Go engine's `PositionClosed` event always carries a `profit` field that represents the net (fee-adjusted) profit for the completed trade. This is the authoritative Net Profit source; gross profit must be mathematically reconstructed from it.
- Exit fees are **not** carried on the `PositionClosed` event itself. They are captured from the `SellOrderExecuted` event that accompanies the position close, and MUST be included when computing Trade Total Fees and Trade Gross Profit.
- Entry fees are available on the `PositionOpened` event as `entry_fee`.
- Safety order fees are available on each `BuyOrderExecuted` event as a `fee` field.
- `PositionOpened` events MUST be explicitly excluded from safety order usage counts. The previous implementation incorrectly counted them; the fix requires an active type-guard (`if event.type !== 'PositionOpened'`) rather than a simple index offset.
- Safety order level is conveyed by an index field on `BuyOrderExecuted`. This index is 1-based in the current engine; if legacy data carries a 0-based index, the UI adds 1 to normalise it.
- Open trades (no `PositionClosed` yet seen) are shown with dashes for gross/net profit values rather than being hidden or erroring.
