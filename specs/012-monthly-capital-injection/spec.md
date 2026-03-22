# Feature Specification: Restoring Monthly Capital Injection (DCA Savings)

**Feature Branch**: `012-monthly-capital-injection`  
**Created**: 2026-03-16  
**Status**: COMPLETE (2026-03-22) — All 8 user stories implemented and Green Light verified (US1–US7 prior; US6 TS layer + US8 TradingTimeline completed 2026-03-22)  
**Input**: User description: "Feature 012: Restoring Monthly Capital Injection (DCA Savings) — Wire the `monthly_addition` parameter from the UI down to the Go engine, and ensure the Orchestrator maintains a continuous running balance across the entire backtest timeline."

**Constitution Gates (MANDATORY)**:
- **Green Light Protocol**: All existing unit and integration tests across the Go core-engine, the TypeScript orchestrator API, and the React frontend must remain green after implementation. New tests must cover: the Orchestrator 43,200-candle tick, trade carryover balance arithmetic, and the `MonthlyAdditionEvent` emission. No merge is permitted with any failing test.
- **Fixed-point arithmetic**: All monetary computations — monthly addition applications, running balance updates, realized profit carry-over — MUST use `decimal.Decimal` (shopspring/decimal) in Go and string-decimal representation across the API boundary. No JavaScript `Number` arithmetic is introduced for monetary values. The existing `validateDecimal` utility governs TypeScript-side validation.
- **BDD acceptance criteria**: Covered per user story below. All seven architectural layers have corresponding BDD scenarios: UI form field, API validation, Go engine config, Orchestrator state machine, PSM cleanup, Aggregator ROI correction, and UI display pipeline (DEPOSIT ledger + account equity).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Simulate 3 Years of DCA Savings with Monthly Top-Ups (Priority: P1)

A quantitative analyst wants to model a disciplined DCA savings strategy: they start with a base account balance and automatically add a fixed USDT amount every month throughout the backtest period. They enter their parameters in the configuration form, run the backtest, and the results accurately reflect the compounded effect of both trade profits and the periodic capital injections.

**Why this priority**: This is the core user need the feature was designed to solve. Without it, the product can only simulate a static initial balance, which does not reflect how real DCA savers operate. Everything else in this spec exists to support this scenario correctly.

**Independent Test**: Can be fully tested by submitting a backtest with `monthly_addition = "500"` over a 90-day date range (≥ 3 monthly ticks) and verifying that the final account balance is at least `initial_balance + (3 × 500)` plus any realized trade profits. No UI is required — a raw API call is sufficient.

**Acceptance Scenarios**:

1. **Given** a backtest configured with `account_balance = "1000"` and `monthly_addition = "500"` over 91 days, **When** the backtest completes, **Then** at least three `MonthlyAdditionEvent` entries appear in the output, each adding exactly `"500"` to the running balance.
2. **Given** a running backtest where `globalCandleCount` reaches a multiple of 43,200, **When** no position is currently open, **Then** `runningBalance` is incremented by `monthly_addition` and the next opened trade starts with the updated balance.
3. **Given** a running backtest where `globalCandleCount` reaches a multiple of 43,200 and a position IS open, **Then** both `runningBalance` and the open position's `AccountBalance` are incremented by `monthly_addition`, and a `MonthlyAdditionEvent` is appended to the event bus.
4. **Given** a `monthly_addition` of `"0"`, **When** 43,200 candles pass, **Then** no `MonthlyAdditionEvent` is emitted and `runningBalance` is unchanged by the candle boundary.

---

### User Story 2 — Running Balance Carries Realized Profit Forward to the Next Trade (Priority: P2)

After each trade closes, the realized profit (or loss) from that trade is incorporated into the running balance, so that the next trade begins with a growing pool of capital rather than the original starting amount. This enables true compounding across trade cycles.

**Why this priority**: Without carryover, monthly additions would grow the balance but trade profits would be silently discarded between cycles, producing incorrect (understated) simulated returns.

**Independent Test**: Can be fully tested with a two-trade unit test: open a position, close it with a known profit string, verify that `runningBalance` equals `initial_balance + profit`, then open a second position and verify its `AccountBalance` equals `runningBalance`.

**Acceptance Scenarios**:

1. **Given** a position closes with `Profit = "120.50"`, **When** the orchestrator processes the `TradeClosedEvent`, **Then** `orch.runningBalance` increases by exactly `120.50`.
2. **Given** a position closes with a negative profit (loss) of `"-45.00"`, **When** the orchestrator processes the `TradeClosedEvent`, **Then** `orch.runningBalance` decreases by exactly `45.00`.
3. **Given** two consecutive trades each returning `"80.00"` profit, starting from `"1000.00"`, **When** both trades complete, **Then** `orch.runningBalance` equals `"1160.00"` and the second trade opened with `"1080.00"`.

---

### User Story 3 — UI Form Accepts and Sends Monthly Addition Parameter (Priority: P3)

A user fills in the Backtest Configuration form in the React frontend. The form includes a "Monthly Addition (USDT)" field that accepts a non-negative decimal number. The value is included in the API payload as a decimal string when the form is submitted.

**Why this priority**: The full feature is only accessible via the UI. Without the form field, users cannot set the parameter without using raw API calls.

**Independent Test**: Can be fully tested with a React unit test: render `ConfigurationForm` with `monthlyAddition = "250"`, submit the form, and verify the `onSubmit` callback receives `{ ..., monthlyAddition: "250" }`. Additionally, verify that a blank field submits as `"0"`.

**Acceptance Scenarios**:

1. **Given** the configuration form is rendered, **When** the user views it, **Then** a "Monthly Addition (USDT)" numerical input field is present.
2. **Given** the user enters `"500"` in the Monthly Addition field and submits, **When** the API payload is assembled, **Then** it contains `"monthly_addition": "500"`.
3. **Given** the user leaves the Monthly Addition field empty and submits, **When** the API payload is assembled, **Then** it contains `"monthly_addition": "0"`.
4. **Given** the user enters a negative value such as `"-100"`, **When** the field is blurred, **Then** a validation error message "Monthly addition must be >= 0" is displayed and the form cannot be submitted.

---

### User Story 4 — API Validates and Passes monthly_addition Through the Full Stack (Priority: P4)

The orchestrator API accepts `monthly_addition` as an optional field on the `POST /backtests` endpoint, validates it as a non-negative decimal string, defaults it to `"0"` when absent, and forwards it to the Go engine unchanged.

**Why this priority**: Without server-side validation, malformed values such as floats, negative numbers, or non-numeric strings could reach the Go engine and cause a parse error mid-backtest rather than a clear validation response.

**Independent Test**: Can be fully tested with HTTP request tests: (a) omit `monthly_addition` and verify the engine receives `"0"`; (b) send `"250.00"` and verify validated value passes through; (c) send `"-50"` and verify a `400 Bad Request` with a `monthly_addition` field error.

**Acceptance Scenarios**:

1. **Given** a valid backtest request that omits `monthly_addition`, **When** the request is validated, **Then** `monthly_addition` is treated as `"0"` and included in the Go engine invocation.
2. **Given** a request with `monthly_addition = "250.0000"`, **When** validated, **Then** the value passes as a valid decimal string with no error.
3. **Given** a request with `monthly_addition = -50`, **When** validated, **Then** the API returns `400 Bad Request` with an error identifying `monthly_addition` as the invalid field.
4. **Given** a request with `monthly_addition = "abc"`, **When** validated, **Then** the API returns `400 Bad Request` with a decimal parse error on `monthly_addition`.

---

### User Story 5 — PSM No Longer Independently Manages the 30-Day Calendar (Priority: P5)

A developer reviewing the codebase should find that `minute_loop.go` no longer contains a `CandleCount % 43200` monthly trigger. The PSM's `CandleCount` still tracks candles for position-scoped purposes (e.g., days since entry for display), but capital injection is now the Orchestrator's responsibility.

**Why this priority**: This is an internal correctness and maintainability requirement. Leaving the PSM trigger in place while the Orchestrator also fires monthly additions would cause double-injection whenever a position is held across a 30-day boundary.

**Independent Test**: Can be fully tested with a unit test: create a position with `MonthlyAddition = "500"`, process exactly 43,200 candles, and assert that NO `MonthlyAdditionEvent` is emitted by the PSM, and that `pos.AccountBalance` is unchanged from its initial value (injection must only come from the Orchestrator test harness, not the PSM).

**Acceptance Scenarios**:

1. **Given** a `Position` with `MonthlyAddition` set, **When** `ProcessCandle` is called 43,200 times, **Then** the PSM emits no `MonthlyAdditionEvent` and does not modify `AccountBalance` at the 43,200 boundary.
2. **Given** the Orchestrator drives a full 43,200-candle run, **When** the monthly tick fires, **Then** exactly one `MonthlyAdditionEvent` is emitted (from the Orchestrator), not two.
3. **Given** `minute_loop.go` is reviewed, **When** the file is searched for `% 43200`, **Then** no such modulo condition exists in the file.

---

### User Story 6 — Aggregator Computes Correct ROI and Passes DEPOSIT Events Through the Ledger (Priority: P1)

After a backtest with monthly additions completes, the computed ROI percentage correctly accounts for the additional capital that was injected over the course of the run. Without this correction, ROI is overstated because the denominator only reflects the initial balance. Additionally, each `MonthlyAdditionEvent` emitted by the Orchestrator must appear in the output trade ledger as a `DEPOSIT` entry so users can see exactly when and how much capital was injected.

**Why this priority**: This is a correctness bug in the data pipeline. A backtest producing misleading ROI numbers defeats the analytical purpose of the tool. P1 because it affects every backtest that uses `monthly_addition > 0`.

**Independent Test**: Submit a backtest with `account_balance = "1000"`, `monthly_addition = "500"` over 91 days, confirm the response contains ≥ 3 `DEPOSIT` trade events, and confirm that `roi_percent = realizedPnl / (1000 + N×500) × 100` (not `realizedPnl / 1000 × 100`).

**Acceptance Scenarios**:

1. **Given** a completed backtest with `account_balance = "1000"`, `monthly_addition = "500"`, 3 monthly additions applied, and `realizedPnl = "250.00"`, **When** the aggregator computes ROI, **Then** `roi_percent = "10.00"` (250 / 2500 × 100), not `"25.00"` (250 / 1000 × 100).
2. **Given** a backtest with `monthly_addition = "0"`, **When** the aggregator computes ROI, **Then** the formula reduces to `realizedPnl / accountBalance × 100`, identical to the current baseline — no behavioral change.
3. **Given** a completed backtest with 3 `monthly.addition` events each with `addition_amount = "500"`, **When** the aggregator processes the event stream, **Then** the output trade ledger contains 3 `DEPOSIT` entries in chronological order, each with `balance = 500`, `price = 0`, `quantity = 0`, `fee = 0`.
4. **Given** a `monthly.addition` event with an unparseable `addition_amount`, **When** the aggregator encounters it, **Then** it skips that event's contribution to `totalAdditions`, logs a warning, and does not crash.

---

### User Story 7 — UI Trade Ledger and Account Equity Display Monthly Injections (Priority: P3)

A user reviewing their backtest results can see each monthly capital injection as a clearly labelled `DEPOSIT` row in the trade events table. The account equity summary reflects the true total capital deployed — initial balance plus all injections plus net profit — rather than understating it by omitting the injections.

**Why this priority**: The data is available after US6 fixes the pipeline. This story exposes it to the user. P3 because it is a display enhancement; the numbers are already computed correctly by US6.

**Independent Test**: Render the trade events table with 3 `DEPOSIT` rows in the events array and verify each row shows the injected amount in the Balance column and dashes for Price and Quantity. Render the equity summary with `initialBalance = 1000`, `totalAdditions = 1500`, `netProfit = 250` and verify the displayed equity is `2750`.

**Acceptance Scenarios**:

1. **Given** the trade events table receives a `DEPOSIT` event row, **When** it renders, **Then** the Cost/Balance column shows the injected amount, and the Price and Quantity columns show `—` (dash).
2. **Given** the account equity summary receives `initialBalance = 1000`, `totalAdditions = 1500`, `netProfit = 250`, **When** it renders, **Then** the displayed True Account Equity is `2750.00`, not `1250.00`.
3. **Given** no monthly additions were configured (`monthly_addition = "0"`), **When** the equity summary renders, **Then** it displays `Initial Balance + Net Profit` — identical to the current display with no visual regression.

---

### User Story 8 — Backtest Results Timeline Visualizes Capital Injections as First-Class Events (Priority: P2)

A user reviewing completed backtest results sees a vertical timeline that places capital injection events and trade events in chronological order as distinct card types. Capital injections appear as cards on the left side of the timeline showing the injected amount and the cumulative running equity after the injection. Trade events appear on the right side of the timeline showing the trade number, duration, safety-order fill ratio, capital deployed, profit/loss (with fees deducted), trade date range, and running equity after the trade closed. Clicking a trade card expands it to reveal a detailed order-level table showing every ENTRY, SAFETY ORDER, and EXIT event for that trade.

**Why this priority**: Once capital injections appear in the data pipeline (US6/US7), they need a meaningful visual home in the results view. A timeline is the natural representation for a time-series of interleaved deposits and trades, and directly answers "when did my capital grow and by how much?" without users having to mentally reconstruct it from a flat table. The expandable trade card provides the same order-level drill-down capability as the existing events table but in a more navigable format.

**Independent Test**: Render the `TradingTimeline` component with a dataset containing 2 capital injection events and 3 trade events. Verify that 2 capital injection cards and 3 trade cards render in correct chronological order with the correct running equity on each card. No backend required.

**Acceptance Scenarios**:

1. **Given** a completed backtest with 2 capital injections and 3 trades, **When** the results timeline renders, **Then** it shows 5 event cards in chronological order: injection 1, trade 1, injection 2, trade 2, trade 3.
2. **Given** a capital injection card renders, **When** viewed, **Then** it displays: the label "CAPITAL INJECTION", the event timestamp, the injected amount formatted as "+$X,XXX.XX" in a positive color (green), and the running equity immediately after the injection formatted as "Equity: $X,XXX.XX".
3. **Given** a trade card renders in its collapsed state, **When** viewed, **Then** it displays: the trade number badge (e.g., "#1"), a "Trade" label, a duration badge (e.g., "1d 9h 27m"), a safety-order fill ratio badge (e.g., "3/8"), a capital deployed badge (e.g., "$500.00"), the net P&L of the trade colored green for profit or red for loss, the trade open and close timestamps (e.g., "Jan 5, 04:20 PM → Jan 6, 11:15 AM"), and the running equity after the trade closed formatted as "Equity: $X,XXX.XX".
4. **Given** a trade card is in its collapsed state, **When** the user clicks or taps it, **Then** the card expands to reveal a detailed order table with columns: TIME, ACTION, PRICE, QUANTITY, COST/PNL, FEE DEDUCTED — showing every order event for that trade (ENTRY, all SAFETY ORDER rows, EXIT) in chronological order.
5. **Given** an expanded trade card, **When** the user clicks or taps it again, **Then** it collapses back to the summary view.
6. **Given** a backtest configured with `monthly_addition = "0"` (no capital injections), **When** the timeline renders, **Then** only trade cards appear — no capital injection cards are rendered, and the timeline layout remains correct with no visual regressions.
7. **Given** the running equity displayed on trade card #2 in a timeline with 1 prior injection of `"250.00"` and trade #1 P&L of `"45.50"` starting from `"1000.00"`, **When** computed, **Then** the equity equals `"1295.50"` — reflecting initial balance + injection + trade 1 profit, not just the trade's own P&L.
8. **Given** a backtest configured with `initial_balance = "1000"`, **When** the timeline renders, **Then** an initial capital injection card is rendered, and the timeline layout remains correct with no visual regressions.

---

### Canonical Test Data & Mathematical Proofs *(MANDATORY FOR CORE DOMAIN)*

| Input State | Action | Expected Exact Value (Decimal) | Notes |
|---|---|---|---|
| `runningBalance = "1000.00"`, `monthly_addition = "500.00"`, candle 43200 reached | Apply monthly tick | `runningBalance = "1500.00"` | No open position; next trade opens at 1500.00 |
| `runningBalance = "1500.00"`, `pos.AccountBalance = "1450.00"`, candle 86400 reached | Apply monthly tick (with open position) | `runningBalance = "2000.00"`, `pos.AccountBalance = "1950.00"` | Both incremented by exactly 500.00 |
| `runningBalance = "1000.00"`, `TradeClosedEvent.Profit = "87.50"` | Apply carryover | `runningBalance = "1087.50"` | Next trade inherits 1087.50 |
| `runningBalance = "1087.50"`, `TradeClosedEvent.Profit = "-23.00"` | Apply carryover (loss) | `runningBalance = "1064.50"` | Loss subtracts from balance |
| `monthly_addition = "0"`, candle 43200 reached | Check monthly tick gate | No event emitted, `runningBalance` unchanged | Zero guard must be enforced |
| `accountBalance = "1000"`, 3 monthly additions of `"500"` each, `realizedPnl = "250.00"` | Compute ROI | `roi_percent = "10.00"` | Denominator = 1000 + 1500 = 2500; 250/2500×100 = 10.00% |
| `accountBalance = "1000"`, 0 monthly additions, `realizedPnl = "250.00"` | Compute ROI (no additions) | `roi_percent = "25.00"` | Denominator = 1000; baseline behavior unchanged |
| Go engine event `{ type: "monthly.addition", data: { addition_amount: "500", ... } }` | Ledger passthrough | `TradeEventOutput { eventType: "DEPOSIT", balance: 500, price: 0, quantity: 0, fee: 0 }` | DEPOSIT row appears in trade ledger |
| Timeline: `initial_balance = "1000.00"`, injection at t1 `+"1000.00"`, trade 1 closes at t2 with P&L `+"45.50"`, injection at t3 `+"250.00"`, trade 2 closes at t4 with P&L `"-12.25"` | Compute running equity trail | t1 (injection 1): `"1000.00"` → t2 (trade 1 close): `"1045.50"` → t3 (injection 2): `"1295.50"` → t4 (trade 2 close): `"1283.25"` | Each timeline card shows cumulative equity at that point in time |

### Edge Cases

- What happens if `monthly_addition` is `"0"` in the config? → The monthly tick guard (`!monthlyAdd.IsZero()`) must prevent any emission or balance change. No `MonthlyAdditionEvent` should ever be emitted for a zero addition.
- What happens if the backtest is shorter than 43,200 candles (< 30 days)? → No monthly tick fires. The final balance equals the initial balance plus realized trade profits only.
- What happens if the Go engine receives `monthly_addition` as an empty string? → The engine defaults to `decimal.Zero`. The Orchestrator's guard prevents any injection. This must not cause a parse error.
- What happens if `Profit` in `TradeClosedEvent` cannot be parsed as a decimal? → The carryover step must be skipped silently (log a warning), not panic. `runningBalance` is unchanged.
- What happens during the very first candle (candle 1)? → `globalCandleCount` equals 1 after increment. `1 % 43200 != 0`, so no tick fires. The first tick fires only at candle 43,200.
- What happens when there are multiple long-lived positions back-to-back, each spanning more than 30 days? → The global candle count advances monotonically regardless of how many trade cycles have completed. The monthly tick fires correctly at every 43,200-candle boundary across all trades.
- What happens if `monthly_addition = "0"` in the aggregator ROI path? → `totalAdditions` remains `0`. The denominator `accountBalance + totalAdditions` equals `accountBalance`. ROI is numerically identical to the current baseline — no regression.
- What happens if a `monthly.addition` event's `addition_amount` field cannot be parsed as a decimal by the aggregator? → The aggregator must log a warning and skip that event's contribution to `totalAdditions`. It must not throw or return a corrupted result.
- What happens when `DEPOSIT` rows are mixed into the trade events table alongside `ENTRY`/`SAFETY_ORDER`/`EXIT` rows? → The table must render all row types in chronological order. `DEPOSIT` rows show the injected amount in the balance column and dashes for price and quantity. No other row type is affected.
- What happens to the equity display when there are no monthly additions? → `totalAdditions = 0`; the formula `initialBalance + 0 + netProfit` is identical to `initialBalance + netProfit`. No visual change.
- What happens if a trade card has no SAFETY ORDER events (fill ratio 1/N — only the ENTRY order filled)? → The `TradingTimeline` trade card must still render correctly; the expanded detail table shows only the ENTRY and EXIT rows. The minimum possible fill ratio is always 1/N because the ENTRY order is counted as the first filled order.
- What happens if two timeline events share the exact same timestamp (e.g., a capital injection fires at the same candle boundary as a trade close)? → Both cards are rendered in the order they appear in the processed event stream; no de-duplication or merging occurs. The equity trail uses the event stream order to compute running values.
- What happens when a trade card's expanded detail table has a very large number of safety order rows? → The component must render all rows without truncation. Vertical scrolling within the expanded card is acceptable.

## Requirements *(mandatory)*

### Functional Requirements

#### Frontend UI Layer
- **FR-001**: The backtest configuration form MUST include a "Monthly Addition (USDT)" input field that accepts non-negative decimal values.
- **FR-002**: When submitted, the form MUST include `monthly_addition` as a decimal string in the API payload; an empty or blank field MUST be sent as `"0"`.
- **FR-003**: The form MUST display a validation error if a negative value is entered and MUST prevent submission until resolved.
- **FR-004**: The `BacktestFormState` interface MUST include a `monthlyAddition: string` field. The configuration summary panel MUST display the value.

#### API & Database Layer
- **FR-005**: The `ApiBacktestRequest` interface (in both `types/index.ts` and `types/configuration.ts`) MUST include `monthly_addition?: string`.
- **FR-006**: The `validateBacktestRequest` function MUST treat a missing/null `monthly_addition` as `"0"`, validate that a provided value is a non-negative decimal string, and include the resolved value in the returned object.
- **FR-007**: The Drizzle `config` JSONB column already stores the full `ApiBacktestRequest` blob; no schema migration is required. The `monthly_addition` field will be persisted automatically.

#### Go Engine Configuration Layer
- **FR-008**: `EngineRequest` in `main.go` MUST include `MonthlyAddition string \`json:"monthly_addition,omitempty"\``.
- **FR-009**: `buildConfigFromRequest` MUST parse `MonthlyAddition` with `decimal.NewFromString`; an empty string MUST default to `decimal.Zero` without returning an error.
- **FR-010**: `domain/config.Config` already stores and exposes `MonthlyAddition()` as a `decimal.Decimal`; this layer requires no new domain changes.

#### Orchestrator State Management Layer
- **FR-011**: The `Orchestrator` struct MUST include two new fields: `globalCandleCount int64` and `runningBalance decimal.Decimal`.
- **FR-012**: At the start of each `RunBacktest` invocation, `globalCandleCount` MUST be reset to `0` and `runningBalance` MUST be initialised to `config.DomainConfig.AccountBalance()`.
- **FR-013**: Inside the `RunBacktest` candle loop, `globalCandleCount` MUST be incremented for every candle processed, regardless of whether a position is open or closed.
- **FR-014**: When `globalCandleCount % 43200 == 0` AND `monthly_addition > 0`, the system MUST: (a) add `monthly_addition` to `runningBalance`; (b) if a position is open, also add it to `position.AccountBalance`; (c) if a position is open, append a `MonthlyAdditionEvent` to the event bus.
- **FR-015**: When a `TradeClosedEvent` is processed, the Orchestrator MUST parse its `Profit` field and add it to `runningBalance` (negative profits reduce the balance).
- **FR-016**: When opening a new position via `psm.NewPosition`, the Orchestrator MUST set the new position's `AccountBalance` to the current `orch.runningBalance`.

#### PSM Cleanup Layer
- **FR-017**: The `% 43200` modulo check and associated `MonthlyAdditionEvent` emission block in `ProcessCandle` (`minute_loop.go`) MUST be removed.
- **FR-018**: `pos.CandleCount` MUST continue to increment in `ProcessCandle` to preserve position-scoped candle tracking (used for `DaysSinceStart` display and other position-level purposes).

#### Aggregator Layer (`ResultAggregator.ts`)
- **FR-019**: The `aggregateGoEvents` method MUST detect events of type `"monthly.addition"` and accumulate their `data.addition_amount` field into a `totalAdditions` decimal variable. Invalid or unparseable `addition_amount` values MUST be skipped with a warning — not thrown.
- **FR-020**: The ROI calculation in `aggregateGoEvents` MUST use the formula `realizedPnl / (accountBalance + totalAdditions) × 100`. When `totalAdditions` is zero, this is mathematically identical to the current formula, preserving backward compatibility.
- **FR-021**: The event-processing loop that builds the trade ledger (currently in `backtest-api.ts` `getResults`) MUST handle `"monthly.addition"` event type by mapping it to a ledger row with `eventType: "DEPOSIT"`, `balance = addition_amount`, `price = 0`, `quantity = 0`, `fee = 0`. These rows MUST appear in the ledger in chronological order.

#### Frontend Display Layer
- **FR-022**: The trade events table component MUST render `DEPOSIT` event rows without crashing. It MUST display the injected amount in the Cost/Balance column. It MUST render a dash or em-dash (`—`) in the Price and Quantity columns so it is visually clear this is a funding event, not a market trade.
- **FR-023**: The account equity summary component MUST calculate and display True Account Equity as `Initial Balance + Total Additions + Net Profit`. When `totalAdditions = 0`, the result is identical to the current display — no visual regression for backtests without monthly additions.

#### Timeline View Layer
- **FR-024**: The results view MUST include a new `TradingTimeline` component that renders both capital injection events (sourced from `DEPOSIT` ledger rows) and trade summary events in a single vertically scrolling chronological timeline. The existing `TradeEventsTable` component is NOT replaced; both views may coexist in the results page.
- **FR-025**: Capital injection cards MUST display the label "CAPITAL INJECTION", the event timestamp, the injected amount formatted as "+$X,XXX.XX" in green (positive color), and the running cumulative equity at that point in time formatted as "Equity: $X,XXX.XX".
- **FR-026**: Trade summary cards (collapsed state) MUST display: an indexed trade number badge (e.g., "#1"), the label "Trade", a duration badge (e.g., "1d 9h 27m"), a safety-order fill ratio badge (e.g., "3/8" indicating filled-out-of-max), a capital deployed badge (e.g., "$500.00"), the net P&L formatted with sign and dollar amount (green for profit, red for loss), the trade open and close timestamps as a date range, and the running cumulative equity after the trade closed.
- **FR-027**: The running equity displayed on every timeline card MUST be computed incrementally as: `initial_balance + Σ(injection amounts at or before this event) + Σ(trade P&L for all trades closed at or before this event)`. This value MUST be computed using the same fixed-point decimal arithmetic as the rest of the system — no JavaScript `Number` arithmetic for monetary values.
- **FR-028**: Trade summary cards MUST support expand/collapse interaction. Clicking or tapping a collapsed trade card expands it to reveal the order detail table. Clicking or tapping an expanded card collapses it back to the summary view.
- **FR-029**: The expanded trade detail table MUST include the following columns in order: TIME, ACTION, PRICE, QUANTITY, COST/PNL, FEE DEDUCTED. It MUST list all order-level events for that trade (ENTRY row, all SAFETY ORDER rows, EXIT row) in chronological order.
- **FR-030**: The timeline MUST render a vertical center line with event indicator dots at the chronological position of each event. Capital injection dots and trade dots SHOULD be visually differentiated (e.g., by color) to help users distinguish event types at a glance.
- **FR-031**: When the dataset contains no `DEPOSIT` events (i.e., `monthly_addition = "0"`), the `TradingTimeline` MUST render correctly showing only trade cards — no capital injection cards appear, no empty left-column slots are rendered, and the equity trail is computed from trade P&L alone.

### Key Entities

- **Orchestrator Running Balance**: The authoritative in-memory decimal representing the total capital available to the simulation at any point in time. It accumulates: initial account balance + all realized trade profits/losses + all monthly additions applied so far.
- **globalCandleCount**: A monotonically increasing integer on the Orchestrator (not per-position) that tracks the total number of 1-minute candles consumed across all trade cycles in a single backtest run.
- **MonthlyAdditionEvent**: An existing domain event (`domain/position/events.go`) emitted whenever a 30-day capital injection fires. The Orchestrator becomes the sole emitter of this event; the PSM no longer emits it.
- **monthly_addition Config Field**: An optional `decimal.Decimal` stored in `domain/config.Config`, passed via the `EngineRequest` JSON, and exposed via `config.MonthlyAddition()`.
- **totalAdditions**: An accumulator variable inside `ResultAggregator.aggregateGoEvents` that sums the `addition_amount` of every `monthly.addition` event in the event stream. Used as a correction term in the ROI denominator: `accountBalance + totalAdditions`.
- **DEPOSIT Trade Ledger Row**: A synthetic row type produced by the event-processing loop when a `monthly.addition` event is encountered. It carries `eventType = "DEPOSIT"`, `balance = addition_amount`, and zeroed `price`, `quantity`, `fee`. It is not a market trade; it represents a capital funding event.
- **True Account Equity**: The total capital value at the end of a backtest, calculated as `Initial Balance + Total Additions + Net Profit`. This is the correct denominator-aligned equity figure and should be displayed in the summary panel for backtests that used `monthly_addition > 0`.
- **TradingTimeline Component**: A new React component (`TradingTimeline.tsx`) that renders the vertical chronological timeline of interleaved capital injection and trade events. It receives the processed ledger (trades + `DEPOSIT` rows) and the initial balance, then computes and displays the running equity trail across all events.
- **CapitalInjectionCard**: A visual sub-component within `TradingTimeline` that renders a single capital injection event. Displays the "CAPITAL INJECTION" label, timestamp, injected amount in green, and the running equity after the injection.
- **TradeSummaryCard**: A visual sub-component within `TradingTimeline` that renders a single trade's lifecycle summary. In collapsed state shows trade number, duration, fill ratio, capital deployed, P&L, date range, and running equity. Supports expand/collapse to reveal an inline order detail table.
- **Running Equity Trail**: The monotonically tracked sequence of cumulative equity values computed event-by-event across the full timeline. Each card in `TradingTimeline` displays the trail value at its chronological position. Computed in fixed-point decimal arithmetic.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A backtest running over 90 days with `monthly_addition = "500"` produces exactly 3 `MonthlyAdditionEvent` records in its output, each with `addition_amount = "500"`.
- **SC-002**: The final `runningBalance` after a multi-trade backtest equals `initial_balance + sum(all monthly additions) + sum(all realized trade profits)` to the exact decimal, with zero floating-point drift.
- **SC-003**: Setting `monthly_addition = "0"` (or omitting it) produces output that is byte-for-byte equivalent to the existing baseline — no event emitted, no balance change at the 43,200-candle mark.
- **SC-004**: All existing Go unit tests and TypeScript API tests pass without modification after the PSM cleanup in Phase 4. Any test that previously relied on the PSM's own monthly trigger must be updated to test via the Orchestrator instead.
- **SC-005**: A user can submit a backtest with `monthly_addition` via the UI form without encountering a validation error for valid non-negative decimal inputs.
- **SC-006**: The API correctly rejects `monthly_addition = "-1"` with a `400 Bad Request` response, ensuring no negative capital injections can reach the engine.
- **SC-007**: A backtest with `account_balance = "1000"`, `monthly_addition = "500"` run over 91 days with a realized net profit of `"250.00"` produces `roi_percent = "10.00"` — not `"25.00"`. This verifies the corrected denominator `(1000 + 3×500 = 2500)` is used.
- **SC-008**: The output trade ledger for any backtest that produced ≥ 1 `MonthlyAdditionEvent` contains the same number of `DEPOSIT` rows, each placed at the correct chronological timestamp, with the injection `amount` in the balance field and `price = 0`, `quantity = 0`.
- **SC-009**: The `TradingTimeline` component renders exactly one capital injection card per `DEPOSIT` event in the results ledger, each showing the correct timestamp, injected amount, and running equity — verified by a React unit test with a known dataset.
- **SC-010**: Each trade summary card in the timeline displays the correct cumulative running equity, computed as the exact decimal sum of `initial_balance` plus all prior capital injections plus all prior realized trade P&L values — with no floating-point drift (decimal arithmetic enforced).
- **SC-011**: Expanding a trade card reveals all order events for that trade (ENTRY, all SAFETY ORDER rows, EXIT) in a detail table with the columns TIME, ACTION, PRICE, QUANTITY, COST/PNL, FEE DEDUCTED — verified by a React unit test that checks both the column headers and the row count.
- **SC-012**: When `monthly_addition = "0"`, the `TradingTimeline` renders with only trade cards, producing equity trail values and P&L displays that are numerically identical to the existing results display — no visual regression for backtests without capital injections.

## Assumptions

- The existing `domain/config.Config.MonthlyAddition()` accessor and `WithMonthlyAddition()` option are already correctly implemented (as confirmed in codebase review); no changes are needed to `config.go`.
- The existing `MonthlyAdditionEvent` event struct in `domain/position/events.go` is correct and complete; no struct changes are needed.
- The `EngineRequest` struct in `main.go` already contains `MonthlyAddition string \`json:"monthly_addition,omitempty"\`` (as confirmed in codebase review); this field requires no addition.
- The `buildConfigFromRequest` function already correctly parses `MonthlyAddition` via `decimal.NewFromString` and passes it through `config.WithMonthlyAddition`; no changes are needed to that function.
- 1 month is defined as exactly 43,200 minutes (30 × 24 × 60). This is a fixed constant, not a calendar-based calculation.
- The `Profit` field in `TradeClosedEvent` is always a valid decimal string when emitted by the PSM; however, the Orchestrator must defensively handle a parse failure (log and skip, do not crash).
- The aggregator (`ResultAggregator.ts`) is the TypeScript class responsible for computing PnL and ROI from the raw Go engine event stream. It lives in `orchestrator/api/src/services/ResultAggregator.ts`. The `aggregateGoEvents` method is the active path for all current backtests.
- The trade ledger event-processing loop currently lives in `frontend/src/services/backtest-api.ts` inside the `getResults` function. This is where `DEPOSIT` rows must be injected and where `monthly.addition` events must be consumed rather than skipped.
- The trades table component is `frontend/src/components/TradeEventsTable.tsx`. The account equity display is part of the results summary panel rendered by the backtesting results view.
- The `TradingTimeline` component is a new file, expected at `frontend/src/components/TradingTimeline.tsx`. It receives the full processed ledger (including `DEPOSIT` rows) and the initial balance from the results page/hook, not from a separate API call.
- The data required for the timeline (DEPOSIT events with timestamps, trade summaries with open/close timestamps, P&L, fill ratio, capital deployed, and individual order rows) is already produced by the existing `getResults` pipeline after the US6 ledger passthrough is implemented; no new API endpoints are required for US8.