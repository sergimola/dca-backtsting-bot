# Feature Specification: Go Engine I/O Optimization

**Feature Branch**: `011-go-engine-io-optimization`
**Created**: 2026-03-15
**Status**: Draft
**Input**: Refactor the Go backtest engine to eliminate synchronous I/O bottlenecks in the hot loop. Replace fmt/log printing with log/slog structured logging, accumulate trade events in memory, emit a single final JSON payload to stdout, and implement a configurable time-gated progress ticker streaming rich JSON progress objects to the Node.js orchestrator.

**Constitution Gates (MANDATORY)**:
- **Green Light Protocol**: All existing engine Go tests (`go test ./...`) and orchestrator API integration tests must remain green after refactoring. New tests must cover: the progress ticker interval boundary, the final-payload JSON schema validation, the `--log-level` flag gating at DEBUG vs INFO, and the BackgroundWorker line-parser routing logic. No merge permitted with failing tests.
- **Fixed-point arithmetic**: All monetary values (account balance, realized PnL, fees, safety order amounts) remain in `decimal.Decimal` throughout engine execution. Values are only narrowed to `float64` for the informational-only progress ticker fields (`current_price`, `realized_pnl`) and the final payload numeric fields — none of these narrowed values are used in further computation. The hot-loop arithmetic pipeline is unchanged. No monetary re-computation is introduced in the Node.js layer; all persisted values are taken verbatim from the engine's final payload.
- **BDD acceptance criteria**: Each user story below has traceable Given/When/Then scenarios covering: hot-loop I/O elimination, progress ticker time-gating and field correctness, single final-payload emission and schema validity, BackgroundWorker line-parser routing, and `executionTimeMs` persistence. Every scenario is independently automatable as a test.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Live Progress During Long-Running Backtests (Priority: P1)

A quantitative analyst submits a 3-year backtest. While the simulation is running, the UI progress bar advances smoothly every second — showing the current date, price, and estimated completion percentage. The analyst has confidence that work is proceeding and does not need to stare at a frozen "running" indicator for multiple minutes.

**Why this priority**: Without progress reporting the engine runs silently and the UI appears stalled. Every other story also depends on the engine processing candles at much higher speed, which this story unlocks as a side-effect — the hot-loop I/O bottleneck must be removed before the progress ticker delivers value.

**Independent Test**: Can be fully tested by running the Go engine binary against a dataset of >10,000 candles with `--progress-interval-ms 250` and verifying that multiple `{"type":"progress",...}` JSON lines appear on stdout before the final result line, at approximately the configured interval. No UI or Node.js layer is required.

**Acceptance Scenarios**:

1. **Given** the engine runs with `--progress-interval-ms 250` against a 10,000-candle dataset, **When** execution proceeds, **Then** at least one `{"type":"progress",...}` line is emitted to stdout within the first 500ms.
2. **Given** a progress line is emitted, **When** its JSON fields are inspected, **Then** it contains all of: `type` = `"progress"`, `percent` (float 0–100), `current_date` (RFC3339 string), `processed_candles` (integer), `total_candles` (integer), `current_price` (float), `realized_pnl` (float), `candles_per_second` (integer).
3. **Given** the BackgroundWorker receives a progress line with `percent: 45.2`, **When** the line is parsed, **Then** the `backtests.progress` column is updated to `45` in Postgres without updating any other job columns.
4. **Given** the client polls `GET /backtests/:id/status` while the engine is running, **When** the response is inspected, **Then** the `progress` field reflects the most recent percentage persisted by the BackgroundWorker.
5. **Given** `--progress-interval-ms` is set to `0` or a negative value, **When** the engine starts, **Then** a WARN-level log is emitted and the interval defaults to `250`.

---

### User Story 2 — High-Throughput Silent Execution (Priority: P2)

The analyst who previously waited 45 seconds for a 1-year backtest now sees the result returned in under 10 seconds. The speed gain comes entirely from eliminating per-candle synchronous I/O: each of the 331,000 candles in a year of 1-minute data is processed without any write to stdout or stderr.

**Why this priority**: The per-candle `fmt.Fprintf(os.Stderr, ...)` calls in the current hot loop are the primary performance bottleneck — blocking I/O syscalls executed 100,000–700,000 times per simulation. Removing them is the single change with the largest performance impact and is a prerequisite for multi-year backtests being practically usable.

**Independent Test**: Can be tested by benchmarking the engine before and after with the same dataset and measuring wall-clock completion time. Verified when throughput at `--log-level INFO` is ≥5× higher (candles/second) than the pre-refactor baseline, with stdout containing zero hot-loop output lines.

**Acceptance Scenarios**:

1. **Given** the engine is run with `--log-level INFO` (the default), **When** a candle is processed in the hot loop, **Then** no text is written to stdout or stderr for that individual candle.
2. **Given** a dataset of 331,000 candles (approx. 1 year at 1-minute resolution), **When** run at `--log-level INFO`, **Then** all candles are processed at a sustained rate of ≥500,000 candles/second on standard developer hardware.
3. **Given** execution completes, **When** the stdout line count is measured, **Then** the total equals the number of progress ticks emitted plus exactly one (the final result line) — zero additional lines from the hot loop.
4. **Given** the engine is run with `--log-level DEBUG`, **When** a candle is processed, **Then** a structured DEBUG slog entry appears on stderr; stdout remains unaffected.

---

### User Story 3 — Complete, Schema-Stable Final Result Payload (Priority: P3)

After the simulation finishes, the Node.js worker receives exactly one large JSON object on stdout containing everything the frontend needs — PnL summary, every trade event in frontend format, and the safety order usage histogram — pre-aggregated by the engine. The worker persists the result to Postgres in a single write without any separate aggregation pass.

**Why this priority**: The current Node.js `ResultAggregator` and `processGoEventsForFrontend` pipeline re-processes raw Go events outside the engine, creating a duplicated aggregation surface that must stay in sync with the engine's event schema. Moving aggregation into the engine produces a single, stable output contract and simplifies the worker to a pure parser/persister.

**Independent Test**: Can be fully tested by running the engine against the canonical integration test fixture and validating that the last stdout line is valid JSON containing all required top-level keys with correct types and that the trade event count matches the fixture's expected value.

**Acceptance Scenarios**:

1. **Given** a simulation completes, **When** the last stdout line is parsed as JSON, **Then** it contains: `type` = `"result"`, `pnlSummary` (object), `tradeEvents` (array), `safetyOrderUsage` (array), `executionTimeMs` (integer), `candleCount` (integer), `eventCount` (integer).
2. **Given** the final payload, **When** `pnlSummary` is inspected, **Then** it contains `roi` (number), `maxDrawdown` (number), and `totalFees` (number).
3. **Given** the final payload, **When** a `tradeEvents` entry is inspected, **Then** it contains: `timestamp` (localized display string), `rawTimestamp` (RFC3339), `eventType` (one of `ENTRY`, `SAFETY_ORDER`, `EXIT`), `price` (number), `quantity` (number), `balance` (number), `trade_id` (string), `fee` (number) — exactly matching the `StoredTradeEvent` TypeScript interface.
4. **Given** the final payload, **When** `safetyOrderUsage` is inspected, **Then** each entry contains `level` (string) and `count` (integer).
5. **Given** the BackgroundWorker receives the final result line, **When** it is processed, **Then** `markCompleted` is called once with all mapped result fields and `executionTimeMs` computed as the wall-clock difference between job-claim time and result-receipt time.
6. **Given** the engine exits with a non-zero code before emitting a final result line, **When** the BackgroundWorker detects process exit, **Then** `markFailed` is called with accumulated stderr content as the error message; `markCompleted` is never called.

---

### User Story 4 — Operator Diagnostics via Structured Logging (Priority: P4)

A developer debugging an incorrect safety-order calculation runs the engine with `--log-level DEBUG` and sees structured slog output on stderr — candle timestamps, close prices, position state transitions, and order trigger details — without any code changes or recompilation.

**Why this priority**: The previous ad-hoc `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]...")` calls provided diagnostic value at the cost of always-on I/O. The replacement must provide equivalent diagnostic power under opt-in flag control.

**Independent Test**: Can be fully tested by running the engine with `--log-level DEBUG` on a small fixture and asserting that stderr contains structured slog entries for candle-processing events, then confirming that `--log-level INFO` produces no output on stderr.

**Acceptance Scenarios**:

1. **Given** the engine starts with `--log-level DEBUG`, **When** a candle triggers a safety order fill, **Then** a slog DEBUG entry on stderr includes the candle timestamp, triggered price, and order number.
2. **Given** the engine starts with `--log-level INFO` (default), **When** execution completes without error, **Then** stderr is empty.
3. **Given** the engine starts with `--log-level WARN`, **When** an internal warning occurs (e.g., price sequence misconfiguration), **Then** the warning appears at WARN level on stderr.
4. **Given** no `--log-level` flag is provided, **When** the engine runs, **Then** behaviour is identical to `--log-level INFO`.

---

### Edge Cases

- What happens when `total_candles` is unknown at startup because the ClickHouse loader does not return a row count upfront? → The engine uses `EstimatedCandleCount` from `OrchestratorConfig` as the denominator for `percent`, capping it at `99` until the final result line is emitted.
- What happens when candles are processed faster than the ticker interval fires? → The ticker fires on schedule regardless of candle rate; `candles_per_second` reflects only candles processed in the most recent interval window.
- What happens when the BackgroundWorker receives a non-JSON line from stdout? → The line is logged at WARN level on the worker's logger and silently discarded without crashing or writing corrupt state to Postgres.
- What happens when the final result JSON is very large (thousands of trades)? → Because the BackgroundWorker uses a streaming line-by-line reader over the child process stdout, individual lines are buffered independently; no `exec`-style buffer cap applies.
- What happens when the child process closes its stdout pipe before emitting a final result line? → The BackgroundWorker detects stream end without having received a `type === "result"` line and calls `markFailed` with a descriptive error message.
- What happens when `--progress-interval-ms` is set to `0` or a negative value? → The engine substitutes `250` and emits a WARN slog entry describing the substitution.

## Requirements *(mandatory)*

### Functional Requirements

#### Engine: Structured Logging

- **FR-001**: The engine MUST replace all `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]...")`, `fmt.Println`, and `log.Println` calls in the hot loop and initialization path with Go's standard `log/slog` package.
- **FR-002**: The engine MUST accept a `--log-level` CLI flag with valid values: `DEBUG`, `INFO`, `WARN`, `ERROR`. The default MUST be `INFO`.
- **FR-003**: At `INFO` log level or higher, the hot loop MUST NOT emit any text to stdout or stderr for individual candle processing. All per-candle diagnostic messages MUST be gated at `DEBUG` level.
- **FR-004**: At `DEBUG` log level, the engine MUST emit structured slog entries to stderr for: first-candle symbol integrity check, position opening (tradeID, entry price, order count), safety order triggers (candle timestamp, triggered price, order number), position close (closing price, PnL), and config sequence computation results.
- **FR-005**: All slog output MUST go to stderr only. stdout is reserved exclusively for progress JSON lines and the final result JSON line.

#### Engine: In-Memory Event Accumulation

- **FR-006**: The engine MUST accumulate all domain events (PositionOpened, BuyOrderExecuted, PositionClosed, SellOrderExecuted) in an in-memory slice using the existing `EventBus`. No event data may be written to any I/O stream during the hot loop.
- **FR-007**: Candle structs loaded from ClickHouse MUST be consumed and released after event extraction in each iteration. Candle data MUST NOT be retained across iterations.
- **FR-008**: The engine MUST perform full PnL aggregation (ROI, max drawdown, total fees, safety order usage histogram) in-process after the hot loop completes, before emitting the final payload.

#### Engine: Configurable Progress Ticker

- **FR-009**: The engine MUST implement a time-gated progress emitter using a background goroutine driven by a `time.Ticker`.
- **FR-010**: The ticker interval MUST be configurable via a `--progress-interval-ms` CLI flag. The default MUST be `250` milliseconds.
- **FR-011**: Every tick MUST emit exactly one JSON line to stdout with fields: `type` (`"progress"`), `percent` (float), `current_date` (RFC3339 string), `processed_candles` (integer), `total_candles` (integer), `current_price` (float), `realized_pnl` (float), `candles_per_second` (integer).
- **FR-012**: The `percent` field MUST be calculated as `(processed_candles / total_candles) × 100`, capped at `99` until the final result line is emitted.
- **FR-013**: `candles_per_second` MUST reflect the number of candles processed since the previous tick divided by the elapsed interval in seconds (integer result).
- **FR-014**: The progress goroutine MUST be stopped cleanly when the hot loop finishes — no ticker fires may occur after the final result line is written to stdout.
- **FR-015**: When `--progress-interval-ms` is `0` or negative, the engine MUST substitute `250` and emit a WARN-level slog entry describing the substitution.

#### Engine: Single Final Payload Emission

- **FR-016**: At simulation end, the engine MUST emit exactly one JSON line to stdout containing: `type` (`"result"`), `pnlSummary` (object), `tradeEvents` (array), `safetyOrderUsage` (array), `executionTimeMs` (integer), `candleCount` (integer), `eventCount` (integer).
- **FR-017**: The `pnlSummary` object MUST contain: `roi` (number), `maxDrawdown` (number), `totalFees` (number).
- **FR-018**: Each `tradeEvents` entry MUST conform to the `StoredTradeEvent` TypeScript interface exactly: `timestamp` (localized string), `rawTimestamp` (RFC3339), `eventType` (one of `ENTRY`, `SAFETY_ORDER`, `EXIT`), `price` (number), `quantity` (number), `balance` (number), `trade_id` (string), `fee` (number).
- **FR-019**: Each `safetyOrderUsage` entry MUST contain: `level` (string) and `count` (integer).
- **FR-020**: The final result line MUST be the last line written to stdout. No further output is permitted after it.
- **FR-021**: `executionTimeMs` in the final payload MUST represent the engine's internal wall-clock time from simulation start to end of event accumulation (excluding process startup and JSON serialization overhead).

#### Node.js BackgroundWorker: Line-by-Line Stream Parser

- **FR-022**: The BackgroundWorker MUST parse Go engine stdout using a streaming line-by-line reader attached directly to the child process stdout stream. The existing single-buffer accumulation pattern MUST be replaced.
- **FR-023**: For each line received, the worker MUST attempt `JSON.parse`. Lines that fail parsing MUST be logged at WARN level and discarded without crashing.
- **FR-024**: When a parsed line has `type === "progress"`, the worker MUST execute a lightweight Postgres UPDATE setting only the `progress` column to `Math.floor(line.percent)`, clamped to the range `[0, 100]`.
- **FR-025**: When a parsed line has `type === "result"`, the worker MUST treat it as the authoritative final payload and call `markCompleted` with the mapped `pnlSummary`, `tradeEvents`, and `safetyOrderUsage` fields.
- **FR-026**: The `executionTimeMs` persisted to Postgres MUST be computed in the worker as the wall-clock millisecond difference between the job-claim timestamp and the moment the `type === "result"` line is received.
- **FR-027**: If the child process exits without the worker having received a `type === "result"` line, the worker MUST call `markFailed` with accumulated stderr content as the error message.
- **FR-028**: The BackgroundWorker MUST remain backward-compatible: stdout lines that are non-JSON are discarded gracefully without crashing the worker process.

### Key Entities

- **ProgressEvent**: The informational JSON object emitted periodically during simulation. Contains `type`, `percent`, `current_date`, `processed_candles`, `total_candles`, `current_price`, `realized_pnl`, `candles_per_second`. Not persisted to the database; used only to drive UI progress updates.
- **FinalResultPayload**: The single authoritative JSON object emitted at simulation end. Contains `type`, `pnlSummary`, `tradeEvents`, `safetyOrderUsage`, `executionTimeMs`, `candleCount`, `eventCount`. This is the sole source of truth for Postgres persistence.
- **PnlSummary**: Aggregate simulation metrics computed in-engine from accumulated events: `roi` (return on investment as percent), `maxDrawdown` (maximum peak-to-trough equity decline as percent), `totalFees` (sum of all trade fees in quote currency).
- **StoredTradeEvent**: The per-trade frontend-compatible record. Schema is shared between the Go engine's final payload and the `StoredTradeEvent` TypeScript interface — they must remain in exact alignment at all times.
- **SafetyOrderUsageEntry**: A histogram entry recording how many times a given safety order depth level was reached across all simulated trades. `level` is a 1-indexed string, `count` is the occurrence count.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A 1-year (≈331,000 candle) backtest completes in under 10 seconds — a ≥5× improvement over the current baseline.
- **SC-002**: The UI progress bar advances at least once every 2 seconds during an active simulation — no period exceeding 2 seconds where the displayed percentage is unchanged while the engine is running.
- **SC-003**: The first progress update is visible in the UI within 1 second of the engine beginning candle processing.
- **SC-004**: Zero data loss — the trade event count in the final payload matches exactly what the previous `ResultAggregator` + `processGoEventsForFrontend` pipeline produced for identical input configuration.
- **SC-005**: The BackgroundWorker persists a completed backtest result to Postgres in a single `markCompleted` call — no separate post-aggregation pass is required after the engine exits.
- **SC-006**: Running the engine with `--log-level INFO` against a valid dataset produces empty stderr output, enabling clean operator log hygiene.
- **SC-007**: 100% of existing Go engine tests pass without modification after refactoring.
- **SC-008**: 100% of existing orchestrator API integration tests pass without modification after the BackgroundWorker refactor.
