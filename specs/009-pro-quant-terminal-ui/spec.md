# Feature Specification: Pro Quant Terminal UI

**Feature Branch**: `009-pro-quant-terminal-ui`  
**Created**: 2026-03-15  
**Status**: Draft  
**Input**: User description: "Design and implement the '009-pro-quant-terminal-ui' feature. Completely overhaul our single-page React application into a 'Pro Quant Terminal' (Split-view architecture). We are moving away from a simple step-by-step wizard and building a professional, asynchronous, highly detailed backtesting dashboard that connects to our existing backend."

**Constitution Gates**:
- **Green Light Protocol**: All existing frontend tests must remain green after this change. New component rendering tests must be added for split-view layout, ConfigFormView, LiveTerminalView, and DashboardView.
- **Fixed-point arithmetic**: This feature is purely a UI layer. All number display in the DashboardView must format values received from the backend without re-computing them (no floating-point arithmetic in the UI). Display only; no re-computation of PnL or ROI.
- **BDD acceptance criteria**: Covered per user story below.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit Backtest and Track Live Progress (Priority: P1)

A quantitative analyst opens the app, clicks the `+` button in the left sidebar to open a blank configuration form, fills in their DCA strategy parameters, and clicks "Run Simulation." The app immediately submits the configuration to the backend, registers the run in the sidebar under a new "running" card, and switches the main area to a live terminal view that shows actual status updates while the backend processes the request.

**Why this priority**: This is the primary workflow of the entire application. Without the ability to submit a run and see it being processed, no other feature has value.

**Independent Test**: Can be fully tested by filling in the form, clicking "Run Simulation," and observing the sidebar card transition to "running" state with a spinner, while the main area shows a live terminal view with a progress bar. Delivers end-to-end value even without the dashboard view.

**Acceptance Scenarios**:

1. **Given** the app is open with no active runs, **When** the user clicks `+` in the sidebar, **Then** the main content area displays the configuration form with all 13 input fields rendered.
2. **Given** the configuration form is filled with valid values, **When** the user clicks "Run Simulation," **Then** the app calls the backend submit endpoint, adds a new run card with "running" status to the sidebar, sets it as the active run, and switches the main area to LiveTerminalView.
3. **Given** a run is in "running" state, **When** the backend returns a status update, **Then** the progress bar advances and the console log area appends new status lines.
4. **Given** a run is "running," **When** the backend signals completion, **Then** the main area automatically transitions to DashboardView and the sidebar card switches to "completed" state showing ROI and Net PnL.

---

### User Story 2 - Queue Multiple Concurrent Runs (Priority: P2)

While a first backtest is actively running in the background (status: "running"), the user wants to queue up a second simulation with different parameters. They click `+` again, fill in the new form, and submit without interrupting the first run.

**Why this priority**: This is the key differentiator from the old single-threaded wizard. It transforms the tool from a blocking step-by-step flow into a professional async workstation.

**Independent Test**: Can be fully tested by submitting a first run, then immediately clicking `+`, filling in a second form, and submitting. Both runs should appear as separate cards in the sidebar; the first continues polling in the background while the second begins its own polling lifecycle.

**Acceptance Scenarios**:

1. **Given** Run A is in "running" status and its LiveTerminalView is displayed, **When** the user clicks `+`, **Then** the main area switches to an empty ConfigFormView without cancelling Run A's polling.
2. **Given** the second form is submitted, **When** Run B is created, **Then** both Run A and Run B appear as separate cards in the sidebar with independent status indicators.
3. **Given** Run A completes while the user is viewing Run B's LiveTerminalView, **When** Run A's card in the sidebar is clicked, **Then** the main area switches to Run A's DashboardView while Run B continues polling unaffected.

---

### User Story 3 - Navigate Historical Results (Priority: P3)

The user has multiple completed runs in the sidebar. They want to navigate between them, reviewing the detailed analytics dashboard for each one without having to re-run the simulation.

**Why this priority**: Historical navigation is the core "review" workflow. A professional backtest tool must allow side-by-side conceptual comparison of runs.

**Independent Test**: Can be fully tested by having at least two completed runs; clicking each sidebar card should update the main area with the respective DashboardView without any network request.

**Acceptance Scenarios**:

1. **Given** two completed runs exist in the sidebar, **When** the user clicks on Run A's card, **Then** the main area displays Run A's DashboardView.
2. **Given** Run A's DashboardView is displayed, **When** the user clicks on Run B's card, **Then** the main area seamlessly transitions to Run B's DashboardView.
3. **Given** a completed run card is collapsed in the sidebar, **When** the user clicks the card body (not the "View Full Dashboard" button), **Then** the card expands to show summary stats (Max Drawdown, Total Orders, Unused Safety Order warning).
4. **Given** a completed run card is expanded, **When** the user clicks "View Full Dashboard," **Then** the full DashboardView for that run appears in the main content area.

---

### User Story 4 - Inspect Individual Trade Details (Priority: P4)

From the DashboardView, the user wants to drill into a specific completed trade to see every individual order fill — entry, safety orders, and exit — along with timestamps, prices, quantities, costs, fees, and adverse excursion data.

**Why this priority**: Deep trade-level inspection is what separates a professional analytics terminal from a simple summary screen.

**Independent Test**: Can be tested by clicking any trade row in the Trade History accordion. The row should expand to reveal an order-level table with correctly color-coded action pills.

**Acceptance Scenarios**:

1. **Given** the DashboardView shows a Trade History list, **When** the user clicks a trade row header, **Then** the row expands to show a table of all order fills for that trade.
2. **Given** a trade row is expanded, **Then** ENTRY fills display with a green pill, SAFETY_ORDER fills with a slate pill, and EXIT fills with a red pill.
3. **Given** a trade row header is visible, **When** the user hovers the Max Adverse Excursion (MAE) icon, **Then** a tooltip shows the MAE value for that trade.
4. **Given** a trade row header is visible, **When** the user hovers the Max Capital Deployed icon, **Then** a tooltip shows the total capital deployed during that trade.
5. **Given** a trade's duration is less than 24 hours, **Then** the duration badge renders in green; between 24–120 hours in amber; above 120 hours in red.

---

### Edge Cases

- What happens when the backend returns an error during submission? → The ConfigFormView must display an inline error message; no run card is created in the sidebar.
- What happens when polling exceeds the 5-minute timeout? → The run card transitions to "failed" status in the sidebar, and the LiveTerminalView shows a timeout error with a "Retry" option.
- What happens when the backend returns a failed status mid-poll? → Same as timeout: run card shows "failed" and LiveTerminalView shows the error message returned by the API.
- What happens if the user clicks an empty sidebar (no runs)? → The main area shows the ConfigFormView by default.
- What happens with a very large number of trades (e.g., 500+)? → The Trade History accordion must render all trades without blocking; each trade row header is visible but accordion bodies are lazy-rendered on expand.
- What happens when the Safety Order Usage data has fewer levels than configured? → The sidebar card "Unused Safety Orders" warning must correctly reflect the gap between `numberOfOrders` configured and actual levels that triggered.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Global Layout

- **FR-001**: The application MUST occupy the full viewport height and width without a document-level scrollbar. The layout is split into two persistent panes: a fixed-width left sidebar and a flex-growing right content area.
- **FR-002**: The left sidebar MUST be fixed at 320px width and contain three elements stacked vertically: an application header, a "New Backtest" button, and a scrollable run history list.
- **FR-003**: The main content area MUST render exactly one of three views at a time based on application state: ConfigFormView, LiveTerminalView, or DashboardView.
- **FR-004**: The entire application MUST use a near-black deep-space dark theme as the base background, with slate-family text colors for content.
- **FR-005**: Both the sidebar run list and the main content area MUST have independent scrollable regions with a minimal custom scrollbar style (6px wide, dark thumb, transparent track).

#### Run State Machine

- **FR-006**: Each run MUST have a unique short identifier derived from the backend-assigned `backtestId`, a status (`running` | `completed` | `failed`), and the original `BacktestFormState` parameters used to generate it.
- **FR-007**: When a run transitions from `running` to `completed`, the application MUST store the full `BacktestResults` payload alongside the run in application state so that the DashboardView can be re-rendered at any time without a new network request.
- **FR-008**: The application MUST support any number of concurrent `running` runs. Each running run MUST have its own independent polling lifecycle that operates in the background regardless of which run is currently displayed.
- **FR-009**: Closing or refreshing the browser tab MUST NOT be a requirement for clearing runs. Run history exists for the lifetime of the browser session (no persistence to localStorage is required).

#### Left Sidebar — Run Cards

- **FR-010**: Each run card in the sidebar MUST display in collapsed form: the short run ID, the trading pair, the start→end date range, and the creation timestamp.
- **FR-011**: A `running` run card MUST show a spinning activity indicator and the label "Processing..." instead of financial metrics.
- **FR-012**: A `completed` run card in collapsed form MUST additionally display the ROI percentage (color-coded green for positive, red for negative) and the Net PnL value.
- **FR-013**: A `failed` run card MUST display a red error indicator and the label "Failed."
- **FR-014**: A `completed` run card MUST be expandable on click. The expanded state MUST show: total order count, price scale factor, Max Drawdown percentage, an amber warning indicator when unused safety orders are detected (i.e., not all configured SO levels were triggered), and a "View Full Dashboard" button.
- **FR-015**: The currently selected run card MUST be visually distinguished with a subtle blue highlight border and glow effect.
- **FR-016**: The sidebar MUST include a "New Backtest" button (labeled with a `+` icon) in the header area. Clicking it MUST show the ConfigFormView and deselect any active run without cancelling background polling.

#### ConfigFormView

- **FR-017**: The form MUST include all 13 fields defined in `BacktestFormState`: `tradingPair`, `startDate`, `endDate`, `priceEntry`, `priceScale`, `amountScale`, `numberOfOrders`, `amountPerTrade`, `marginType`, `multiplier`, `takeProfitDistancePercent`, `accountBalance`, `exitOnLastOrder`.
- **FR-018**: `startDate` and `endDate` MUST use a date-time picker input that allows the user to specify date and time (not just a calendar date).
- **FR-019**: `priceScale` MUST display a `%` suffix indicator inside the input field wrapper to clarify the unit.
- **FR-020**: `amountScale` MUST display an `x` suffix indicator inside the input field wrapper to clarify it is a multiplier, not a percentage.
- **FR-021**: `takeProfit` (mapped to `takeProfitDistancePercent`) MUST display a green `%` suffix indicator.
- **FR-022**: `priceEntry` MUST display a `%` suffix indicator to represent the initial drop threshold for the first safety order.
- **FR-023**: `accountBalance` MUST display a `$` prefix indicator.
- **FR-024**: `exitOnLastOrder` MUST be rendered as a custom toggle switch — not a native browser checkbox. The toggle must visually indicate on/off state.
- **FR-025**: `marginType` MUST be a select dropdown with options "isolated" and "cross".
- **FR-026**: The form MUST validate that all required fields are non-empty before enabling the "Run Simulation" submit button.
- **FR-027**: On successful submission, the app MUST call the existing `submitBacktest(config)` API function with the form values mapped to `BacktestFormState`, create a new run object in state with status `running`, set it as the selected run, and switch to the history view (main area shows LiveTerminalView for the new run).
- **FR-028**: If `submitBacktest` throws an error, an inline error message MUST appear in the form area. No run card may be created in the sidebar.
- **FR-029**: While submission is in flight (awaiting the API response), the "Run Simulation" button MUST be disabled and show a loading indicator.

#### LiveTerminalView

- **FR-030**: The view MUST display the run identifier, the trading pair, and the status of the current run.
- **FR-031**: The view MUST include a progress indicator (bar or equivalent) that advances as the backend reports status changes. The progress indicator MUST include an animated shimmer or pulse effect to signal active processing.
- **FR-032**: The view MUST include a console-style log output area that displays timestamped status messages returned from the polling API. As new log lines arrive, the view MUST auto-scroll to the most recent line.
- **FR-033**: The console log area MUST display a blinking block cursor at the end of the logs to communicate active processing.
- **FR-034**: The view MUST use the existing `getStatus(backtestId)` polling mechanism (2000ms interval, 5-minute timeout) to drive progress updates.
- **FR-035**: When the backend reports `completed`, the view MUST call `getResults(backtestId)` and transition the run to `completed` state, triggering the main area to render DashboardView.
- **FR-036**: When polling returns `failed` or times out, the run MUST be marked `failed` and the view MUST show an error message with a "Retry" option.

#### DashboardView

- **FR-037**: The view MUST show a header containing: run title, short run ID, the date range used, the total simulation duration (derived from start and end dates), and the backend execution time in milliseconds (if available in the results payload).
- **FR-038**: The view MUST include a grid of 8 KPI cards covering: Account Equity, Net Profit, ROI, Profit Factor, Total Fees, Capital Utilized, Max Drawdown, and Win Rate. Each card MUST have an icon, a value, and a label. Values MUST use tabular-nums font variant to prevent layout shifts on update.
- **FR-039**: The view MUST include a "Safety Order Usage" panel showing one row per SO level with a horizontal fill bar indicating the proportion of total trades in which each SO level was triggered.
- **FR-040**: The view MUST include a "Configuration" panel summarizing the parameters used for the run (the original `BacktestFormState` values).
- **FR-041**: The view MUST include a "Trade History" section that lists all trades from `BacktestResults.tradeEvents` grouped by `trade_id`. Each trade MUST be displayed as a collapsible accordion row.
- **FR-042**: The accordion header for each trade MUST show: a sequential trade ID pill, a "CLOSED" status pill, the trade duration badge (color-coded: green for < 24h, amber for 24–120h, red for > 120h), the gross PnL, the fees paid (highlighted in red), and the net PnL (highlighted in green).
- **FR-043**: The accordion header MUST contain two icon indicators that, on hover, display tooltips showing: (a) Max Adverse Excursion (MAE) — the largest unrealized loss during the trade, and (b) Max Capital Deployed — the peak total capital committed during the trade.
- **FR-044**: The expanded accordion body MUST show a table of all `TradeEvent` rows for that trade with columns: Timestamp, Action, Price, Quantity, Cost/PnL, and Fee Deducted.
- **FR-045**: Action cells in the trade table MUST use color-coded pills: green for ENTRY, slate/gray for SAFETY_ORDER, red for EXIT.

### Key Entities

- **Run**: Represents one backtest execution lifecycle. Has a unique `backtestId`, a `status` (running | completed | failed), the source `BacktestFormState` config, an optional `BacktestResults` payload (present when completed), a creation timestamp, and an array of log messages accumulated during polling.
- **BacktestFormState**: The 13-field DCA strategy parameter set (already defined in `frontend/src/services/types.ts`). Maps to the API payload sent to the backend.
- **BacktestResults**: The completed result payload (already defined in `frontend/src/services/types.ts`). Contains `pnlSummary`, `safetyOrderUsage`, and `tradeEvents`.
- **TradeGroup**: A derived, display-only entity grouping all `TradeEvent` records that share the same `trade_id` into a single accordion unit for the Trade History view.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can submit a new backtest run and see it appear in the sidebar with live status in under 2 seconds from clicking "Run Simulation" (network latency excluded; UI state update must be immediate).
- **SC-002**: A user can queue a second run while the first is still processing without any degradation to the first run's polling or state; both runs complete independently and their results are independently viewable.
- **SC-003**: A user can navigate to any completed run's DashboardView from the sidebar and see the full results rendered without an additional network request.
- **SC-004**: The Trade History section renders all trades for a completed run (up to 500 trades) without the accordion list causing visible layout jank or a render freeze.
- **SC-005**: Hover tooltips for MAE and Max Capital Deployed appear within 200ms of the user's pointer entering the icon area, with no layout shift in the surrounding trade row.
- **SC-006**: The application passes all pre-existing frontend tests (`npm test`) without modification. New tests for the split-view layout, ConfigFormView form validation, and run state transitions must achieve at least 80% coverage of the new files.
- **SC-007**: The application correctly handles backend errors: an error from `submitBacktest` results in an inline form error with no new sidebar card; a polling failure results in the run card showing "failed" status.

---

## Assumptions

- The existing `submitBacktest`, `getStatus`, and `getResults` functions in `frontend/src/services/backtest-api.ts` are not modified by this feature. The UI adapts to their current signatures.
- The backend blocking-POST architecture means `getStatus` will return `completed` immediately for any run that has already been processed (via in-memory cache). The polling interval (2000ms) and timeout (5 minutes) remain unchanged.
- `Profit Factor`, `Win Rate`, `Account Equity`, and `Capital Utilized` are derivable from `BacktestResults.tradeEvents` and `pnlSummary`. If the backend does not return these values directly, the UI will derive reasonable approximations from existing data (documented during implementation).
- `Max Adverse Excursion` and `Max Capital Deployed` per trade are derivable from `TradeEvent` records within each trade group (running min price vs entry price, and sum of all buy-side `balance` values respectively).
- No persistence (localStorage, IndexedDB) is required. Run history exists in React component state for the browser session lifetime.
- All Lucide icons referenced in the design are available in the currently installed `lucide-react` version.
- The `exitOnLastOrder` field in the form maps to the `exitOnLastOrder: boolean` field in `BacktestFormState`.
- The `soCount` label in the feature description maps to `numberOfOrders` in `BacktestFormState`.
- The `pair` label in the feature description maps to `tradingPair` in `BacktestFormState`.
- The `priceEntry` field represents the initial drop percentage threshold for the first safety order (maps to `priceEntry` in `BacktestFormState`).
