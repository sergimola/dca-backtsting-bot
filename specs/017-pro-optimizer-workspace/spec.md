# Feature Specification: Pro Optimizer Workspace

**Feature Branch**: `017-pro-optimizer-workspace`
**Created**: 2026-04-01
**Status**: Draft
**Input**: Redesign the Optimizer specification to bridge the current high-performance engine implementation with a production-ready, highly actionable quantitative dashboard featuring global navigation, database-backed summary persistence, deep pruning insights, throttled real-time rendering, advanced quick-date selections, and a selective promotion workflow.

**Constitution Gates (MANDATORY)**:
- **Green Light Protocol**: All existing Go engine tests (`go test ./...`) and orchestrator API tests (`npx jest`) must remain green. New tests must cover: sweep session/summary persistence, throttled UI state updates, sweep history retrieval, pruning transparency breakdown, year-based quick-date logic, and single-run promotion with `enable_wide_events: true`. No merge permitted with failing tests.
- **Fixed-point arithmetic**: All monetary calculations in the Go engine MUST use `decimal.Decimal`. The Node.js API MUST use `decimal.js` for any pre-flight or pruning calculations. Floating-point numbers are only permitted in final serialized JSON output fields and UI display values.
- **BDD acceptance criteria**: Each user story below has traceable Given/When/Then scenarios covering: global sidebar navigation, sweep session persistence, summary-only data model, pruning transparency UI, throttled rendering under high-speed streaming, year-based quick-date generation, and re-run promotion with wide events.

## Clarifications

### Session 2026-04-01

- Q: How is `win_rate` defined in `SweepRunSummary` for a DCA bot? → A: Per-position: take-profit hit = win, forced exit/stop/liquidation = loss. Win Rate = (positions closed at TP) / (total positions closed). If total positions closed = 0 (severe drawdown with no exits), the Go engine MUST return `null` to prevent a divide-by-zero panic.
- Q: Should the sweep history list paginate or load all entries? → A: Default display capped at 50 most recent sessions with a "Load More" button for older entries.
- Q: What happens if database persistence fails when a sweep completes? → A: Log the error and keep results available in-memory for the current session. Do not block the user or discard results. Retry persistence is deferred to a future spec.
- Q: Can users delete sweep sessions from the history list? → A: Yes. Deleting a SweepSession cascade-deletes all child SweepRunSummary records.
- Q: Should the global sidebar default to expanded or collapsed on first load? → A: Expanded on first load. Collapsed/expanded state persists within the session via local state.
- Q: How is `capital_efficiency` calculated for `SweepRunSummary`? → A: `capital_efficiency = ROI / Max Capital Required × 100`. Measures return extracted per dollar at maximum exposure, comparable across configs with different ladder depths.
- Q: How does the frontend know persistence failed to show the FR-012b warning banner? → A: The API emits a dedicated SSE event `{"type": "persistence_error", "message": "..."}` on the existing execution stream. The `useOptimizer` hook sets a `persistenceError` flag on receiving this event, which renders the warning banner.
- Q: Is the `guaranteed_fee_loss` 0.2% threshold configurable per exchange or a fixed constant? → A: Fixed constant (0.2% round-trip) defined in this spec. Per-exchange configurability is deferred to a future spec.
- Q: What Max ROI does a cancelled SweepSession show in the history list? → A: The max ROI of whatever partial SweepRunSummary records were persisted before cancellation. If zero runs completed, display `N/A`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Global Navigation & Dedicated Workspace Layout (Priority: P1)

The platform features a global, collapsible lateral sidebar menu that allows the user to switch entirely between the "Backtests" (Single Runs) and "Optimizer" (Sweeps) modules. When "Optimizer" is selected, the main view is completely dedicated to it and uses a 2-pane layout: the Left Pane houses the sweep history list and the Optimizer configuration form; the Right Pane houses the real-time Execution Dashboard (progress bar) and the completed Quant Matrix (Heatmap + Leaderboard), utilizing maximum available screen width for dense data display.

**Why this priority**: The global navigation and layout are the structural foundation for every other feature in this spec. Without a collapsible sidebar and dedicated workspace, there is no container for sweep history, the configurator, or the full-width quant matrix.

**Independent Test**: Can be fully tested by rendering the application, clicking the sidebar toggle to collapse/expand it, switching between Backtests and Optimizer tabs, and verifying that the 2-pane layout renders correctly with proper width allocation.

**Acceptance Scenarios**:

1. **Given** the application loads, **When** the sidebar renders, **Then** it displays two navigation items: "Backtests" and "Optimizer", with the active item visually highlighted.
2. **Given** the sidebar is expanded, **When** the user clicks the collapse toggle, **Then** the sidebar collapses to icon-only mode and the main content area expands to fill the reclaimed width.
3. **Given** the sidebar is collapsed, **When** the user clicks the expand toggle, **Then** the sidebar expands to full width showing labels alongside icons.
4. **Given** the user is on the Backtests page, **When** they click "Optimizer" in the sidebar, **Then** the entire main view transitions to the Optimizer workspace with a Left (Configurator + History) / Right (Dashboard + Matrix) 2-pane layout.
5. **Given** the Optimizer workspace is active, **When** the layout renders, **Then** the Left Pane occupies approximately 25% width and the Right Pane occupies approximately 75% width, with the Right Pane utilizing maximum available screen width for dense data display.
6. **Given** the application loads for the first time, **When** the sidebar renders, **Then** it defaults to the expanded state. The collapsed/expanded state persists within the session via local state.

---

### User Story 2 — Sweep History Landing (Priority: P2)

The Optimizer sidebar persists and displays a list of all historically completed sweeps. Each entry shows key KPIs: Date, Trading Pair, Total Runs, and Max ROI. Clicking a past sweep loads its completed Quant Matrix in the right pane.

**Why this priority**: Sweep history gives the analyst the ability to review past sweeps without re-execution. This is essential for iterative analysis and makes the database persistence meaningful. Without it, there is no reason to persist summaries.

**Independent Test**: Can be fully tested by creating 3 sweep sessions in the database, rendering the Optimizer page, verifying the history list displays all 3 with correct KPIs, and clicking one to load its completed Quant Matrix.

**Acceptance Scenarios**:

1. **Given** the database contains 5 completed sweep sessions, **When** the Optimizer page loads, **Then** the sweep history list in the left pane displays all 5 entries sorted by date (most recent first), with a default display cap of 50 entries and a "Load More" button for older sessions.
2. **Given** a sweep history entry for "BTC/USDC" with 120 runs and a max ROI of 14.3%, **When** the entry renders, **Then** it displays "BTC/USDC", "120 runs", "14.3% ROI", and the completion date.
3. **Given** the user clicks a past sweep in the history list, **When** the click handler fires, **Then** the right pane loads the completed Quant Matrix with that sweep's SweepRunSummary records displayed in the Leaderboard.
4. **Given** no sweep sessions exist in the database, **When** the Optimizer page loads, **Then** the history list displays an empty state message (e.g., "No sweeps yet. Configure and launch your first sweep.").
5. **Given** the user launches a new sweep that completes, **When** the sweep finishes, **Then** the newly completed sweep appears at the top of the history list without requiring a page refresh.

---

### User Story 3 — Summary-Only Database Persistence (Priority: P3)

To defend database health and prevent severe bloat during massive sweeps, the Optimizer persists only lightweight summary data. A parent SweepSession record is created per sweep, and child SweepRunSummary records are created per individual run. These summaries contain only the top KPIs needed for the leaderboard: ROI, Max Drawdown, Total Fees, Win Rate, Capital Efficiency, and Execution Time. Full tradeEvents and safetyOrderUsage arrays are explicitly excluded from persistence.

**Why this priority**: Database health is a hard constraint. Without summary-only persistence, a 500-run sweep could generate millions of trade event rows, causing table bloat, slow queries, and storage exhaustion. This must be enforced before any persistence feature is implemented.

**Independent Test**: Can be fully tested by launching a 10-run sweep, verifying that exactly 1 SweepSession and 10 SweepRunSummary records are created in the database, and confirming that no tradeEvents or safetyOrderUsage data exists in any database table for those runs.

**Acceptance Scenarios**:

1. **Given** a sweep of 50 runs completes, **When** the database is queried, **Then** exactly 1 SweepSession record and 50 SweepRunSummary records exist for that sweep.
2. **Given** a SweepRunSummary record is persisted, **When** its columns are inspected, **Then** it contains only: `id` (UUID), `session_id` (FK), `run_id`, `config_json`, `roi`, `max_drawdown`, `total_fees`, `win_rate` (positions closed at TP / total positions closed), `capital_efficiency`, `execution_time_ms`, and `created_at` — no tradeEvents, no safetyOrderUsage.
3. **Given** a SweepSession record is persisted, **When** its columns are inspected, **Then** it contains: `id` (UUID), `trading_pair`, `start_date`, `end_date`, `total_runs`, `max_roi`, `total_execution_time_ms`, `status` (`completed` | `cancelled`), `created_at`, and `config_snapshot` (the sweep definition JSON).
4. **Given** the engine emits a `run_id` for each completed run, **When** the API persists the summary, **Then** the `run_id` field in SweepRunSummary maps to the engine's `run_id` (which equals the config's `idempotency_key`), while the row's primary `id` is a separately generated UUID.
5. **Given** a sweep of 200 runs completes, **When** total database storage is measured, **Then** the sweep data consumes less than 100KB (no trade-level data persisted).
6. **Given** the engine completes a run where zero positions were closed (e.g., severe drawdown with no take-profit exits), **When** the SweepRunSummary is persisted, **Then** `win_rate` is stored as `null` — the Go engine MUST NOT perform division by zero.
7. **Given** database persistence fails after a sweep completes, **When** the API detects the failure, **Then** it emits a `{"type": "persistence_error"}` SSE event on the existing stream; the `useOptimizer` hook receives it and renders a visible warning banner without discarding in-memory results.

---

### User Story 4 — Combined Quick Dates with Year-Based Selections (Priority: P4)

The Configurator retains the existing quick dates (YTD, Last 6M, Last 30D) and dynamically generates year-based quick-select buttons for the last 5–7 years. Two modes are available per year: "Since [Year]" (sets Start Date to Jan 1 of that year, End Date to today) and "[Year] Only" (sets Start Date to Jan 1, End Date to Dec 31 of that year).

**Why this priority**: Quick-date selections dramatically reduce configuration friction for the most common analysis patterns. Year-based selections enable multi-year performance analysis which is critical for long-term strategy validation.

**Independent Test**: Can be fully tested by rendering the Configurator, clicking each quick-date button, and asserting that the start/end date fields are set to the correct ISO dates.

**Acceptance Scenarios**:

1. **Given** the current date is 2026-04-01, **When** the Configurator renders, **Then** quick-date buttons include: "YTD", "Last 6M", "Last 30D", "Since 2021", "Since 2022", "Since 2023", "Since 2024", "Since 2025", "2021 Only", "2022 Only", "2023 Only", "2024 Only", "2025 Only".
2. **Given** the user clicks "Since 2023", **When** the date fields update, **Then** `start_date` is "2023-01-01" and `end_date` is today's date.
3. **Given** the user clicks "2024 Only", **When** the date fields update, **Then** `start_date` is "2024-01-01" and `end_date` is "2024-12-31".
4. **Given** the user clicks "YTD", **When** the date fields update, **Then** `start_date` is Jan 1 of the current year and `end_date` is today's date.
5. **Given** the year-based buttons are generated dynamically, **When** the application runs in year 2027, **Then** the buttons automatically include years 2022–2026 without code changes.

---

### User Story 5 — Global Import/Export Config (Priority: P5)

The "Import Config" and "Export Config" functionality built for the Optimizer is ported to and available globally in the Single Run (Backtests) view, allowing analysts to import/export configuration JSON from both modules.

**Why this priority**: Cross-module config portability is a quality-of-life improvement that leverages existing functionality. It is lower priority because it does not enable new analytical capability, but it removes friction from the analyst workflow.

**Independent Test**: Can be fully tested by exporting a config from the Optimizer, switching to the Single Run view, importing that same JSON, and verifying all fields are populated correctly (and vice versa).

**Acceptance Scenarios**:

1. **Given** the Single Run view loads, **When** the toolbar renders, **Then** "Import Config" and "Export Config" buttons are visible.
2. **Given** the user clicks "Export Config" on the Single Run view, **When** the export completes, **Then** a JSON string containing all current configuration fields is copied to the clipboard or presented in a modal.
3. **Given** the user clicks "Import Config" on the Single Run view and pastes valid JSON, **When** the import completes, **Then** all configuration fields are populated with the imported values.
4. **Given** a config JSON exported from the Optimizer, **When** it is imported into the Single Run view, **Then** all shared fields are correctly populated (non-sweep fields map directly; sweep fields use their fixed values or first sweep value).

---

### User Story 6 — Pruning Transparency & Combined Pre-Flight Insights (Priority: P6)

During configuration, the UI footer displays explicit pre-flight insights alongside generation counts: "Generated: X | Pruned: Y | Valid: Z". Below this, the footer displays boundary insights: "Drawdown Coverage Range: -X% to -Y%" and "Capital Required Range: $A to $B". The "Pruned: Y" metric includes a tooltip or expandable breakdown listing concrete prune reasons (e.g., "↳ 100 exceeded Account Balance ($10k)", "↳ 50 violated Exchange Min Order ($10)").

**Why this priority**: Pruning transparency eliminates "black box" confusion when the analyst sees fewer valid runs than generated. Without this, the analyst cannot diagnose why configs are being pruned or adjust parameters to maximize the valid set.

**Independent Test**: Can be fully tested by configuring a sweep where some configs exceed account balance and others violate exchange minimums, then verifying the footer shows the correct breakdown counts and the tooltip/expandable lists the exact reasons.

**Acceptance Scenarios**:

1. **Given** a sweep generates 200 configs with 30 pruned (20 for capital, 10 for min order), **When** the footer renders, **Then** it displays "Generated: 200 | Pruned: 30 | Valid: 170".
2. **Given** the footer shows "Pruned: 30", **When** the user hovers over or clicks the pruned count, **Then** a breakdown appears showing "↳ 20 exceeded Account Balance ($10,000)" and "↳ 10 violated Exchange Min Order ($10)".
3. **Given** a valid sweep generates configs with drawdown coverage from -8% to -35%, **When** the insights section renders, **Then** it displays "Drawdown Coverage Range: -8% to -35%".
4. **Given** a valid sweep generates configs with capital requirements from $1,500 to $9,500, **When** the insights section renders, **Then** it displays "Capital Required Range: $1,500 to $9,500".
5. **Given** zero configs are pruned, **When** the footer renders, **Then** the Pruned count shows "0" and no breakdown tooltip is available.
6. **Given** a config has `take_profit_distance_percent = 0.15` (below the 0.2% round-trip fee threshold), **When** pruning evaluates it, **Then** it is pruned with reason `guaranteed_fee_loss` and the breakdown displays "↳ N guaranteed fee loss (take profit too tight to cover 0.2% round-trip fees)".
7. **Given** the Go Pre-Flight result for a config returns `max_drawdown_covered_pct = -105.0`, **When** pruning evaluates it, **Then** it is pruned with reason `exceeds_100_percent_drawdown` and the breakdown displays "↳ N negative asset price (grid requires price below zero)".
8. **Given** the Go Pre-Flight `ladder` array for a config shows a gap of 0.08% between two consecutive safety orders, **When** pruning evaluates it, **Then** it is pruned with reason `tick_size_violation` and the breakdown displays "↳ N tick size violation (consecutive safety-order gap < 0.1%)".

---

### User Story 7 — Throttled Real-Time Rendering (Performance Guard) (Priority: P7)

During high-speed streaming (50+ results per second), the frontend `useOptimizer` hook throttles state updates to the Leaderboard and Heatmap components. The internal result buffer flushes to the UI at a controlled interval (e.g., every 250ms), while the Master Progress Bar continues to increment smoothly and independently. This prevents React DOM freezing/locking.

**Why this priority**: Without throttled rendering, the UI becomes unusable during high-throughput sweeps. The Go engine can emit 50–100 results per second, and naive state updates for every single result would cause React reconciliation to lock the DOM for multiple seconds, preventing user interaction.

**Independent Test**: Can be fully tested by mocking 200 result events arriving within 1 second, measuring the number of React re-renders triggered, and asserting it does not exceed ~5 re-renders (one per 250ms interval). The progress bar must update independently at a smooth cadence.

**Acceptance Scenarios**:

1. **Given** the Go engine emits 100 results within 2 seconds, **When** the useOptimizer hook processes them, **Then** the Leaderboard and Heatmap receive at most ~8 state updates (2s / 250ms = 8 flush intervals).
2. **Given** results are streaming in rapidly, **When** the progress bar renders, **Then** it increments smoothly with each incoming result independently of the throttled Leaderboard/Heatmap updates.
3. **Given** a sweep of 500 runs is executing with results arriving at 50/second, **When** the user interacts with the UI (scrolling, clicking column headers), **Then** the UI remains responsive with no perceptible freeze or input lag.
4. **Given** the throttle interval is 250ms and results are arriving continuously, **When** the buffer flushes, **Then** all buffered results are applied to state in a single batch update.

---

### User Story 8 — Non-Blocking Streaming from Go Engine (Priority: P8)

The Go engine flushes results to stdout immediately upon the completion of each individual run. Streaming does not block or degrade CPU worker performance. Workers do not wait for the entire batch to finish before emitting data.

**Why this priority**: Non-blocking streaming is the prerequisite for real-time progress tracking and the throttled UI (Story 7). If the engine buffers output, the analyst sees no feedback until the sweep is complete.

**Independent Test**: Can be fully tested by timing the first stdout emission during a 100-run batch and asserting it arrives within seconds of batch start (not after the full batch completes), and verifying that total execution time is not degraded versus fully buffered mode.

**Acceptance Scenarios**:

1. **Given** a batch of 100 runs is started, **When** the first worker completes its run, **Then** the result JSON line appears on stdout within 1 second of that worker's completion.
2. **Given** the engine is processing a 500-run batch on 8 cores, **When** stdout is monitored, **Then** result lines appear incrementally (not in a single burst at the end).
3. **Given** stdout flushing is enabled, **When** total batch execution time is measured, **Then** it does not exceed 105% of an equivalent run with fully buffered IO (flushing overhead is negligible).
4. **Given** a worker completes a run, **When** it writes its result to stdout, **Then** the write does not block or contend with other workers' CPU-intensive simulation loops.

---

### User Story 9 — Selective Promotion: Re-Run with Wide Events (Priority: P9)

Every row in the completed Leaderboard Data Grid features a single action button under the "Actions" column that promotes a summary-only sweep result into a fully persisted backtest for deep analysis. The action grabs the row's configuration JSON and dispatches a full, dedicated single backtest run with `enable_wide_events: true`, opening in a new tab. The Go engine code ensures `enable_wide_events` is always respected regardless of environment defaults.

**Why this priority**: The promotion workflow is the analytical payoff of the Optimizer. Without it, the analyst can identify top-performing parameter sets but cannot drill into their trade-level details. It depends on all prior stories being functional.

**Independent Test**: Can be fully tested by rendering a completed Leaderboard, clicking the action button on a row, and verifying that a new tab opens the Single Run view with all parameters pre-filled and `enable_wide_events: true`, and that the resulting backtest persists full trade events to the database.

**Acceptance Scenarios**:

1. **Given** the completed Leaderboard displays a row for `run_id=abc123`, **When** the user clicks the "Re-run with Details" action button, **Then** the application opens a new browser tab to the Single Run view with all parameters from that row pre-filled.
2. **Given** the promotion action is triggered, **When** the config is constructed for the single backtest, **Then** `enable_wide_events` is explicitly set to `true` in the request payload.
3. **Given** the Go engine receives a config with `enable_wide_events: true`, **When** the engine processes it, **Then** full wide events are emitted regardless of any environment variable or default configuration that might disable them.
4. **Given** the promoted run completes, **When** the database is queried, **Then** full tradeEvents and safetyOrderUsage records are persisted (unlike the summary-only optimizer records).
5. **Given** the Leaderboard is in the completed state, **When** all rows are inspected, **Then** each row has exactly one action button labeled "Re-run with Details" (or equivalent) under the "Actions" column.

---

### User Story 10 — Sweep Cancellation & Partial Persistence (Priority: P10)

During an active sweep execution, the analyst can abort the sweep at any time by clicking a "Cancel Sweep" button on the Execution Dashboard. The API sends a termination signal (SIGTERM) to the running Go engine child process. All SweepRunSummary records for runs completed before termination are persisted, the SweepSession status is set to `cancelled`, and the UI automatically transitions from the Execution Dashboard to the Quant Matrix showing the partial results with a clear "Cancelled (N/Total)" indicator.

**Why this priority**: Cancellation is a safety valve for long-running sweeps that are clearly converging on undesirable results. Without it, the analyst must wait for full completion or forcefully kill the process with no persistence of partial results.

**Independent Test**: Can be fully tested by launching a sweep of 50 runs, clicking "Cancel Sweep" after 20 results stream in, and verifying: (a) the Go engine process terminates, (b) exactly 20 SweepRunSummary records are persisted, (c) the SweepSession `status` is `cancelled`, and (d) the Quant Matrix renders those 20 partial results.

**Acceptance Scenarios**:

1. **Given** a sweep of 64 runs is in the `running` phase, **When** the Execution Dashboard renders, **Then** a "Cancel Sweep" button is visible and enabled.
2. **Given** a sweep has completed 30 of 100 runs, **When** the user clicks "Cancel Sweep", **Then** the frontend calls `DELETE /optimizer/session/:id` and the API terminates the Go engine child process.
3. **Given** the sweep is cancelled after 30 runs complete, **When** the database is queried, **Then** exactly 30 SweepRunSummary records are persisted and the SweepSession `status` is `cancelled`.
4. **Given** the sweep is cancelled, **When** the UI transitions after cancellation, **Then** the right pane displays the Quant Matrix with the 30 partial results and a visible "Cancelled (30/100)" indicator.
5. **Given** a cancelled SweepSession appears in the history list, **When** the entry renders, **Then** it shows a `(cancelled)` badge alongside its KPIs; `Max ROI` displays the max ROI from partial results persisted before cancellation, or `N/A` if zero runs completed.

---

### Canonical Test Data & Mathematical Proofs *(MANDATORY FOR CORE DOMAIN)*

This spec inherits the Pre-Flight ladder calculations from spec 016. The following additional test cases are binding for the new persistence and ID mapping behavior.

| Input State | Action | Expected Exact Value (Decimal) | Derivation |
|-------------|--------|--------------------------------|------------|
| Engine emits run_id="sweep-001-abc" | API maps to idempotency_key | `"sweep-001-abc"` | Direct mapping: run_id → idempotency_key |
| SweepRunSummary row created | Primary id | UUID (auto-generated) | Database generates its own PK, independent of run_id |
| Sweep of 10 runs completes | SweepSession.total_execution_time_ms | Wall-clock ms from first engine output to last | Measured by API, not summed from individual runs |
| SweepRunSummary persisted for run with roi=14.35 | roi column | `14.35` | Direct from engine output, no re-computation |
| Sweep of 200 runs, 30 pruned for capital, 10 for min order | Pruning breakdown JSON | `{"capital_exceeds_balance": 30, "base_order_below_minimum": 10}` | Grouped count per prune reason |
| Engine env ENABLE_WIDE_EVENTS=false, config enable_wide_events=true | EmitWideEvents (FR-026 OR logic) | `true` | false OR true = true — config payload flag wins |
| Engine env ENABLE_WIDE_EVENTS=true, config enable_wide_events=false | EmitWideEvents (FR-026 OR logic) | `true` | true OR false = true — environment wins |
| Engine env ENABLE_WIDE_EVENTS=false, config enable_wide_events absent | EmitWideEvents (FR-026 OR logic) | `false` | false OR false = false — both absent/false |

**Rationale**: These test cases validate the new persistence layer and ID mapping. Deviations indicate data integrity issues or incorrect mapping between engine output and database schema.

### Edge Cases

- **Sweep history with deleted database rows**: If a SweepSession record is manually deleted, the history list must still render without errors (graceful handling of missing referenced data).
- **Concurrent browser tabs viewing sweep history**: Multiple tabs loading the same sweep history must not cause database contention or stale reads.
- **Year-based quick dates across year boundaries**: If the current date is January 1, 2027, the "Since 2027" button must set start to Jan 1, 2027 and end to Jan 1, 2027 (single day). The "[2026] Only" button must set end to Dec 31, 2026.
- **Promotion of errored sweep run**: If a user attempts to promote a run that originally errored in the sweep, the re-run must proceed with fresh execution (the error was parameter-independent, e.g., engine bug now fixed).
- **Throttle flush with zero new results**: If no results arrive during a 250ms throttle window, the flush must be a no-op (no unnecessary re-renders).
- **enable_wide_events environment override**: Even if `ENABLE_WIDE_EVENTS=false` is set in the environment, a promoted run with `enable_wide_events: true` in the config must emit wide events. Config-level flag takes precedence over environment defaults.
- **Import/Export cross-module compatibility**: Importing an Optimizer config JSON (which may contain sweep mode fields) into the Single Run view must gracefully extract fixed values only, ignoring sweep metadata.
- **Sweep of 1 valid run after pruning**: If a sweep produces only 1 valid config, the sweep must still execute and persist results as normal (degenerate case).
- **Sidebar state persistence**: The collapsed/expanded state of the sidebar should persist across page navigation within the same session.
- **Advanced pruning with extreme volume scale**: A config with a very high `volume_scale` (e.g., 5.0) combined with many safety orders may produce a deeply contracted ladder where late safety-order gaps compress below 0.1%. The `tick_size_violation` check MUST evaluate every consecutive pair in the Pre-Flight ladder, not only the deepest order. A config that passes all other rules but violates tick size at level 8 of 10 MUST still be pruned.
- **All configs pruned exclusively by advanced rules**: If every generated config is pruned solely by the three advanced mathematical rules (with zero violations of capital or min-order rules), the `pruneReasons` breakdown MUST correctly attribute counts to the advanced keys only. Keys with zero violations MUST be present in the response with a count of `0` (not omitted), ensuring the UI tooltip displays all five categories consistently.
- **Cancellation before first result**: If the user clicks "Cancel Sweep" before any run completes, the SweepSession MUST still be persisted as `cancelled` with `total_runs = 0` and no SweepRunSummary records. The Quant Matrix must display an appropriate empty-state message for cancelled sessions.
- **Cancel during SweepRunSummary write**: If a cancellation signal arrives while the API is mid-write for a completed run result, the in-progress write MUST complete before the session is finalized as `cancelled`. The write MUST NOT be abandoned, ensuring no race condition between persistence and process kill.
- **enable_wide_events absent from payload**: If the `enable_wide_events` field is absent from the Go engine's JSON payload (e.g., legacy callers), the engine MUST default to `false` and the OR logic (`env OR config`) handles the absence gracefully without error.

## Requirements *(mandatory)*

### Functional Requirements

**Part 1: Layout, Navigation & Utilities**

- **FR-001**: The application MUST feature a global, collapsible lateral sidebar menu allowing the user to switch between "Backtests" (Single Runs) and "Optimizer" (Sweeps) modules.
- **FR-002**: The sidebar MUST support collapsed (icon-only) and expanded (icon + label) states, with the main content area expanding to fill reclaimed width when collapsed. The sidebar MUST default to expanded on first load; collapsed/expanded state MUST persist within the session.
- **FR-003**: When "Optimizer" is selected, the main view MUST use a 2-pane layout: Left Pane (~25% width) for the sweep history list and Configurator form; Right Pane (~75% width) for the Execution Dashboard and Quant Matrix.
- **FR-004**: The Optimizer left pane MUST display a chronologically sorted list (most recent first) of historically completed sweeps, showing: Date, Trading Pair, Total Runs, and Max ROI per entry. The default display is capped at 50 entries with a "Load More" button for pagination.
- **FR-004b**: Users MUST be able to delete a SweepSession from the history list. Deletion MUST cascade-delete all child SweepRunSummary records.
- **FR-005**: Clicking a past sweep in the history list MUST load its completed SweepRunSummary records into the Quant Matrix in the right pane.
- **FR-006**: The Configurator MUST retain existing quick dates (YTD, Last 6M, Last 30D) AND dynamically generate year-based buttons for the last 5 years: "Since [Year]" (start = Jan 1 of year, end = today) and "[Year] Only" (start = Jan 1, end = Dec 31 of year).
- **FR-007**: The "Import Config" and "Export Config" functionality MUST be available in both the Optimizer Configurator and the Single Run (Backtests) view.

**Part 2: Database & Summary-Only Persistence**

- **FR-008**: The Optimizer MUST NOT persist full tradeEvents or safetyOrderUsage arrays to the database for sweep runs.
- **FR-009**: Each sweep MUST persist a parent SweepSession record containing: `id` (UUID PK), `trading_pair`, `start_date`, `end_date`, `total_runs`, `max_roi`, `total_execution_time_ms`, `status` (`completed` | `cancelled`), `config_snapshot` (JSON), and `created_at`.
- **FR-010**: Each completed run within a sweep MUST persist a child SweepRunSummary record containing: `id` (UUID PK), `session_id` (FK to SweepSession), `run_id` (mapped from engine's `run_id` / config's `idempotency_key`), `config_json`, `roi`, `max_drawdown`, `total_fees`, `win_rate`, `capital_efficiency`, `execution_time_ms`, and `created_at`.
- **FR-011**: The API MUST explicitly map the engine's `run_id` to the config's `idempotency_key` for storage. The database MUST generate its own UUID primary `id` for each row independently.
- **FR-012**: The total wall-clock execution time of the entire sweep MUST be recorded and persisted in the SweepSession's `total_execution_time_ms` field.
- **FR-012b**: If database persistence fails when a sweep completes, the API MUST log the error, emit a `{"type": "persistence_error"}` SSE event on the existing execution stream, and keep results available in-memory for the current session. Results MUST NOT be discarded on persistence failure. The UI `useOptimizer` hook MUST handle this event by displaying a visible warning banner (e.g., "Warning: Database connection lost. Results are in-memory and will be lost on refresh.") so the user knows to export their CSV immediately.
- **FR-013**: The API MUST provide a GET endpoint to retrieve all SweepSession records (for the history list, paginated at 50 per page) and a GET endpoint to retrieve all SweepRunSummary records for a given session (for loading past results). The API MUST also provide a DELETE endpoint for SweepSession that cascade-deletes child SweepRunSummary records.

**Part 3: Configuration & Pre-Flight Insights**

- **FR-014**: The UI footer MUST display combined insights: "Generated: X | Pruned: Y | Valid: Z" alongside boundary metrics: "Drawdown Coverage Range: -X% to -Y%" and "Capital Required Range: $A to $B".
- **FR-015**: The "Pruned: Y" metric MUST include a tooltip or expandable breakdown listing all concrete prune reasons with counts. The five categorised reasons are: `capital_exceeds_balance` ("↳ N exceeded Account Balance"), `base_order_below_minimum` ("↳ N violated Exchange Min Order ($10)"), `guaranteed_fee_loss` ("↳ N guaranteed fee loss (take profit ≤ 0.2% — fixed constant)"), `exceeds_100_percent_drawdown` ("↳ N negative asset price (drawdown > 100%)"), and `tick_size_violation` ("↳ N tick size violation (consecutive SO gap < 0.1%)"; gap evaluated as `gap_pct = (prev_price − curr_price) / prev_price × 100`; prune if any consecutive ladder pair yields `gap_pct < 0.1`).
- **FR-016**: The pruning API response MUST include a `pruneReasons` breakdown object mapping each of the five reason strings to its count, in addition to the aggregate `generated`, `pruned`, and `valid` counts. The three advanced mathematical rules (`guaranteed_fee_loss`, `exceeds_100_percent_drawdown`, `tick_size_violation`) MUST be evaluated using the Go Pre-Flight batch results.

**Part 4: Execution & Real-Time Progress**

- **FR-017**: The Go engine MUST flush each run's result to stdout immediately upon completion. Stdout writes MUST NOT block or contend with other workers' simulation loops.
- **FR-018**: The frontend `useOptimizer` hook MUST throttle or debounce state updates to the Leaderboard and Heatmap components, flushing buffered results at a controlled interval (e.g., every 250ms).
- **FR-019**: The Master Progress Bar MUST increment smoothly with each incoming result, independently of the throttled Leaderboard/Heatmap updates.
- **FR-020**: During high-speed streaming (50+ results/second), the UI MUST remain responsive to user interactions (scrolling, clicking, sorting) without perceptible freeze or input lag.
- **FR-020b**: The Execution Dashboard MUST display a "Cancel Sweep" button while a sweep is in the `running` phase.
- **FR-020c**: The API MUST provide a `DELETE /optimizer/session/:id` endpoint. When called, the API MUST send a kill signal (SIGTERM or equivalent process termination) to the Go engine child process associated with that session.
- **FR-020d**: When a sweep is cancelled, the API MUST: (1) update the SweepSession `status` to `cancelled`; (2) persist all SweepRunSummary records for runs that completed before termination; (3) signal the frontend to transition the right pane to the Quant Matrix displaying the partial results with a visible "Cancelled (N/Total)" indicator.

**Part 5: Selective Promotion Workflow**

- **FR-021**: Every row in the completed Leaderboard Data Grid MUST feature a single action button under the "Actions" column labeled "Re-run with Details" (or equivalent).
- **FR-022**: Clicking the action button MUST grab the row's configuration JSON, set `enable_wide_events: true`, and dispatch a full single backtest run opening in a new browser tab.
- **FR-023**: The Go engine MUST respect `enable_wide_events: true` in the config payload regardless of environment variable defaults. Config-level flag MUST take precedence over environment settings.
- **FR-024**: The promoted single run MUST persist full tradeEvents and safetyOrderUsage to the database (standard single-run behavior with wide events enabled).
- **FR-025 (Engine Payload Update)**: The Go engine's `EngineRequest` JSON schema and internal `Config` struct MUST be updated to accept an optional boolean field: `enable_wide_events`. If absent from the payload, the field MUST default to `false`.
- **FR-026 (Wide Event Logic Override)**: The engine's core event-emission logic MUST evaluate wide events using an OR condition: `EmitWideEvents = (EnvironmentVariable == true) OR (ConfigPayloadFlag == true)`. This guarantees the "Re-run with Details" UI action will always succeed regardless of the server's environment configuration.

### Key Entities

- **SweepSession**: A parent record representing one optimizer sweep (completed or cancelled). Attributes: `id` (UUID PK), `trading_pair`, `start_date`, `end_date`, `total_runs`, `max_roi`, `total_execution_time_ms`, `status` (`completed` | `cancelled`), `config_snapshot` (the full sweep definition as JSON), `created_at`.
- **SweepRunSummary**: A child record for one run within a sweep. Attributes: `id` (UUID PK), `session_id` (FK → SweepSession, cascade delete), `run_id` (engine-assigned, maps to idempotency_key), `config_json` (the individual run's config), `roi`, `max_drawdown`, `total_fees`, `win_rate` (defined as: positions closed at take-profit / total positions closed; safely returns `null` when total positions closed = 0 to prevent divide-by-zero), `capital_efficiency` (defined as: `roi / max_capital_required × 100`, where `max_capital_required` is the Pre-Flight total capital for that config), `execution_time_ms`, `created_at`. Explicitly excludes tradeEvents and safetyOrderUsage.
- **PruneBreakdown**: The categorized counts of pruned configs. Structure: a map of reason string to count. The five defined reason keys are: `capital_exceeds_balance` (total capital required exceeds account balance), `base_order_below_minimum` (base order below exchange minimum of $10), `guaranteed_fee_loss` (`take_profit_distance_percent` ≤ 0.2% — fixed constant representing standard round-trip exchange fee floor; not per-exchange configurable in this spec), `exceeds_100_percent_drawdown` (Pre-Flight `max_drawdown_covered_pct` ≤ -100.0% — grid requires asset price below zero), and `tick_size_violation` (gap between any two consecutive safety orders in the Pre-Flight ladder compresses below 0.1% — violates exchange minimum tick sizes). Example: `{"capital_exceeds_balance": 30, "base_order_below_minimum": 10, "guaranteed_fee_loss": 5, "exceeds_100_percent_drawdown": 2, "tick_size_violation": 3}`.
- **SweepHistoryEntry**: A UI-facing projection of SweepSession for the history list. Fields: date, trading pair, total runs, max ROI.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can switch between Backtests and Optimizer modules in under 1 second via the global sidebar, with zero page reloads.
- **SC-002**: The sidebar collapse/expand transition completes within 300ms with smooth animation.
- **SC-003**: Sweep history loads within 2 seconds showing all past sweeps with correct KPIs (Date, Pair, Runs, Max ROI).
- **SC-004**: A 500-run sweep consumes less than 200KB of database storage (summary-only, no trade-level data).
- **SC-005**: During a sweep emitting 50+ results/second, the UI remains responsive with Leaderboard updates capped at ~4 per second (250ms throttle).
- **SC-006**: The promoted "Re-run with Details" action opens a new tab with 100% parameter fidelity and `enable_wide_events: true` within 2 seconds.
- **SC-007**: Year-based quick-date buttons are dynamically correct for any current year without code changes.
- **SC-008**: Import/Export Config is functional in both Optimizer and Single Run views, with cross-module compatibility (configs exported from one can be imported into the other).
- **SC-009**: The pruning transparency breakdown accounts for 100% of pruned configs — the sum of all per-reason counts equals the total pruned count.
- **SC-010**: Loading a past sweep from history renders its Quant Matrix within 3 seconds for sweeps up to 1,000 runs.

## Assumptions

- The existing Go engine batch execution (spec 016, `--batch-config`) and Pre-Flight math (`--batch-preflight`) are operational and stable. This spec builds on top of them.
- The existing ClickHouse market-data integration (spec 008) is operational.
- The existing Node.js SweepService (Cartesian product + pruning) from spec 016 is operational. This spec extends the pruning API to include a per-reason breakdown.
- The database system (PostgreSQL via Drizzle ORM) supports the new SweepSession and SweepRunSummary tables. Schema migrations will be created for these tables.
- The Single Run view has an existing form that can accept pre-filled parameters via navigation state (already implemented via `navigate('/', { state: { prefillConfig } })`).
- Exchange minimum order size defaults to $10 unless otherwise configured.
- Only one sweep may execute at a time per user session (inherited constraint from spec 016).
- The 10,000 combination hard limit from spec 016 remains in effect.