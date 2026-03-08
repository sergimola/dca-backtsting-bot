# Feature Specification: DCA Frontend Web Application

**Feature Branch**: `005-dca-frontend`  
**Created**: March 8, 2026  
**Status**: Draft  
**Input**: React (Next.js or Vite) frontend application with TailwindCSS styling, DCA backtest configuration form, JSON API integration, and results visualization with polling support.

**Constitution Gates (MANDATORY)**:
- **Green Light Protocol**: All user interactions must be covered by automated tests (unit and integration) before merging
- **Fixed-point Arithmetic**: Frontend displays monetary values with appropriate precision (2 decimal places for currency, 8 decimals for crypto); does not perform trading calculations (delegated to backend)
- **BDD Acceptance Criteria**: User journeys include Given/When/Then scenarios covering form submission, result polling, timeout handling, and error states

## User Scenarios & Testing

### User Story 1 - Configure and Submit DCA Backtest (Priority: P1)

A trader needs to configure a DCA (Dollar-Cost Averaging) backtest with specific entry price, dollar amounts per order, sequence configuration, leverage, and margin ratio parameters. They submit the configuration to run a backtest and see results.

**Why this priority**: This is the core MVP feature - without this, the frontend cannot fulfill its primary purpose of allowing users to configure and run backtests.

**Independent Test**: Can be fully tested by loading the application, filling the configuration form with valid parameters, submitting, and verifying the form data is correctly sent to the API.

**Acceptance Scenarios**:

1. **Given** a clean configuration form is displayed, **When** the user enters valid values (Entry Price=100, Amounts=[50,100,150], Sequences=3, Leverage=2x, Margin Ratio=50%), **Then** all values are accepted and displayed in the form
2. **Given** valid configuration data, **When** the user clicks Submit, **Then** a JSON payload conforming to the API schema is sent to the API Layer and user receives a backtest ID
3. **Given** submission is in progress, **When** the user attempts to submit again, **Then** the submit button is disabled and a loading state is displayed
4. **Given** the form has unsaved changes, **When** the user attempts to navigate away, **Then** a confirmation dialog appears warning about unsaved data

---

### User Story 2 - Display PnlSummary Results (Priority: P1)

After a backtest completes, the trader needs to see the profit/loss summary including ROI percentage, maximum drawdown, and fees incurred.

**Why this priority**: Critical for MVP - results display is essential to demonstrate backtest outcomes.

**Independent Test**: Can be tested by mocking successful API responses with PnlSummary data and verifying the results page displays formatted metrics with correct values and units.

**Acceptance Scenarios**:

1. **Given** backtest results are available, **When** the results page loads, **Then** PnlSummary metrics are displayed prominently including ROI (as percentage), Max Drawdown (as percentage), and Total Fees (with currency symbol)
2. **Given** PnlSummary values are displayed, **When** the user hovers over or clicks a metric, **Then** a tooltip appears explaining what the metric represents
3. **Given** ROI is negative (losing trade), **When** the results are displayed, **Then** the ROI value is visually distinguished (e.g., red color) to indicate loss
4. **Given** ROI is positive (profitable trade), **When** the results are displayed, **Then** the ROI value is visually distinguished (e.g., green color) to indicate profit

---

### User Story 3 - View Safety Order Usage Summary (Priority: P1)

The trader needs to understand how many times each safety order level was activated during the backtest, visualized for easy interpretation.

**Why this priority**: Core to MVP - safety order execution patterns are critical to evaluating DCA strategy effectiveness.

**Independent Test**: Can be tested by mocking API response with Safety Order Usage data and verifying the chart/list displays correct counts per safety order level.

**Acceptance Scenarios**:

1. **Given** Safety Order Usage data is available, **When** the results page loads, **Then** a bar chart is displayed showing count for each safety order level (SO1, SO2, SO3, etc.)
2. **Given** no safety orders were triggered, **When** the results page displays Safety Order Usage, **Then** the chart shows zero counts or displays a message "No safety orders triggered"
3. **Given** the chart is displayed, **When** the user hovers over a bar, **Then** a tooltip shows the exact count for that safety order level
4. **Given** Safety Order Usage data exists, **When** user requests an alternative view (e.g., list format), **Then** a list/table showing Safety Order Level and Count is displayed as alternative to chart

---

### User Story 4 - Examine Trade Events Timeline (Priority: P1)

The trader needs to view a chronological record of all trading events (entries, safety orders, exits) that occurred during the backtest to understand trade execution flow.

**Why this priority**: Critical for MVP - the events table is essential for understanding backtest mechanics and debugging trading logic.

**Independent Test**: Can be tested by mocking Trade Events data and verifying the table displays all events in correct chronological order with all expected columns.

**Acceptance Scenarios**:

1. **Given** Trade Events data is available, **When** the results page loads, **Then** a table is displayed with columns: Timestamp, Event Type, Price, Quantity, and Balance
2. **Given** multiple trade events exist, **When** the table is displayed, **Then** events are sorted chronologically (oldest to newest, or newest to oldest with toggle option)
3. **Given** the table is displayed, **When** the user scrolls through many events, **Then** the table remains responsive with pagination or virtual scrolling
4. **Given** a specific event row is selected, **When** the user clicks or expands it, **Then** additional details (e.g., order ID, notes) are displayed

---

### User Story 5 - Poll for Backtest Completion (Priority: P2)

The trader submits a backtest configuration and must wait for processing. The application polls the API to check if results are ready and automatically transitions to results view when complete.

**Why this priority**: Important for user experience - users should not manually refresh; automatic polling keeps them informed.

**Independent Test**: Can be tested by mocking the API polling endpoint and verifying the application correctly polls at intervals and updates UI when status changes.

**Acceptance Scenarios**:

1. **Given** a backtest has been submitted, **When** results are not yet available, **Then** a loading/waiting state is displayed with status message "Processing backtest..."
2. **Given** polling is in progress, **When** the API returns status "pending", **Then** the application continues polling at regular intervals (e.g., every 2 seconds)
3. **Given** polling is in progress, **When** the API returns status "completed", **Then** polling stops and results page automatically loads with the completed data
4. **Given** polling is in progress, **When** the API returns status "failed", **Then** an error message is displayed explaining the failure reason (if provided by API)

---

### User Story 6 - Handle Timeout and Connection Errors (Priority: P2)

When backtest processing takes longer than expected or network issues occur, the user receives clear feedback and optional recovery actions.

**Why this priority**: Important for robustness - users need to know what happened and what to do next if something fails.

**Independent Test**: Can be tested by simulating API timeouts and connection failures, verifying appropriate error messages are shown with recovery options.

**Acceptance Scenarios**:

1. **Given** a backtest is polling for results, **When** no response is received within 5 minutes, **Then** a timeout message appears: "Backtest processing is taking longer than expected"
2. **Given** a timeout has occurred, **When** the user is presented with options, **Then** buttons "Retry" and "Check Status" are available
3. **Given** a network error occurs during polling, **When** the error is detected, **Then** a message appears: "Connection lost. Retrying..." and automatic retry attempts occur
4. **Given** multiple connection failures occur, **When** retries fail, **Then** a "Refresh" button appears allowing user to manually retry the operation

---

### User Story 7 - Reset and Run New Backtest (Priority: P3)

After reviewing backtest results, the trader wants to modify parameters and run another backtest.

**Why this priority**: Useful for iteration - users frequently want to try different configurations sequentially.

**Independent Test**: Can be tested by completing a backtest, then verifying a "Run New Backtest" or "Reset" action returns to the configuration form.

**Acceptance Scenarios**:

1. **Given** results are displayed, **When** the user clicks "Configure New Backtest", **Then** the application returns to the configuration form with cleared input fields
2. **Given** results are displayed, **When** the user clicks "Modify Configuration", **Then** the form pre-populates with the previous backtest's parameters for easy editing
3. **Given** the user is in the configuration form, **When** they click "Back to Results", **Then** the previous results are restored (if still available in session)

---

## Requirements

### Functional Requirements

- **FR-001**: Application MUST display a form with input fields for: Entry Price (decimal), Amounts (array/list), Sequences count (integer), Leverage (decimal multiplier), and Margin Ratio (percentage)
- **FR-002**: Form inputs MUST validate data types and ranges before submission (e.g., Entry Price > 0, Margin Ratio between 0-100%)
- **FR-003**: Application MUST submit form data as JSON conforming to the API Layer (Feature 004) schema to the backtest endpoint
- **FR-004**: Application MUST extract and store the backtest ID returned from API submission
- **FR-005**: Application MUST implement polling mechanism that queries backtest status endpoint at configurable intervals (default 2 seconds)
- **FR-006**: Application MUST handle polling timeout after 5 minutes and display user-friendly timeout message
- **FR-007**: Application MUST render PnlSummary metrics (ROI, Max Drawdown, Total Fees) with proper formatting and units (percentages, currency)
- **FR-008**: Application MUST display Safety Order Usage data as a bar chart with optional list view toggle
- **FR-009**: Application MUST render Trade Events as a chronological table with sortable columns and pagination/virtual scrolling for large datasets
- **FR-010**: Application MUST display loading indicators during form submission and API polling
- **FR-011**: Application MUST display error messages for API failures, network errors, and timeout scenarios with actionable recovery suggestions
- **FR-012**: Application MUST prevent form submission until all required fields are valid
- **FR-013**: Application MUST warn users about unsaved form changes when navigating away
- **FR-014**: Application MUST poll backtest status endpoint at fixed 2-second intervals until completion, timeout, or user cancellation
- **FR-015**: Results page MUST remain available during the session after successful backtest completion

### Key Entities

- **Backtest Configuration**: Entry Price, Amounts array, Sequences, Leverage, Margin Ratio - represents user input for one backtest run
- **Backtest Result**: Contains backtest ID, status, PnlSummary, Safety Order Usage, Trade Events - represents completed backtest with all results
- **PnlSummary**: ROI (percentage), Max Drawdown (percentage), Total Fees (currency amount) - key metrics summarizing backtest profitability
- **Safety Order Usage**: Mapping of safety order level (SO1, SO2, etc.) to activation count - shows how many times each level was triggered
- **Trade Event**: Timestamp, Event Type (entry/safety order/exit), Price, Quantity, Account Balance - represents a single trade action in chronological sequence

## Success Criteria

### Measurable Outcomes

- **SC-001**: Users can configure and submit a backtest form in under 1 minute (including reading form labels and entering all required values)
- **SC-002**: Backtest results load and display all metrics (PnlSummary, Safety Order chart, Trade Events table) within 2 seconds of API completion notification
- **SC-003**: Application correctly polls API and transitions to results view within 3 seconds of backtest completion
- **SC-004**: 95% of Trade Events tables with up to 1000 events render without performance degradation (smooth scrolling, instant interactions)
- **SC-005**: All form validation occurs client-side with feedback provided within 100ms of user input
- **SC-006**: Timeout handling gracefully manages scenarios where backtest takes longer than expected with clear user communication
- **SC-007**: Application maintains usability during slow network conditions (>2 second latency) with appropriate loading states
- **SC-008**: Error scenarios display actionable error messages that enable users to resolve issues or retry operations successively

### User Experience Metrics

- **UX-01**: 90% of users can successfully complete a backtest run on first attempt without contacting support
- **UX-02**: Users can interpret PnlSummary metrics without additional documentation (metrics are self-explanatory or have tooltips)
- **UX-03**: Chart visualization for Safety Order Usage is more intuitive than raw numerical lists (measured by user preference survey or interaction pattern analysis)

## Assumptions

- **Integration Architecture**: API Layer (Feature 004) provides synchronous response with backtest ID and implements `/backtest/{id}/status` and `/backtest/{id}/results` endpoints
- **Technology Stack**: React framework (via Next.js or Vite), TailwindCSS for styling (no custom CSS or external UI libraries beyond Tailwind)
- **Browser Support**: Modern browsers (Chrome, Firefox, Safari, Edge with ES2020+ support) - no IE11 support required
- **Data Precision**: Frontend displays prices/quantities with 8 decimals for crypto, fees/balances with 2 decimals currency; all calculations deferred to backend
- **Session Management**: User session persists backtest data during current browser session; data is not persisted across browser restarts (per feature scope)
- **Chart Library**: Bar chart for Safety Order Usage can be generated via lightweight charting library (e.g., Chart.js, Recharts) or HTML canvas
- **Polling Interval**: Default 2-second polling interval is acceptable; no real-time WebSocket support required in MVP

## Edge Cases

- What happens when user submits form with Entry Price of 0 or negative value? → Form validation prevents submission; error message displayed
- What happens when the Amounts array is empty? → Form validation requires at least one amount; error message displayed
- What happens when backtest takes longer than timeout threshold? → User sees timeout message with retry option; no automatic redirect
- What happens when poll response contains malformed data? → Application displays "Data error" message; user can retry or start new backtest
- What happens when user closes browser tab during polling? → Session data (backtest ID) may be lost; consider localStorage for recovery (out of scope for MVP)
- What happens when Safety Order Usage has no data (all counts are zero)? → Chart displays with zero values or shows message "No safety orders activated"; not an error state
- What happens when Trade Events table has 10,000+ rows? → Virtual scrolling or pagination handles rendering efficiently; table remains responsive

## Out of Scope

- WebSocket real-time updates (MVP uses polling only)
- Persistent storage across browser sessions (localStorage/database integration)
- Export results to CSV/PDF
- Comparative backtesting (running multiple backtests and comparing results)
- Advanced charting library integrations beyond simple bar chart
- Authentication/user management (assumes single-user local testing environment)
- Mobile responsiveness beyond ensuring touch-friendly form inputs (desktop-first design)

## Notes

- Configuration form should be cleaned and made available for new backtest after results are reviewed
- Consider adding "Modify & Re-run" option that pre-populates form with previous backtest parameters
- Polling mechanism should gracefully degrade if API response times vary significantly
