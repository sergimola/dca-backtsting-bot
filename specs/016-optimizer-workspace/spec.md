# Feature Specification: Optimizer Workspace (Parameter Sweep & High-Concurrency Execution)

**Feature Branch**: `016-optimizer-workspace`
**Created**: 2026-03-31
**Status**: Draft
**Input**: Dedicated Optimizer Workspace to execute, monitor, and analyze combinatorial parameter sweeps using a Cartesian product generator, Pre-Flight pruning, and a Go-native shared-memory worker pool. Left/Right split-panel UI backed by a Node.js combinatorial/pruning API and a high-concurrency Go batch-execution engine.

**Constitution Gates (MANDATORY)**:
- **Green Light Protocol**: All existing Go engine tests (`go test ./...`) and orchestrator API tests (`npx jest`) must remain green. New tests must cover: batch-config JSON parsing, shared-memory candle caching (one query per symbol/date group), worker pool sizing and concurrent output correctness, Pre-Flight math endpoint deterministic output, Cartesian product generation, smart pruning logic, and all new frontend components. No merge permitted with failing tests.
- **Fixed-point arithmetic**: All monetary calculations in the Go engine (safety order cost, cumulative capital, drawdown, entry sizing) MUST use `decimal.Decimal`. The Pre-Flight math endpoint MUST use `decimal.Decimal` for all ladder calculations. Floating-point numbers are only permitted in the final serialized JSON output fields and in UI display values. No monetary re-computation occurs in the Node.js layer.
- **BDD acceptance criteria**: Each user story below has traceable Given/When/Then scenarios covering: batch execution I/O elimination via shared-memory caching, Pre-Flight math correctness, Cartesian product generation and pruning, UI state transitions (Idle → Running → Complete), and context-switching from the Optimizer leaderboard back to Single Run.

## Clarifications

### Session 2026-04-01

- Q: How does Node.js invoke Pre-Flight math for up to 10,000 configs without per-config process spawns or re-implementing monetary math in JS? → A: Go engine provides a batch Pre-Flight mode (`--batch-preflight`) processing all configs in a single invocation.
- Q: Are sweep results persisted to the database or held in-memory only? → A: In-memory only (ephemeral workspace). Use "Open in Single Run" to re-execute and persist a specific run.
- Q: Can the user cancel a running sweep mid-execution? → A: Yes. Cancel button terminates Go process; completed results are preserved.
- Q: Are non-numeric parameters (symbol, timeframe, date range) sweepable? → A: No. Only numeric parameters are sweepable. Symbol, timeframe, and dates are fixed per sweep.
- Q: Can the user export Quant Matrix results? → A: Yes. CSV export of the Leaderboard data grid.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Batch Execution with Shared-Memory Candle Caching (Priority: P1)

A quant analyst launches an optimization sweep of 500 parameter combinations for BTCUSDC across a 6-month date range. The Go engine receives a batch-config file, groups all 500 configs by their shared symbol and date range, queries the historical candle data exactly once, and caches the resulting `[]Candle` slice in RAM. It then distributes work across a bounded goroutine worker pool. Each worker receives a read-only pointer to the shared `[]Candle` slice (no mutexes required for read-only data) but instantiates its own completely independent `Orchestrator` and `PositionStateMachine` — ensuring all mutable execution state (active positions, running balances, order fills) is fully isolated per goroutine with zero risk of data races. Results stream to stdout tagged by run ID.

**Why this priority**: The shared-memory caching architecture is the foundational enabler for the entire Optimizer feature. Without it, sweeps of hundreds or thousands of runs would issue redundant candle queries per run, making optimization impractical. Every other story depends on this capability.

**Independent Test**: Can be fully tested by invoking the Go engine binary with `--batch-config batch.json` pointing to a file containing 10+ configs for the same symbol/date range, and verifying that (a) exactly one ClickHouse query is issued per unique symbol/date group, (b) all runs complete with independent results (no cross-contamination of position state between workers), (c) each run emits a tagged result line on stdout, and (d) running with Go's race detector (`-race` flag) reports zero data races.

**Acceptance Scenarios**:

1. **Given** a batch-config JSON file containing 100 configs all sharing `symbol=BTCUSDC` and `start_date=2025-01-01`, `end_date=2025-06-30`, **When** the engine executes with `--batch-config batch.json`, **Then** exactly 1 ClickHouse candle query is issued for that symbol/date group.
2. **Given** the engine is started on an 8-core machine, **When** execution begins, **Then** the worker pool size equals `runtime.NumCPU()` (8 workers).
3. **Given** a batch of 50 configs is executing, **When** each worker completes a run, **Then** the result line on stdout includes a `run_id` field matching the config's identifier, with `type` = `"result"`.
4. **Given** a batch-config JSON file containing configs for 2 different symbols (BTCUSDC, ETHUSDC) over the same date range, **When** the engine executes, **Then** exactly 2 ClickHouse queries are issued (one per symbol group).
5. **Given** a batch-config JSON file containing configs for the same symbol but 3 different date ranges, **When** the engine executes, **Then** exactly 3 ClickHouse queries are issued (one per date-range group).
6. **Given** the engine is processing a batch and one config has invalid parameters causing a simulation error, **When** that run fails, **Then** an error result line tagged with the failing `run_id` is emitted on stdout and all other runs continue unaffected.
7. **Given** a batch of 20 configs for the same symbol/date group, **When** executed concurrently with Go's race detector enabled (`-race`), **Then** zero data races are reported — confirming that only the `[]Candle` slice is shared and all mutable execution state (`Orchestrator`, `PositionStateMachine`, balances, positions) is fully isolated per worker.
8. **Given** two configs in the same batch with different `safety_order_size` values, **When** both complete, **Then** each result reflects its own independent safety-order fills — proving no cross-contamination of position or balance state between workers.

---

### User Story 2 — Pre-Flight Math for Capital & Drawdown Estimation (Priority: P2)

Before committing to a full sweep, the analyst wants to know, for any given config, how deep the DCA safety-order ladder goes and how much capital it requires. The Go engine exposes a deterministic Pre-Flight math command that accepts a configuration, calculates the entire DCA ladder assuming a $100 normalized entry, and returns the maximum drawdown covered (%) and total capital required — all without loading any historical data.

**Why this priority**: Pre-Flight math is the prerequisite for the Node.js Smart Pruning (Story 3) and the UI Pre-Flight Visualizer (Story 5). Without it, there is no way to validate or prune configs before execution, and no data to power the idle-state visualization.

**Independent Test**: Can be fully tested by invoking the engine with a Pre-Flight command and a known config, then asserting that the returned drawdown percentage and capital figure match hand-calculated expected values. No historical data or ClickHouse connection is required.

**Acceptance Scenarios**:

1. **Given** a config with `base_order_size=100`, `safety_order_size=200`, `max_safety_orders=5`, `price_scale=1.5`, `volume_scale=2.0`, **When** the Pre-Flight command is invoked, **Then** the response contains `max_drawdown_covered_pct` (a negative percentage) and `total_capital_required` (a positive dollar amount), both computed using fixed-point arithmetic.
2. **Given** two identical configs, **When** Pre-Flight is invoked on each independently, **Then** both responses are byte-identical (deterministic).
3. **Given** a config, **When** Pre-Flight completes, **Then** the response includes the full `ladder` array with one entry per safety order containing: `level` (integer), `trigger_price_pct` (percentage drop from entry), `order_size`, and `cumulative_cost`.
4. **Given** a config with `max_safety_orders=0`, **When** Pre-Flight is invoked, **Then** `total_capital_required` equals the `base_order_size` and `max_drawdown_covered_pct` equals `0.00`.
5. **Given** the Pre-Flight command is invoked, **When** execution finishes, **Then** no ClickHouse query or disk I/O is performed.

---

### User Story 3 — Cartesian Product Generation & Smart Pruning (Priority: P3)

The analyst enters sweep parameters (comma-separated values or ranges) in the Optimizer Configurator. The Node.js API expands all sweep inputs into a Cartesian product of distinct configs, then evaluates each generated config against the Pre-Flight math logic. Configs violating exchange constraints (e.g., base order below exchange minimum) or user constraints (e.g., total capital exceeding account balance) are silently pruned. The pruning results are returned immediately so the UI can display live combinatorial counts.

**Why this priority**: The Cartesian generator + pruning pipeline converts raw sweep inputs into a valid, executable batch. It is the bridge between the UI Configurator (Story 6) and the batch engine (Story 1). The analyst must be able to see how many valid runs exist before committing to execution.

**Independent Test**: Can be fully tested by calling the Node.js Cartesian/pruning API endpoint with known sweep inputs and an account balance, asserting that (a) the total generated count matches the mathematical Cartesian product, (b) pruned configs are correctly identified and excluded, and (c) the returned valid-run list is a strict subset of the generated configs.

**Acceptance Scenarios**:

1. **Given** sweep inputs where `price_scale = "1.0, 1.5, 2.0"` and `take_profit_distance_percent = "0.5, 1.0"` with all other params fixed, **When** the Cartesian endpoint is called, **Then** exactly 6 distinct configs are generated (3 × 2).
2. **Given** a Range sweep input with `start=1.0`, `end=2.0`, `step=0.5`, **When** expanded, **Then** it produces the values `[1.0, 1.5, 2.0]`.
3. **Given** 100 generated configs where 15 require capital exceeding the user's account balance of $10,000 and 5 have `base_order_size` below $10, **When** Smart Pruning runs, **Then** the response reports `generated=100`, `pruned=20`, `valid=80`.
4. **Given** a config where `base_order_size=5` (below the $10 exchange minimum), **When** pruning evaluates it, **Then** it is marked as pruned with reason `"base_order_below_minimum"`.
5. **Given** a config where total capital required is $12,000 and account balance is $10,000, **When** pruning evaluates it, **Then** it is marked as pruned with reason `"capital_exceeds_balance"`.
6. **Given** a sweep whose parameter dimensions multiply to 8,000 total combinations, **When** the Cartesian endpoint is called, **Then** all 8,000 configs are generated, pruned, and the response is returned within 5 seconds.
7. **Given** no sweep parameters are in Sweep mode (all Fixed), **When** the Cartesian endpoint is called, **Then** exactly 1 config is generated (degenerate case).
8. **Given** a sweep whose parameter dimensions multiply to 15,000 total combinations (exceeding the 10,000 hard limit), **When** the Cartesian endpoint is called, **Then** the API immediately returns a 400 Bad Request with a message indicating the combination count (15,000) exceeds the maximum allowed (10,000) — without allocating memory for any configs.
9. **Given** a sweep with 5 parameters each having 7 values (7^5 = 16,807 combinations), **When** the API calculates the product of dimension lengths, **Then** the rejection occurs in constant time O(k) where k is the number of swept parameters, before any config objects are constructed.

---

### User Story 4 — Execution Dashboard with Live Progress & Leaderboard (Priority: P4)

After launching a sweep, the analyst sees a Master Progress Bar showing how many runs have completed (e.g., "15/64 Runs Completed"). As each Go worker finishes a run, the result streams into a live Leaderboard table that automatically sorts by Net PnL. The analyst watches the best-performing parameter sets bubble to the top in real time.

**Why this priority**: The execution dashboard provides essential feedback during potentially long-running sweeps. Without it, the analyst has no visibility into progress or intermediate results, making the experience equivalent to a batch script.

**Independent Test**: Can be fully tested by mocking the Go engine's stdout stream with a sequence of tagged result lines and verifying that (a) the progress bar increments correctly, (b) each result appears in the Leaderboard, and (c) sorting by Net PnL reorders rows correctly.

**Acceptance Scenarios**:

1. **Given** a sweep of 64 runs is launched, **When** the 15th run completes, **Then** the Master Progress Bar displays "15 / 64 Runs Completed" and the progress percentage updates to approximately 23%.
2. **Given** the Leaderboard is sorted by Net PnL (descending), **When** a new result arrives with a higher PnL than the current top row, **Then** it is inserted at the top of the table within 1 second of receiving the result.
3. **Given** the Leaderboard contains 30 rows, **When** the user clicks the "Capital Efficiency" column header, **Then** all rows re-sort by that column immediately.
4. **Given** a sweep is in progress, **When** one run emits an error result, **Then** the error run appears in the Leaderboard with a visual error indicator and does not block other runs from appearing.
5. **Given** a sweep of 200 runs completes, **When** the last result arrives, **Then** the progress bar shows "200 / 200 Runs Completed" and the view automatically transitions to the Quant Matrix (complete state).
6. **Given** a sweep of 100 runs is in progress with 40 completed, **When** the user clicks "Cancel Sweep", **Then** the Go engine process is terminated, the 40 completed results are preserved in the Leaderboard, and the view transitions to a partial-results state with a "Cancelled (40/100)" indicator.

---

### User Story 5 — Pre-Flight Visualizer (Idle State) (Priority: P5)

Before launching a sweep, the Optimizer's right panel displays a Pre-Flight Visualizer. It shows a stylized candlestick chart overlaid with a "heatmap zone" illustrating the range of safety-order grids derived from the current sweep parameters — the shallowest grid at one extreme and the deepest at the other. Explicit text readouts show "Max Drawdown Covered: -X% to -Y%" and "Max Capital Required: $Z", giving the analyst full confidence in the sweep's risk profile before committing.

**Why this priority**: The Pre-Flight Visualizer provides at-a-glance risk assessment. While not required for execution, it prevents the analyst from unknowingly launching a sweep with unreasonable capital requirements or insufficient drawdown coverage.

**Independent Test**: Can be fully tested by providing a set of Pre-Flight results (min/max drawdown, min/max capital) and verifying that the Visualizer renders the correct heatmap zone boundaries and text readouts.

**Acceptance Scenarios**:

1. **Given** sweep params generate configs with max drawdown ranging from -8% to -25%, **When** the Pre-Flight Visualizer renders, **Then** the heatmap zone spans from -8% to -25% below the entry price.
2. **Given** the Pre-Flight results show a maximum capital requirement of $15,432.50, **When** the Visualizer renders, **Then** the text readout displays "Max Capital Required: $15,432.50".
3. **Given** all sweep params are in Fixed mode (no sweep), **When** the Visualizer renders, **Then** the heatmap zone collapses to a single line representing the one config's safety-order grid.
4. **Given** the user changes a sweep parameter in the Configurator, **When** the Pre-Flight recalculates, **Then** the Visualizer updates within 2 seconds to reflect the new range.

---

### User Story 6 — Optimizer Configurator (Left Panel) (Priority: P6)

The analyst configures a sweep using the Optimizer's left panel. Each numeric parameter has a Fixed/Sweep toggle. In Sweep mode, the input accepts comma-separated values (e.g., "1.0, 1.5, 2.0") or a Range popover (Start, End, Step). Workflow utilities include JSON Import/Export (paste raw JSON to auto-fill all fields) and Quick Date buttons (YTD, Last 6 Months, Last 30 Days). A sticky footer displays real-time combinatorial math: "Generated: X | Pruned: Y | Valid Runs: Z" and a "Launch Sweep" button.

**Why this priority**: The Configurator is the primary input surface, but it has no value without the backend pipeline (Stories 1–3) and the output views (Stories 4–5). It is prioritized after the core engine and visualization capabilities it depends on.

**Independent Test**: Can be fully tested by interacting with the Configurator in isolation: toggling Fixed/Sweep, entering values, using Range popovers, importing JSON, using Quick Dates, and asserting that the footer counts update correctly and the generated config payload matches expectations.

**Acceptance Scenarios**:

1. **Given** the Optimizer page loads, **When** the Configurator renders, **Then** all numeric parameters default to "Fixed" mode with values matching the platform's defaults.
2. **Given** `price_scale` is toggled to Sweep mode, **When** the user enters "1.0, 1.5, 2.0", **Then** the footer "Generated" count multiplies by 3.
3. **Given** `volume_scale` is in Sweep mode with Range popover set to Start=1.0, End=3.0, Step=0.5, **When** the popover is confirmed, **Then** the field displays "1.0, 1.5, 2.0, 2.5, 3.0" and the footer "Generated" count multiplies by 5.
4. **Given** the user clicks "JSON Import" and pastes a valid config JSON, **When** the import completes, **Then** all fields are populated with the imported values and sweep/fixed modes are set appropriately.
5. **Given** the user clicks "YTD" quick date button, **When** the date fields update, **Then** `start_date` is set to January 1 of the current year and `end_date` is set to today.
6. **Given** the footer displays "Generated: 120 | Pruned: 20 | Valid Runs: 100", **When** the user clicks "Launch Sweep", **Then** the right panel transitions from Pre-Flight Visualizer to Execution Dashboard and the batch of 100 valid configs is submitted for execution.
7. **Given** the footer shows "Valid Runs: 0", **When** the "Launch Sweep" button renders, **Then** it is disabled with a tooltip explaining that no valid runs remain after pruning.

---

### User Story 7 — Quant Matrix (Complete State) (Priority: P7)

After a sweep completes, the right panel displays the Quant Matrix, consisting of two views: (1) a Heatmap for 2-variable sweeps, rendering a 2D grid colored from red (loss) to bright green (max profit) to identify robust parameter clusters; and (2) a Leaderboard Data Grid — a dense, sortable table of all valid runs where columns representing swept variables are visually highlighted. Each row offers quick actions: "Open in Single Run" (reconstructs the Single Run view with those parameters), "Save as Preset", and "Copy Config JSON".

**Why this priority**: The Quant Matrix is the analytical payoff of the entire Optimizer workflow, but it requires completed sweep results (all prior stories). It transforms raw outputs into actionable insights.

**Independent Test**: Can be fully tested by providing a completed sweep result set and verifying: heatmap color mapping accuracy, data grid sorting/filtering, column highlighting for swept variables, and all row actions (open in Single Run, save preset, copy JSON).

**Acceptance Scenarios**:

1. **Given** a completed 2-variable sweep (price_scale × take_profit) with 25 results, **When** the Heatmap renders, **Then** a 5×5 grid is displayed with cells colored on a red-to-green gradient proportional to Net PnL.
2. **Given** the Heatmap, **When** the user hovers over a cell, **Then** a tooltip displays the exact parameter values and key metrics (Net PnL, ROI, Capital Efficiency) for that combination.
3. **Given** the Leaderboard Data Grid with 100 rows, **When** column headers for swept parameters (e.g., "Price Scale", "Take Profit") render, **Then** those columns have a distinct visual highlight differentiating them from non-swept columns.
4. **Given** a row in the Leaderboard, **When** the user clicks "Open in Single Run", **Then** the application navigates to the Single Run page with all parameters from that row pre-filled exactly.
5. **Given** a row in the Leaderboard, **When** the user clicks "Save as Preset", **Then** the configuration is persisted and appears in the user's preset list.
6. **Given** a row in the Leaderboard, **When** the user clicks "Copy Config JSON", **Then** the full configuration JSON is copied to the clipboard.
7. **Given** a sweep with only 1 swept variable, **When** the Quant Matrix renders, **Then** only the Leaderboard Data Grid is shown (Heatmap is hidden since a 2D grid requires 2 variables).
8. **Given** a sweep with 3+ swept variables, **When** the Quant Matrix renders, **Then** the user can select any 2 swept variables as Heatmap axes from a dropdown, and the grid re-renders accordingly.

---

### User Story 8 — Optimizer Navigation & Layout (Priority: P8)

The platform provides a new primary sidebar item "Optimizer" distinct from the existing "Single Run". Clicking it reveals the Optimizer Workspace with a Left (25% width) / Right (75% width) split-panel layout. The right panel transitions through three states: Pre-Flight Visualizer (idle), Execution Dashboard (running), and Quant Matrix (complete).

**Why this priority**: Navigation and layout are the shell that hosts all other Optimizer UI stories. It is sequenced last because its implementation is straightforward scaffolding that can wrap any of the above stories.

**Independent Test**: Can be fully tested by verifying sidebar navigation renders the Optimizer route, the split-panel layout renders with correct proportions, and right-panel state transitions follow the expected lifecycle.

**Acceptance Scenarios**:

1. **Given** the user is on the Single Run page, **When** they click "Optimizer" in the sidebar, **Then** the Optimizer Workspace renders with a Left/Right split-panel layout.
2. **Given** the Optimizer Workspace renders, **When** the layout is inspected, **Then** the left panel occupies approximately 25% width and the right panel occupies approximately 75% width.
3. **Given** no sweep has been launched, **When** the right panel renders, **Then** it displays the Pre-Flight Visualizer (idle state).
4. **Given** a sweep is launched, **When** the first result arrives, **Then** the right panel transitions to the Execution Dashboard (running state).
5. **Given** all runs in a sweep have completed, **When** the last result is processed, **Then** the right panel transitions to the Quant Matrix (complete state).
6. **Given** the user is viewing the Quant Matrix, **When** they click "New Sweep" or modify Configurator parameters, **Then** the right panel resets to the Pre-Flight Visualizer (idle state).

---

### Canonical Test Data & Mathematical Proofs *(MANDATORY FOR CORE DOMAIN)*

The Pre-Flight math and batch execution both exercise the DCA ladder calculation. The following canonical test cases establish binding expectations.

| Input State | Action | Expected Exact Value (Decimal) | Derivation |
|-------------|--------|--------------------------------|------------|
| base_order=100, safety_size=200, price_scale=1.5, volume_scale=2.0, max_so=3 | Pre-Flight: SO1 trigger price pct | `-1.50000000%` | Entry deviation × price_scale^0 = 1.0 × 1.5 = 1.5% |
| (continued) | Pre-Flight: SO1 order size | `200.00000000` | safety_size × volume_scale^0 = 200 × 1 = 200 |
| (continued) | Pre-Flight: SO2 trigger price pct | `-3.75000000%` | Cumulative: 1.5% + (1.5 × 1.5) = 1.5 + 2.25 = 3.75% |
| (continued) | Pre-Flight: SO2 order size | `400.00000000` | safety_size × volume_scale^1 = 200 × 2 = 400 |
| (continued) | Pre-Flight: SO3 trigger price pct | `-7.12500000%` | Cumulative: 3.75% + (1.5 × 1.5²) = 3.75 + 3.375 = 7.125% |
| (continued) | Pre-Flight: SO3 order size | `800.00000000` | safety_size × volume_scale^2 = 200 × 4 = 800 |
| (continued) | Pre-Flight: total_capital_required | `1500.00000000` | 100 + 200 + 400 + 800 = 1500 |
| (continued) | Pre-Flight: max_drawdown_covered_pct | `-7.12500000%` | Deepest SO trigger = SO3 |
| base_order=100, max_so=0 | Pre-Flight: total_capital_required | `100.00000000` | Base order only |
| base_order=100, max_so=0 | Pre-Flight: max_drawdown_covered_pct | `0.00000000%` | No safety orders |
| Batch: 100 configs, same symbol/date | ClickHouse queries issued | `1` | One query per unique (symbol, start_date, end_date) group |
| Batch: 50 configs × 2 symbols | ClickHouse queries issued | `2` | Two distinct symbol groups |

**Rationale**: These test cases are binding specifications. The Pre-Flight endpoint and batch engine MUST produce these exact values. Deviations indicate precision loss or grouping logic errors.

### Edge Cases

- **Empty batch file**: Engine receives `--batch-config` pointing to a JSON file with an empty array `[]`. Engine must exit cleanly with a warning and no result lines.
- **Single-config batch**: A batch file with exactly 1 config must execute identically to a non-batch single-run invocation, producing one result line.
- **Duplicate configs**: If the batch contains two identical configs (same parameters), both must execute and produce separate result lines with distinct `run_id` values.
- **Zero-step range**: A Range sweep with `start=1.0, end=1.0, step=0.5` must produce exactly 1 value `[1.0]`, not an error.
- **Negative step**: A Range with `start=2.0, end=1.0, step=0.5` must be rejected with a validation error (start > end with positive step).
- **Massive Cartesian product**: The API MUST calculate the total combination count mathematically (multiply dimension lengths) before allocating any config objects. If the count exceeds the hard limit (10,000), the API MUST reject the request with a 400 Bad Request, protecting the server from V8 heap exhaustion. The frontend MUST display the rejection reason and suggest reducing sweep ranges.
- **All configs pruned**: If Smart Pruning eliminates 100% of generated configs, the "Launch Sweep" button must be disabled with a clear explanation.
- **Mixed symbol sweep**: Configs spanning multiple symbols in the same batch must each resolve to the correct cached candle set.
- **Engine crash mid-batch**: If the Go process terminates unexpectedly during a batch, all completed results are preserved and the UI reports partial completion with an error summary.
- **Sweep cancellation**: User clicks "Cancel Sweep" while a batch is running. The Go process must be terminated gracefully (SIGTERM/process kill), all results received before cancellation must be preserved, and the UI must show partial results with a clear "Cancelled" indicator.
- **Concurrent sweep launches**: Only one sweep may execute at a time. Attempting to launch a second sweep while one is running must be blocked with a clear message.
- **Browser refresh during sweep**: Since results are in-memory only, refreshing the page during or after a sweep loses all results. The UI should warn before navigation if a sweep is in progress or results are unsaved.

## Requirements *(mandatory)*

### Functional Requirements

**Go Engine — Batch Execution**

- **FR-001**: The engine MUST accept a `--batch-config <path>` flag pointing to a JSON file containing an array of config objects, each with a unique `run_id`.
- **FR-002**: The engine MUST group batch configs by the tuple `(symbol, start_date, end_date)` and query ClickHouse for historical candle data exactly once per unique group.
- **FR-003**: The engine MUST cache queried candle data in RAM as a read-only `[]Candle` slice and share it across all workers within the same group by passing a slice pointer. Mutexes are not required because the candle data is strictly read-only after initial load. **Critically, each worker MUST instantiate a completely independent `Orchestrator` and `PositionStateMachine` instance per run.** All mutable execution state — active positions, running balances, order fill tracking, and fee accumulators — MUST be fully isolated per goroutine. Workers MUST NOT share any writable state. The only shared data across workers is the read-only `[]Candle` slice.
- **FR-004**: The engine MUST create a bounded goroutine worker pool sized to `runtime.NumCPU()` for concurrent batch processing. The batch MUST pass Go's race detector (`go test -race` / `go run -race`) with zero data-race reports when executing concurrent workers.
- **FR-005**: Each worker MUST emit its result as a single JSON line to stdout containing a `run_id` field matching the input config's identifier and `type` = `"result"`.
- **FR-006**: If a single run within a batch encounters a simulation error, the engine MUST emit an error result line for that `run_id` and continue processing all remaining runs.

**Go Engine — Pre-Flight Math**

- **FR-007**: The engine MUST support a Pre-Flight command (flag or subcommand) that accepts a single config and returns the DCA ladder calculation without querying historical data.
- **FR-007b**: The engine MUST support a batch Pre-Flight mode (e.g., `--batch-preflight <path>`) that accepts a JSON file containing an array of configs and returns all ladder calculations in a single process invocation. This is the required invocation path for Smart Pruning (FR-012) to avoid per-config process-spawning overhead.
- **FR-008**: The Pre-Flight response MUST include: `max_drawdown_covered_pct` (percentage), `total_capital_required` (dollar amount), and a `ladder` array with per-safety-order details (`level`, `trigger_price_pct`, `trigger_price`, `order_size`, `cumulative_cost`).
- **FR-009**: All Pre-Flight calculations MUST use fixed-point decimal arithmetic; the output MUST be deterministic for identical inputs.

**Node.js — Cartesian Product & Pruning**

- **FR-010**: The Node.js API MUST accept sweep definitions where each parameter is either a fixed value, a comma-separated list of values, or a Range object (`start`, `end`, `step`).
- **FR-011**: Before allocating memory for any config objects, the API MUST calculate the total combination count by multiplying the cardinality of each swept parameter's value list. If the calculated count exceeds the hard limit of 10,000 combinations, the API MUST immediately reject the request with a 400 Bad Request response containing the calculated count and the limit — without constructing any config objects. This pre-flight size check MUST execute in O(k) time where k is the number of swept parameters.
- **FR-011b**: Only after the pre-flight size check passes, the API MUST expand all sweep parameters into a Cartesian product of distinct config objects.
- **FR-012**: Before dispatching to the Go engine for batch execution, the API MUST invoke the Go engine's batch Pre-Flight mode (FR-007b) with all generated configs in a single process invocation, then prune configs whose Pre-Flight results violate exchange rules (e.g., base order < $10 minimum) or user-defined constraints (e.g., total capital > account balance).
- **FR-013**: The API MUST return the pruning summary (`generated`, `pruned`, `valid` counts) along with the list of valid configs and a breakdown of prune reasons.

**Frontend — Layout & Navigation**

- **FR-014**: The sidebar MUST include an "Optimizer" navigation item distinct from "Single Run".
- **FR-015**: The Optimizer Workspace MUST use a Left (25% width) / Right (75% width) split-panel layout.
- **FR-016**: The right panel MUST transition through three states: Pre-Flight Visualizer (idle), Execution Dashboard (running), Quant Matrix (complete).

**Frontend — Configurator (Left Panel)**

- **FR-017**: The following numeric parameters MUST feature a Fixed/Sweep toggle: `price_entry`, `price_scale`, `amount_scale`, `amount_per_trade`, `number_of_orders`, `take_profit_distance_percent`, `multiplier`. Non-numeric parameters (symbol, timeframe, date range) are fixed per sweep and MUST NOT have sweep toggles.
- **FR-018**: In Sweep mode, inputs MUST accept comma-separated tokens (e.g., "1.0, 1.5, 2.0") and a Range popover (Start, End, Step).
- **FR-019**: The Configurator MUST provide JSON Import (paste raw JSON to auto-fill fields) and JSON Export (export current config as JSON).
- **FR-020**: The Configurator MUST provide Quick Date buttons (YTD, Last 6 Months, Last 30 Days) that fill start/end date fields.
- **FR-021**: A sticky footer MUST display real-time combinatorial counts: "Generated: X | Pruned: Y | Valid Runs: Z".
- **FR-022**: The footer MUST contain a "Launch Sweep" button that is disabled when Valid Runs equals zero.

**Frontend — Pre-Flight Visualizer (Idle State)**

- **FR-023**: The idle right panel MUST display a stylized candlestick chart overlaid with a heatmap zone representing the range of safety-order grids from the shallowest to the deepest config in the current sweep.
- **FR-024**: Text readouts MUST display "Max Drawdown Covered: -X% to -Y%" and "Max Capital Required: $Z".

**Frontend — Execution Dashboard (Running State)**

- **FR-025**: The running right panel MUST display a Master Progress Bar showing "{completed} / {total} Runs Completed".
- **FR-026**: A live-streaming Leaderboard table MUST populate in real time as results arrive, auto-sorting by Net PnL (default) or user-selected column.

**Frontend — Quant Matrix (Complete State)**

- **FR-027**: For 2-variable sweeps, the complete right panel MUST render a 2D Heatmap grid colored from red (loss) to bright green (max profit).
- **FR-028**: For sweeps with 3+ swept variables, users MUST be able to select any 2 variables as Heatmap axes.
- **FR-029**: A Leaderboard Data Grid MUST display all valid run results, with columns for swept variables visually highlighted.
- **FR-030**: Each Leaderboard row MUST provide quick actions: "Open in Single Run" (navigates to Single Run with those parameters pre-filled), "Save as Preset", and "Copy Config JSON".
- **FR-031**: "Open in Single Run" MUST reconstruct the Single Run page state with the exact parameters from the selected row.

**Cross-Cutting**

- **FR-032**: The Execution Dashboard MUST display a "Cancel Sweep" button during execution. Cancellation MUST terminate the Go engine process and preserve all results received before cancellation. The right panel MUST transition to a partial-results view showing the Leaderboard with a "Cancelled" indicator.
- **FR-033**: The Quant Matrix Leaderboard MUST provide an "Export CSV" action that exports all run results (swept parameter values and key metrics: Net PnL, ROI, Capital Efficiency, Max Drawdown) as a downloadable CSV file.
- **FR-034**: Sweep results (summary metrics per run) MUST be held in-memory only (frontend and Node.js process). Sweep results are NOT persisted to the database. To persist a specific run's full results, the user MUST use "Open in Single Run" to re-execute it as a standard backtest with full database persistence.
- **FR-035**: The Optimizer Configurator MUST include an Account Balance number input field. This value is used by the Smart Pruning logic (FR-012) to discard configs whose `total_capital_required` exceeds the user's available capital.

### Key Entities

- **Sweep Definition**: The user's desired parameter exploration space. Contains a mix of fixed values and sweep parameters (comma-separated or Range). Attributes: parameter name, mode (Fixed or Sweep), fixed value or sweep values/range, date range, symbol.
- **Cartesian Product Result**: The fully expanded set of distinct configs generated from a Sweep Definition. Attributes: total generated count, list of configs (each with a unique `run_id`).
- **Pre-Flight Result**: The deterministic capital/risk assessment for a single config. Attributes: `max_drawdown_covered_pct`, `total_capital_required`, `ladder` (array of safety-order levels with trigger price, size, cumulative cost).
- **Pruning Summary**: The outcome of evaluating all generated configs against constraints. Attributes: `generated` count, `pruned` count, `valid` count, per-config prune reason (if pruned).
- **Batch Config File**: A JSON file consumed by the Go engine containing an array of config objects, each with a `run_id`. Represents the valid (post-pruning) configs ready for execution.
- **Batch Run Result**: The output of one simulation run within a batch. Attributes: `run_id`, `type` ("result" or "error"), all standard result fields (PnL summary, trade events, etc.).
- **Candle Cache Group**: An in-memory grouping of candle data keyed by `(symbol, start_date, end_date)`. Loaded once from ClickHouse and shared read-only across all workers in the group.
- **Optimizer Session**: The lifecycle of one sweep from configuration through completion. States: Configuring (idle), Executing (running), Complete. Attributes: sweep definition, pruning summary, batch results, timestamps.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A sweep of 1,000 combinations for the same symbol and date range queries the historical data source exactly 1 time, confirming I/O elimination.
- **SC-002**: Users can configure, validate, and launch a 500-run sweep in under 3 minutes from opening the Optimizer page.
- **SC-003**: The Pre-Flight Visualizer updates within 2 seconds of any parameter change in the Configurator.
- **SC-004**: Smart Pruning correctly identifies and removes 100% of configs violating constraints, with zero false positives (no valid configs erroneously pruned) and zero false negatives (no invalid configs escaping pruning).
- **SC-005**: The Execution Dashboard displays each completed run result within 1 second of the engine emitting it.
- **SC-006**: The "Open in Single Run" action reconstructs the Single Run page with 100% parameter fidelity — every field matches the originating Optimizer row.
- **SC-007**: Batch execution throughput on a standard 8-core developer machine processes at least 100 runs per minute for a 6-month, 1-minute-resolution dataset.
- **SC-008**: The Quant Matrix Heatmap correctly maps the full PnL range to the red-green gradient with no color aliasing between distinct values.

## Assumptions

- The existing ClickHouse market-data integration (spec 008) is operational and provides a query interface for historical candles by symbol and date range.
- The existing Go engine's `OrchestratorConfig` schema is the baseline for individual batch configs; the batch-config JSON wraps an array of these.
- Exchange minimum order size is $10 (industry standard for major exchanges); this is the default used for pruning unless a different value is configured.
- Account balance is provided by the user in the Optimizer Configurator (not fetched from a live exchange API).
- The Pre-Flight math uses the same DCA ladder formula as the existing engine's order placement logic, normalized to a $100 entry for consistency.
- Only one sweep may execute at a time per user session; concurrent sweeps are out of scope for this feature.
- Sweep results are ephemeral (in-memory only) and are not persisted to the database. The Optimizer is an analysis workspace; full persistence happens when the user selects "Open in Single Run" to re-execute a specific configuration as a standard backtest.
- The sweepable numeric parameters are: `price_entry`, `price_scale`, `amount_scale`, `amount_per_trade`, `number_of_orders`, `take_profit_distance_percent`, `multiplier` (7 total). Symbol, timeframe, and date range are fixed per sweep.
