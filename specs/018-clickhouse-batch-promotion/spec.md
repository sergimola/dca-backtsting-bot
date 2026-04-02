# Feature Specification: ClickHouse Batch Promotion & Time-in-Market KPIs

**Feature Branch**: `018-clickhouse-batch-promotion`
**Created**: 2026-04-02
**Status**: Draft
**Input**: Time-in-Market KPIs, ClickHouse deep analytics, and Batch Promotion mini-sweep workflow for Grafana integration. Builds on top of the existing Pro Optimizer (Feature 017).

**Constitution Gates (MANDATORY)**:
- **Green Light Protocol**: All existing Go engine tests (`go test ./...`) and orchestrator API tests (`npx jest`) must remain green. New tests must cover: Time-in-Market KPI calculation (including open-at-end edge case), ClickHouse `sweep_wide_events` table insert/query, batch promotion API endpoint, mini-sweep execution, duplicate guard behavior, and partition drop on session deletion. No merge permitted with failing tests.
- **Fixed-point arithmetic**: All monetary calculations in the Go engine MUST use `decimal.Decimal`. The `longest_trade_duration_ms` and `max_safety_orders_used` fields are integer metrics and do not require decimal handling. The Node.js API MUST use `decimal.js` for any monetary aggregation.
- **BDD acceptance criteria**: Each user story below has traceable Given/When/Then scenarios covering: Time-in-Market KPI computation, ClickHouse wide-event bulk insertion, multi-row selection and batch promotion, mini-sweep execution, duplicate guard protection, Grafana session/config dropdowns, and dual-database cleanup on session deletion.

**Scope Boundary**: This spec is strictly additive to Feature 017 (Pro Optimizer Workspace). It does NOT redefine any existing Optimizer functionality including: global sidebar navigation, quick dates, baseline summary persistence, standard pruning, throttled rendering, or single-run promotion. All baseline behavior defined in spec 017 is inherited unchanged.

## Clarifications

### Session 2026-04-02

- Q: Which duplicate guard strategy should the spec commit to — pre-deletion or ReplacingMergeTree? → A: Pre-deletion (`ALTER TABLE ... DELETE WHERE session_id = ? AND run_id = ?`). Provides immediate consistency without requiring `FINAL` on every Grafana query. Mutation latency is acceptable since re-promotion is a rare, user-initiated action.
- Q: Who inserts wide events into ClickHouse during batch promotion — Go engine direct-write or Node.js API relay? → A: Node.js API relay. The Go engine streams wide events to stdout (existing pattern), and the Node.js API layer intercepts and batch-inserts into ClickHouse. Consistent with the spec 008 downloader pattern where Node.js writes to ClickHouse.
- Q: Does the promoted badge persist across page loads, requiring a new Postgres column? → A: Yes. Add a `promoted_at` nullable timestamp column to `SweepRunSummary`. The API sets this when promotion completes for each run_id. A timestamp is more informative than a boolean, enabling "promoted 2h ago" display.
- Q: Can the user cancel a batch promotion in progress? → A: Yes. Mirror the sweep cancellation pattern (spec 017 FR-020b/c/d). A "Cancel Promotion" button appears during active promotion. The API sends SIGTERM to the mini-sweep Go engine process. Partially promoted runs that already inserted into ClickHouse are retained (valid data).
- Q: Should Grafana panels go on an existing dashboard or a new dedicated one? → A: New dedicated dashboard (`04-sweep-promoted-comparison.json`). Existing dashboards (01-run-overview, 02-wide-events-deep-dive, 03-narrow-events-timeline) serve different analytical purposes. A dedicated dashboard keeps sweep-comparison concerns separated.

### Review Session 2026-04-02 (Post-Draft)

- Q: Should `session_id` and `run_id` in the ClickHouse `sweep_wide_events` table use `String` or `UUID`? → A: ClickHouse's native `UUID` type (16-byte fixed-width). Uses less than half the disk space of a String representation and is significantly faster for indexing and partitioning. Updated FR-016 and Key Entities.
- Q: Should the batch promotion API accept `config_json` from the frontend? → A: No. The frontend sends only `run_id` strings. The Node.js backend retrieves pristine `config_json` directly from the PostgreSQL `SweepRunSummary` table. This reduces network payload size and prevents a bad actor from altering the config before promoting it. Updated FR-018, FR-019, FR-020, BatchPromotionRequest entity, and Story 3 scenario 5.
- Q: What happens when a promoted run generates fewer events than the 1,000-row batch minimum? → A: The Node.js API MUST flush any remaining buffered events to ClickHouse immediately when the Go engine process exits (stdout stream closes), regardless of the 1,000-row minimum. Without this flush-on-exit rule, promoting a single run with 350 events would hang forever. Updated FR-022.

### Clarification Session 2026-04-02 (Ambiguity Scan)

- Q: What does `backtest_end_timestamp` mean in FR-002 for the open-at-end duration calculation? → A: The timestamp of the last candle processed by the engine. This is deterministic regardless of clock skew and represents the actual boundary of market data consumed. Updated FR-002.
- Q: How does the Node.js API attribute each wide event to a `run_id` when the Go engine runs multiple configs in parallel and stdout is interleaved? → A: Each wide event JSON line emitted by the Go engine MUST include a `run_id` field so the Node.js insertion layer can tag events correctly during interleaved parallel output. Updated FR-005b and FR-021.
- Q: Is there an upper bound on how many configs can be promoted in a single batch? → A: Hard cap of 200 configs per promotion request. Prevents accidental mass re-runs (e.g., "select all" on 70k rows) while allowing substantial comparison sets for deep analysis. Updated FR-019 and edge cases.
- Q: How does the API report mini-sweep progress — SSE stream or polling? → A: SSE stream on the promotion endpoint, consistent with the sweep execution streaming pattern from spec 017. Updated FR-023.
- Q: What happens if a user triggers a second batch promotion while one is already running for the same session? → A: The API returns 409 Conflict. The UI disables the "Batch Promote" button during active promotion for that session. Updated FR-019b and edge cases.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Time-in-Market KPI Computation (Priority: P1)

The Go engine computes two new integer metrics for every backtest run: `longest_trade_duration_ms` (the maximum time any single position was held open) and `max_safety_orders_used` (the deepest safety order rung hit during the entire backtest). These metrics are included in the engine's JSON result payload and persisted alongside existing summary fields in the PostgreSQL `SweepRunSummary` entity. The analyst uses these KPIs to identify configurations that avoid getting "stuck" in excessively long trades or overly deep safety-order cascades.

**Why this priority**: These KPIs are the foundational filter criteria that enable the entire downstream workflow. Without them, the analyst cannot distinguish between a high-ROI config that exits trades quickly and one that holds positions for weeks. Every subsequent story depends on these metrics being available in the Leaderboard.

**Independent Test**: Can be fully tested by running a single backtest with known trade durations and safety-order depths, then asserting the engine output contains the exact expected values for both fields.

**Acceptance Scenarios**:

1. **Given** a backtest where three positions are opened and closed with durations of 3,600,000ms, 7,200,000ms, and 1,800,000ms, **When** the engine emits the result, **Then** `longest_trade_duration_ms` equals `7200000`.
2. **Given** a backtest where safety orders 1, 2, and 3 are triggered on one position and safety orders 1 and 2 on another, **When** the engine emits the result, **Then** `max_safety_orders_used` equals `3`.
3. **Given** a backtest where a position is opened at timestamp `T1` and remains open when the backtest ends at timestamp `T_end`, **When** the engine calculates `longest_trade_duration_ms`, **Then** it uses `T_end - T1` as the duration for that position (not infinity, not zero, not excluded).
4. **Given** a backtest where no safety orders are triggered (all positions close on the base order alone), **When** the engine emits the result, **Then** `max_safety_orders_used` equals `0`.
5. **Given** a backtest where no positions are opened at all, **When** the engine emits the result, **Then** `longest_trade_duration_ms` equals `0` and `max_safety_orders_used` equals `0`.
6. **Given** the engine emits a result with `longest_trade_duration_ms` and `max_safety_orders_used`, **When** the API persists the SweepRunSummary, **Then** both fields are stored as integer columns matching the engine output exactly.

---

### User Story 2 — Leaderboard Time-in-Market Columns & Filtering (Priority: P2)

The UI Leaderboard (Quant Matrix) displays two new columns: "Longest Trade" (formatted as human-readable duration, e.g., "2d 4h 30m") and "Max SOs Used". The analyst can sort and filter by these columns to identify configurations that trade efficiently. A typical workflow is filtering to configs where `longest_trade_duration_ms` is below a user-defined threshold and `max_safety_orders_used` stays within an acceptable depth.

**Why this priority**: The KPIs from Story 1 are only useful if the analyst can see, sort, and filter them in the Leaderboard. This story is the UI counterpart that makes the data actionable.

**Independent Test**: Can be fully tested by loading a completed sweep with known Time-in-Market values, verifying both columns render with correct formatting, and applying sort/filter operations to confirm correct ordering and subset selection.

**Acceptance Scenarios**:

1. **Given** a completed sweep with SweepRunSummary data loaded into the Leaderboard, **When** the grid renders, **Then** two new columns "Longest Trade" and "Max SOs Used" are visible alongside existing columns (ROI, Max Drawdown, etc.).
2. **Given** a row with `longest_trade_duration_ms = 180000000` (50 hours), **When** the "Longest Trade" column renders, **Then** it displays "2d 2h 0m" (human-readable duration).
3. **Given** the user clicks the "Longest Trade" column header, **When** sort is applied, **Then** the Leaderboard rows reorder by `longest_trade_duration_ms` (ascending or descending toggle).
4. **Given** the user applies a filter: `longest_trade_duration_ms < 86400000` (less than 24 hours), **When** the filter executes, **Then** only rows with trades shorter than 24 hours are displayed.
5. **Given** a row with `max_safety_orders_used = 5`, **When** the "Max SOs Used" column renders, **Then** it displays the integer `5`.
6. **Given** the user applies a combined filter: `longest_trade_duration_ms < 172800000` AND `max_safety_orders_used <= 4`, **When** the filter executes, **Then** only rows matching both criteria remain visible.

---

### User Story 3 — Multi-Row Selection & Batch Promote Action (Priority: P3)

The Leaderboard gains multi-row selection capability via checkboxes. When one or more rows are selected, a bulk action toolbar appears with a "Batch Promote to ClickHouse" button. Clicking this button initiates the batch promotion workflow: the selected configurations are sent to the API, which triggers a secondary Go engine mini-sweep that re-runs only those specific configs with `enable_wide_events: true`, streaming the resulting wide events directly into the ClickHouse `sweep_wide_events` table.

**Why this priority**: Batch promotion is the core new workflow that bridges the summary-only Optimizer with deep ClickHouse analytics. Without it, the analyst has no way to selectively generate wide events for top configurations without re-running the entire sweep.

**Independent Test**: Can be fully tested by rendering a completed Leaderboard with 100 rows, selecting 5 rows via checkboxes, clicking "Batch Promote to ClickHouse", and verifying: (a) the API receives exactly those 5 configs, (b) the Go engine runs exactly 5 backtests with `enable_wide_events: true`, and (c) wide events appear in the ClickHouse `sweep_wide_events` table partitioned by the parent session_id.

**Acceptance Scenarios**:

1. **Given** the Leaderboard is in the completed state, **When** the grid renders, **Then** each row has a selection checkbox in the first column.
2. **Given** no rows are selected, **When** the toolbar area above the grid renders, **Then** the "Batch Promote to ClickHouse" button is disabled or hidden.
3. **Given** the user selects 10 rows via checkboxes, **When** the toolbar renders, **Then** it displays "10 selected" and the "Batch Promote to ClickHouse" button is enabled.
4. **Given** a "select all" checkbox is available in the header, **When** the user clicks it, **Then** all currently visible (filtered) rows are selected.
5. **Given** the user selects 50 rows and clicks "Batch Promote to ClickHouse", **When** the action fires, **Then** the frontend sends a POST request to `/optimizer/session/:sessionId/promote` containing an array of 50 `run_id` strings. The backend retrieves the `config_json` for each from PostgreSQL.
6. **Given** the batch promotion API call is in progress, **When** the UI renders, **Then** a progress indicator shows the mini-sweep execution status (e.g., "Promoting 15/50 configs...").
7. **Given** the mini-sweep completes all 50 runs, **When** the user checks the Leaderboard, **Then** promoted rows display a visual indicator (e.g., a badge or icon) showing they have been promoted to ClickHouse. This badge MUST persist across page loads by reading the `promoted_at` column from the SweepRunSummary record.
8. **Given** a batch promotion is in progress (status = `running`), **When** the user clicks "Cancel Promotion", **Then** the mini-sweep Go engine process is terminated, partially promoted runs retain their ClickHouse data, and the promotion status transitions to `cancelled`.

---

### User Story 4 — Mini-Sweep Engine Execution with ClickHouse Insertion (Priority: P4)

The API receives the batch promotion request (array of run_ids and configs), spawns a Go engine batch execution with `enable_wide_events: true` for only the selected configurations, and the engine streams wide events directly into the ClickHouse `sweep_wide_events` table. Each wide event row is tagged with the parent `session_id` and its `run_id`. The standard massive parameter sweep remains "summary-only" in Postgres and writes NOTHING to ClickHouse (zero initial bloat).

**Why this priority**: This is the engine and data-pipeline backbone for the batch promotion. Without it, the UI button from Story 3 has nothing to call.

**Independent Test**: Can be fully tested by calling the batch promotion API with 3 configs, asserting the Go engine runs exactly 3 times with wide events enabled, and querying ClickHouse to verify the `sweep_wide_events` table contains wide event rows for all 3 run_ids under the correct session_id partition.

**Acceptance Scenarios**:

1. **Given** a standard 70,000-run optimizer sweep completes, **When** the database is queried, **Then** zero rows exist in ClickHouse `sweep_wide_events` — only Postgres SweepRunSummary records exist.
2. **Given** the API receives a batch promotion request with `session_id = "sess-abc"` and 5 run configs, **When** the Go engine runs, **Then** it executes exactly 5 backtests with `enable_wide_events: true`.
3. **Given** the Go engine emits wide events for a promoted run, **When** the events are inserted into ClickHouse, **Then** each row in `sweep_wide_events` contains the `session_id`, `run_id`, and the full event payload.
4. **Given** wide events are being inserted, **When** the batch insert executes, **Then** rows are inserted in bulk batches (minimum 1,000 rows per insert, consistent with the ClickHouse batching rule from spec 008).
5. **Given** a promoted run generates 500 wide events, **When** all are inserted, **Then** querying `SELECT count(*) FROM sweep_wide_events WHERE session_id = 'sess-abc' AND run_id = 'run-xyz'` returns exactly 500.
6. **Given** the mini-sweep encounters an error on 1 of 5 configs, **When** the error occurs, **Then** the other 4 configs still complete and their wide events are inserted. The errored run is reported back to the UI without aborting the entire batch.

---

### User Story 5 — Duplicate Guard for Re-Promotion (Priority: P5)

If an analyst re-promotes a run that was already promoted (e.g., they want fresh data after changing analysis parameters), the system prevents duplicate timeline data in ClickHouse. The duplicate guard ensures that re-promoting a previously promoted run_id within the same session_id results in a clean replacement of the old data, not an append that doubles the event count.

**Why this priority**: Without duplicate protection, re-promoting a run would silently double all wide events for that run_id, corrupting Grafana timelines with phantom duplicate entries. This is a data integrity safeguard.

**Independent Test**: Can be fully tested by promoting run_id "run-abc" under session "sess-123", verifying 500 events exist, then re-promoting the same run_id, and verifying that exactly 500 events exist (not 1,000).

**Acceptance Scenarios**:

1. **Given** run_id "run-abc" under session "sess-123" was previously promoted with 500 wide events in ClickHouse, **When** the user re-promotes "run-abc", **Then** the old 500 events are replaced and the final count is exactly the number of events from the new execution.
2. **Given** a re-promotion request arrives for run_id "run-abc", **When** the pre-deletion guard executes, **Then** the system runs `ALTER TABLE sweep_wide_events DELETE WHERE session_id = 'sess-123' AND run_id = 'run-abc'` before inserting new events.
3. **Given** a batch promotion request contains 10 run_ids where 3 were previously promoted (have non-null `promoted_at`), **When** the batch executes, **Then** only those 3 run_ids have their old data pre-deleted; the other 7 are fresh inserts with no pre-deletion overhead.
4. **Given** a run is successfully re-promoted, **When** the new events are inserted, **Then** the `promoted_at` timestamp on the SweepRunSummary record is updated to the current time.

---

### User Story 6 — Grafana Dynamic Dropdowns for Promoted Sessions (Priority: P6)

The analyst opens Grafana and navigates to the sweep deep-dive dashboard. A dynamic "Session" dropdown queries ClickHouse for distinct `session_id` values in `sweep_wide_events`, showing only sessions that have promoted data. After selecting a session, a second dynamic "Config" dropdown populates with the `run_id` values available for that session. The analyst selects one or more configs to compare their trade timelines and safety-order cascades side-by-side.

**Why this priority**: Grafana integration is the ultimate analytical payoff of the entire workflow. Without dynamic dropdowns, the analyst would need to manually type session and run IDs into Grafana queries, making the ClickHouse data practically inaccessible.

**Independent Test**: Can be fully tested by inserting test data into ClickHouse `sweep_wide_events` for 2 sessions with 3 run_ids each, opening the Grafana dashboard, and verifying: (a) the Session dropdown shows both sessions, (b) selecting one populates the Config dropdown with its 3 run_ids, and (c) selecting a run_id renders the timeline panel.

**Acceptance Scenarios**:

1. **Given** ClickHouse contains promoted data for sessions "sess-A" and "sess-B", **When** the Grafana Session dropdown loads, **Then** it lists both "sess-A" and "sess-B" (and no sessions that have zero promoted data).
2. **Given** session "sess-A" has promoted run_ids ["run-1", "run-2", "run-3"], **When** the analyst selects "sess-A" in the Session dropdown, **Then** the Config dropdown populates with ["run-1", "run-2", "run-3"].
3. **Given** the analyst selects "run-1" and "run-2" from the Config dropdown, **When** the Grafana panels render, **Then** trade timelines and safety-order cascade charts display data for both runs side-by-side.
4. **Given** a session has no promoted data in ClickHouse (all data is summary-only in Postgres), **When** the Grafana Session dropdown loads, **Then** that session does NOT appear in the dropdown.

---

### User Story 7 — Dual-Database Cleanup on Session Deletion (Priority: P7)

When the analyst deletes a SweepSession from the Optimizer history list, the system cleans up both databases: the existing Postgres cascade delete removes the SweepSession and all child SweepRunSummary records (existing behavior from spec 017), and additionally, a `DROP PARTITION` command is executed against ClickHouse to instantly remove all `sweep_wide_events` data for that session_id. This is a zero-scan, metadata-only operation for instant space reclamation.

**Why this priority**: Data lifecycle management is essential to prevent orphaned ClickHouse data when sessions are deleted. Without this, deleted sessions would leave behind gigabytes of unreferenced wide events in ClickHouse, wasting storage indefinitely.

**Independent Test**: Can be fully tested by creating a session, promoting 10 runs to ClickHouse, deleting the session from the UI, and verifying: (a) Postgres SweepSession and SweepRunSummary records are gone, and (b) `SELECT count(*) FROM sweep_wide_events WHERE session_id = '<deleted-id>'` returns 0.

**Acceptance Scenarios**:

1. **Given** session "sess-abc" exists in Postgres and has promoted wide events in ClickHouse, **When** the user deletes "sess-abc" from the UI history, **Then** the API cascade-deletes the Postgres records AND executes `ALTER TABLE sweep_wide_events DROP PARTITION 'sess-abc'` in ClickHouse.
2. **Given** session "sess-xyz" exists in Postgres but has NO promoted data in ClickHouse (no batch promotion was done), **When** the user deletes "sess-xyz", **Then** only the Postgres cascade delete occurs. The ClickHouse `DROP PARTITION` command executes harmlessly (no error for a non-existent partition).
3. **Given** the ClickHouse `DROP PARTITION` command executes for a session with 10 million wide event rows, **When** the operation completes, **Then** it finishes in under 1 second (metadata-only, no row scanning).
4. **Given** the Postgres delete succeeds but the ClickHouse `DROP PARTITION` fails (e.g., ClickHouse is temporarily unreachable), **When** the error occurs, **Then** the API logs the error and returns a warning to the UI indicating partial cleanup. The Postgres deletion is NOT rolled back.

---

### Canonical Test Data & Mathematical Proofs *(MANDATORY FOR CORE DOMAIN)*

This spec inherits all test data from spec 017. The following additional test cases are binding for the new Time-in-Market KPIs and ClickHouse behavior.

| Input State | Action | Expected Exact Value | Derivation |
|-------------|--------|----------------------|------------|
| Position opens at T=1000000, TP hit at T=4600000 | Compute trade duration | `3600000` (ms) | `4600000 - 1000000 = 3600000` |
| Position opens at T=1000000, backtest ends at T=8000000, position still open | Compute trade duration | `7000000` (ms) | `8000000 - 1000000 = 7000000` (open-at-end rule) |
| Three positions: durations 3600000, 7200000, 1800000 | longest_trade_duration_ms | `7200000` | `max(3600000, 7200000, 1800000)` |
| Position triggers SO1 and SO2; another triggers SO1, SO2, SO3 | max_safety_orders_used | `3` | `max(2, 3) = 3` |
| No positions opened during entire backtest | Both KPIs | `0`, `0` | No data → zero for both |
| Backtest with 1 position, base order only, no SOs | max_safety_orders_used | `0` | No safety orders triggered |
| Re-promote run "run-abc" (500 events existing) | ClickHouse count after re-promotion | `500` (new run) | Old 500 deleted, new 500 inserted |
| Standard 70k sweep completes | ClickHouse sweep_wide_events count | `0` | Summary-only sweeps write nothing to ClickHouse |

**Rationale**: These test cases validate the Time-in-Market calculation rules (especially the open-at-end edge case) and the zero-initial-bloat invariant for ClickHouse.

### Edge Cases

- **Position open at backtest end**: The `longest_trade_duration_ms` calculation MUST use `backtest_end_timestamp - entry_timestamp` for any position still open when the backtest terminates. It MUST NOT be excluded, set to zero, or set to infinity.
- **Multiple positions open at backtest end**: If multiple positions are still open at backtest end, each has its duration calculated using the end timestamp, and `longest_trade_duration_ms` takes the maximum across all positions (both closed and open-at-end).
- **Zero positions opened**: Both `longest_trade_duration_ms` and `max_safety_orders_used` MUST be `0` — not `null`, not `-1`.
- **Batch promotion with zero rows selected**: The "Batch Promote to ClickHouse" button MUST be disabled when no rows are selected. The API MUST reject requests with an empty `run_ids` array (400 Bad Request).
- **ClickHouse unreachable during promotion**: If ClickHouse is down when the mini-sweep tries to insert wide events, the API MUST return an error to the UI. Already-computed engine results for that promotion batch are lost (they are not cached in Postgres).
- **Concurrent promotions for the same session**: If two browser tabs initiate batch promotions for the same session simultaneously, each promotion MUST use the duplicate guard independently. The final ClickHouse state MUST be consistent (no partial duplicates).
- **Session deletion during active promotion**: If the user deletes a session while a batch promotion mini-sweep is in progress, the deletion MUST wait for the mini-sweep to complete or cancel it before cleaning up. The system MUST NOT leave orphaned ClickHouse data from a half-completed promotion.
- **ClickHouse partition granularity**: Since `PARTITION BY session_id`, one session = one partition. Dropping a partition removes ALL promoted run data for that session, including all run_ids.
- **Promoting a run that originally errored in the sweep**: The re-run via batch promotion is a fresh execution. If the original error was transient (e.g., engine bug since fixed), the promoted run may succeed.
- **Grafana dropdown with deleted session**: If a session is deleted from Postgres but ClickHouse cleanup failed, the Grafana Session dropdown will still show that session. The data remains queryable until manually cleaned up.
- **Very large promotion batch**: Promoting more than 200 configs in one batch is rejected by the API (400 Bad Request, hard cap per FR-019). This prevents accidental mass re-runs (e.g., "select all" on 70k filtered rows). The engine processes accepted batches in its standard parallel-worker pool, and ClickHouse inserts must use batching.
- **Promotion cancellation with partial inserts**: If the user cancels a promotion after 20 of 50 runs complete, the 20 completed runs retain their ClickHouse wide events and their `promoted_at` timestamps in Postgres. The remaining 30 runs have `promoted_at = null` and no ClickHouse data.
- **Badge persistence on page reload**: The "promoted" badge on Leaderboard rows is driven by the `promoted_at` column, not transient UI state. Navigating away and returning, or loading from sweep history, MUST still show the badge for promoted runs.
- **Double-click promotion race**: If the user clicks "Batch Promote" and the request is already in flight for that session, the API returns 409 Conflict. The UI MUST disable the button during active promotion to prevent this at the UX layer.

## Requirements *(mandatory)*

### Functional Requirements

**Part 1: Time-in-Market KPIs (Go Engine & Postgres)**

- **FR-001**: The Go engine MUST compute `longest_trade_duration_ms` for every backtest run, defined as the maximum duration (in milliseconds) of any single position from entry to take-profit exit.
- **FR-002**: If a position is still open when the backtest ends, the Go engine MUST calculate that position's duration as `backtest_end_timestamp - entry_timestamp`. This value MUST participate in the maximum calculation for `longest_trade_duration_ms`. The `backtest_end_timestamp` is defined as the timestamp of the last candle processed by the engine — this is deterministic and represents the actual boundary of market data consumed, regardless of wall-clock time or config end-date.
- **FR-003**: The Go engine MUST compute `max_safety_orders_used` for every backtest run, defined as the highest safety order rung triggered across all positions during the entire backtest.
- **FR-004**: If no positions are opened during a backtest, both `longest_trade_duration_ms` and `max_safety_orders_used` MUST be `0`.
- **FR-005**: The Go engine's JSON result payload MUST include both `longest_trade_duration_ms` (integer) and `max_safety_orders_used` (integer) alongside existing fields.
- **FR-005b**: Every wide event JSON line emitted by the Go engine to stdout MUST include a `run_id` field identifying the originating backtest run. This is required because during batch promotion the engine runs multiple configs in parallel and stdout output is interleaved — the Node.js insertion layer depends on this field to correctly attribute each event to its `run_id` in ClickHouse.
- **FR-006**: The PostgreSQL `SweepRunSummary` entity MUST be updated with two new integer columns: `longest_trade_duration_ms` and `max_safety_orders_used`, plus one new nullable timestamp column: `promoted_at`. The integer columns MUST be populated from the engine output during summary persistence. The `promoted_at` column defaults to `null` and is set when the run's wide events are successfully inserted into ClickHouse.
- **FR-007**: The API GET endpoint for SweepRunSummary records MUST include both new fields in the response payload so the frontend can display and filter by them.

**Part 2: Leaderboard UI Enhancements**

- **FR-008**: The UI Leaderboard MUST display a "Longest Trade" column showing `longest_trade_duration_ms` formatted as a human-readable duration (e.g., "2d 4h 30m").
- **FR-009**: The UI Leaderboard MUST display a "Max SOs Used" column showing `max_safety_orders_used` as a plain integer.
- **FR-010**: Both new columns MUST be sortable (ascending/descending toggle on column header click).
- **FR-011**: The Leaderboard MUST support filtering by both new columns (e.g., "Longest Trade < 24h", "Max SOs Used <= 4").
- **FR-012**: The Leaderboard MUST support multi-row selection via checkboxes in the first column, with a "select all visible" checkbox in the header.
- **FR-013**: When one or more rows are selected, a bulk action toolbar MUST appear above the grid displaying the selection count and a "Batch Promote to ClickHouse" button. The button MUST be disabled when no rows are selected.

**Part 3: ClickHouse `sweep_wide_events` Table**

- **FR-014**: A new ClickHouse table named `sweep_wide_events` MUST be created to store promoted wide events.
- **FR-015**: The `sweep_wide_events` table MUST be partitioned by `session_id` using `PARTITION BY session_id`.
- **FR-016**: The table schema MUST include at minimum: `session_id` (UUID), `run_id` (UUID), `event_type` (String), `timestamp` (UInt64), and the full wide-event payload fields as defined in existing wide-event schemas. `session_id` and `run_id` MUST use ClickHouse's native `UUID` type (16-byte fixed-width) — not `String` — for reduced disk footprint and faster indexing/partitioning.
- **FR-017**: A standard optimizer parameter sweep (of any size) MUST write ZERO rows to the ClickHouse `sweep_wide_events` table. Only explicitly promoted runs write to ClickHouse.

**Part 4: Batch Promotion API & Mini-Sweep**

- **FR-018**: The API MUST expose a POST endpoint (e.g., `POST /optimizer/session/:sessionId/promote`) that accepts a JSON body containing an array of `run_id` strings. The frontend MUST NOT send `config_json` in the request payload — this reduces bandwidth and prevents client-side config tampering.
- **FR-019**: The API MUST validate the request: the `session_id` must exist in Postgres, the array must not be empty, the array must not exceed 200 `run_id` entries (hard cap to prevent accidental mass re-runs), and each `run_id` must correspond to an existing SweepRunSummary under that session. The API MUST then retrieve the pristine `config_json` for each validated `run_id` directly from the PostgreSQL `SweepRunSummary` table. Requests exceeding 200 entries MUST be rejected with 400 Bad Request.
- **FR-019b**: The API MUST reject a promotion request with 409 Conflict if a batch promotion is already running for the same `session_id`. The UI MUST disable the "Batch Promote to ClickHouse" button while a promotion is active for the current session.
- **FR-020**: Upon receiving a valid promotion request, the API MUST spawn a Go engine batch execution with `enable_wide_events: true` for ONLY the submitted configurations, using the server-retrieved `config_json` (not client-supplied data).
- **FR-021**: The Go engine MUST stream the resulting wide events to stdout (existing pattern), with each event JSON line including the `run_id` field (per FR-005b). The Node.js API layer MUST intercept these wide events from the engine's stdout stream, read the `run_id` from each event to attribute it correctly, and bulk-insert them into the ClickHouse `sweep_wide_events` table tagged with the parent `session_id`. The Go engine MUST NOT write directly to ClickHouse for wide events.
- **FR-022**: Wide event inserts into ClickHouse MUST use bulk batches (minimum 1,000 rows per insert), consistent with the ClickHouse batching rule established in spec 008. However, the Node.js API MUST flush any remaining buffered events to ClickHouse immediately when the Go engine process exits (stdout stream closes), regardless of whether the buffer has reached the 1,000-row minimum. This flush-on-exit rule prevents the promotion from hanging when a run generates fewer events than the batch threshold.
- **FR-023**: The API MUST report mini-sweep progress back to the frontend via an SSE (Server-Sent Events) stream on the promotion endpoint, consistent with the sweep execution streaming pattern from spec 017. The SSE stream MUST emit progress events (e.g., `{"type": "promotion_progress", "completed": 15, "total": 50}`) so the UI can display a real-time promotion progress indicator.
- **FR-024**: If individual runs within a batch promotion fail, the remaining runs MUST still complete. Failed runs MUST be reported back to the UI without aborting the entire batch.
- **FR-024b**: The API MUST update the `promoted_at` timestamp column on each successfully promoted `SweepRunSummary` record in Postgres upon completion of that run's wide-event insertion into ClickHouse.
- **FR-024c**: The promotion workflow MUST support user-initiated cancellation. A "Cancel Promotion" button MUST appear in the UI during active promotion. On click, the API MUST send SIGTERM to the mini-sweep Go engine process. Wide events already inserted into ClickHouse for completed runs within the batch MUST be retained (valid data). The promotion status MUST transition to `cancelled`.

**Part 5: Duplicate Guard (Pre-Deletion Strategy)**

- **FR-025**: Before inserting wide events for a promoted run, the system MUST execute `ALTER TABLE sweep_wide_events DELETE WHERE session_id = '<session_id>' AND run_id = '<run_id>'` to remove any existing wide events for that combination. This pre-deletion strategy provides immediate consistency without requiring `FINAL` on Grafana read queries.
- **FR-026**: The duplicate guard MUST ensure that after re-promoting a run_id, the event count in ClickHouse equals exactly the number of events from the latest execution (no residual data from prior promotions).
- **FR-027**: For batch promotions containing a mix of new and previously-promoted run_ids, the duplicate guard MUST apply only to the previously-promoted run_ids. Fresh run_ids MUST NOT incur pre-deletion overhead.
- **FR-027b**: The `sweep_wide_events` table MUST use the `MergeTree` engine family (not `ReplacingMergeTree`), since duplicate prevention is handled by pre-deletion and `ReplacingMergeTree`'s eventual-consistency model and `FINAL` query overhead are unnecessary.

**Part 6: Grafana Integration (New Dashboard: `04-sweep-promoted-comparison.json`)**

- **FR-028**: A NEW Grafana dashboard (`04-sweep-promoted-comparison.json`) MUST be created, separate from existing dashboards (01-run-overview, 02-wide-events-deep-dive, 03-narrow-events-timeline). This dashboard is dedicated to comparing promoted sweep configurations.
- **FR-028b**: The dashboard MUST include a dynamic "Session" template variable that queries `SELECT DISTINCT session_id FROM sweep_wide_events` to populate the dropdown.
- **FR-029**: A second dynamic "Config" template variable MUST query `SELECT DISTINCT run_id FROM sweep_wide_events WHERE session_id = '$session'` to populate the config dropdown, dependent on the selected session.
- **FR-030**: The dashboard MUST include panels for trade timelines and safety-order cascade visualizations, filterable by the Session and Config dropdowns.
- **FR-031**: Multi-select MUST be enabled on the Config dropdown so the analyst can compare multiple promoted configs side-by-side on the same panel.

**Part 7: Dual-Database Cleanup (Data Lifecycle)**

- **FR-032**: When a SweepSession is deleted via the existing `DELETE /optimizer/session/:id` endpoint, the API MUST additionally execute `ALTER TABLE sweep_wide_events DROP PARTITION '<session_id>'` against ClickHouse.
- **FR-033**: The Postgres cascade delete (SweepSession → SweepRunSummary) MUST execute first. The ClickHouse partition drop is a best-effort follow-up.
- **FR-034**: If the ClickHouse partition drop fails (e.g., ClickHouse unreachable), the API MUST log the error and return a warning to the caller. The Postgres deletion MUST NOT be rolled back.
- **FR-035**: The ClickHouse `DROP PARTITION` operation MUST be a metadata-only operation (no row scanning), ensuring near-instant execution regardless of partition size.

### Key Entities

- **SweepRunSummary (Updated)**: Extends the spec 017 entity with two new integer columns: `longest_trade_duration_ms` (maximum trade hold time in milliseconds, including open-at-end positions measured to backtest end) and `max_safety_orders_used` (deepest safety order rung hit during the backtest), plus one new nullable timestamp column: `promoted_at` (set when the run's wide events are successfully inserted into ClickHouse; `null` if never promoted). All other columns remain unchanged per spec 017.
- **sweep_wide_events (New — ClickHouse)**: A ClickHouse table storing promoted wide events using the `MergeTree` engine family (not `ReplacingMergeTree`). Duplicate prevention is handled by pre-deletion before insert. Key columns: `session_id` (UUID, partition key), `run_id` (UUID), `event_type` (String), `timestamp` (UInt64), plus full wide-event payload fields. `session_id` and `run_id` use ClickHouse's native `UUID` type (16-byte fixed-width) for reduced disk footprint and faster indexing. Partitioned by `session_id` for instant partition-level operations.
- **BatchPromotionRequest (New)**: The API request payload for batch promotion. Structure: `{ run_ids: string[] }` (session_id is provided via the URL path parameter). The frontend sends only `run_id` references; the backend retrieves `config_json` from PostgreSQL to prevent client-side tampering.
- **BatchPromotionStatus (New)**: A transient status object tracking mini-sweep progress. Fields: `session_id`, `total`, `completed`, `failed`, `status` (`running` | `completed` | `failed` | `cancelled`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Both Time-in-Market KPIs (`longest_trade_duration_ms`, `max_safety_orders_used`) are correctly computed, returned in the engine payload, and persisted for 100% of sweep runs.
- **SC-002**: The analyst can sort and filter the Leaderboard by both new KPIs and narrow 70,000+ results to a shortlist within 30 seconds of interactive use.
- **SC-003**: A batch promotion of 50 configs completes the mini-sweep and ClickHouse insertion within the time equivalent of running 50 individual backtests (no significant overhead beyond the backtests themselves).
- **SC-004**: A standard 70,000-run parameter sweep produces exactly 0 rows in ClickHouse `sweep_wide_events` (zero initial bloat).
- **SC-005**: Re-promoting a previously promoted run_id results in exactly the event count from the latest execution (duplicate guard correctness).
- **SC-006**: Deleting a session with 10 million wide events in ClickHouse completes the partition drop in under 1 second.
- **SC-007**: Grafana dynamic dropdowns load session and config lists within 2 seconds and render trade timeline panels within 5 seconds for promoted sessions.
- **SC-008**: The end-to-end workflow (sweep → filter → batch promote → Grafana analysis) is achievable without manual SQL queries, ClickHouse CLI commands, or config file edits.

## Assumptions

- The Pro Optimizer Workspace (spec 017) is fully implemented and operational, including: global sidebar, sweep history, summary-only Postgres persistence, Leaderboard/Heatmap, throttled rendering, single-run promotion, and sweep cancellation.
- The ClickHouse instance from spec 008 (market data) is available and accessible. The new `sweep_wide_events` table coexists alongside the existing `market_candles` table.
- The Go engine already supports `enable_wide_events` as a config payload boolean (spec 017 FR-025/FR-026). This spec reuses that mechanism for mini-sweep execution.
- The existing Go engine batch execution mode (`--batch-config`) from spec 016 is operational and can be invoked for the mini-sweep with a subset of configs.
- ClickHouse `DROP PARTITION` is supported on the chosen table engine (MergeTree family) and functions as a metadata-only operation.
- Only one batch promotion may run at a time per session. Concurrent promotions for different sessions are allowed.
- The Grafana instance from the existing docker-compose setup is accessible and supports template variables for ClickHouse data sources.
- Wide-event schema is already defined in the existing codebase (used by single-run promotion in spec 017). This spec reuses that schema for ClickHouse storage.
