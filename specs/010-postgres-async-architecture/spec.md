# Feature Specification: Postgres Async Architecture

**Feature Branch**: `010-postgres-async-architecture`  
**Created**: 2026-03-15  
**Status**: Draft  
**Input**: User description: "Refactor the Node.js orchestrator from a synchronous, file-system-based architecture into an asynchronous, robust Postgres-backed architecture."

**Constitution Gates**:
- **Green Light Protocol**: All existing orchestrator API tests must remain green after the migration. New integration tests must cover: 202 acceptance response, async job polling, and the `market_data_syncs` caching ledger. No merge permitted with failing tests.
- **Fixed-point arithmetic**: This feature is an infrastructure/persistence layer. No monetary re-computation occurs here. All numeric backtest results are stored and returned verbatim from the Go engine's JSON output. No floating-point arithmetic is introduced in the Node layer.
- **BDD acceptance criteria**: Covered per user story below. Every architectural constraint (HTTP 202 detachment, omit JSONB on list, sync ledger priority, buffer overflow guard, file-system eradication) has a corresponding BDD scenario.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit a Multi-Year Backtest and Receive Immediate Acknowledgement (Priority: P1)

A quantitative analyst fills in the configuration form with a date range spanning multiple years (e.g., January 2021 – December 2024) and clicks "Run Simulation." The system accepts the request instantly, responds with a job ID, and begins processing in the background. The analyst can continue using the UI without waiting for the long-running computation to finish.

**Why this priority**: This is the core workflow. The previous synchronous architecture blocked the HTTP connection for the entire engine execution duration, making multi-year backtests impossible due to both timeout constraints and the artificial 1-month date-range cap. Removing the date restriction and decoupling the submission from execution unlocks the product's primary value proposition.

**Independent Test**: Can be fully tested by submitting a request with a date range exceeding 31 days and verifying that the API responds within 500ms with a `202 Accepted` status and a `job_id`. The test does not need to wait for the backtest to complete — the immediate response alone demonstrates the P1 outcome.

**Acceptance Scenarios**:

1. **Given** a valid backtest configuration with a date range of 3 years, **When** the user submits it, **Then** the system responds with HTTP 202 and a `job_id` within 500 milliseconds.
2. **Given** a valid backtest configuration with a date range of 3 years, **When** the user submits it, **Then** no validation error is returned citing a date range maximum.
3. **Given** the API has responded with `202 Accepted`, **When** the Go engine is still computing, **Then** the HTTP connection to the submission endpoint has already been closed and is no longer blocking.
4. **Given** the system receives two concurrent backtest submissions, **When** both are processed, **Then** each receives a unique `job_id` and they execute independently without interfering with each other.

---

### User Story 2 - Poll for Job Status and Retrieve Completed Results (Priority: P2)

After receiving a `job_id`, the frontend polls a status endpoint until the backtest reaches a terminal state (`completed` or `failed`). When completed, the full result payload — including trades and safety orders — is available via a dedicated single-result endpoint.

**Why this priority**: Immediate response is meaningless without a way to retrieve the outcome. The polling mechanism is the async contract's second half.

**Independent Test**: Can be fully tested by submitting a backtest, capturing the `job_id`, then polling `GET /backtests/:id/status` in a loop until terminal state; then calling `GET /backtests/:id` and verifying the full result is present. No UI is required.

**Acceptance Scenarios**:

1. **Given** a `job_id` from a recent 202 submission, **When** `GET /backtests/:id/status` is called, **Then** the response includes a `status` field with one of: `pending`, `running`, `completed`, or `failed`.
2. **Given** the Go engine has completed execution, **When** `GET /backtests/:id` is called, **Then** the response includes the full result payload including `trades` and `safetyOrders` arrays.
3. **Given** the Go engine has failed (non-zero exit code or invalid JSON output), **When** `GET /backtests/:id/status` is called, **Then** status is `failed` and an `error_message` field describes the failure reason.
4. **Given** a `job_id` that does not exist in the database, **When** `GET /backtests/:id` is called, **Then** the system responds with HTTP 404.

---

### User Story 3 - List Past Backtests Without Memory Pressure (Priority: P3)

The analyst opens the sidebar to see a history of all previously submitted backtests. The list loads quickly, showing key metadata (status, date range, PnL summary, ROI) without loading the heavy `trades` and `safetyOrders` arrays that can contain thousands of entries.

**Why this priority**: A list endpoint that inadvertently loads multi-megabyte JSONB trade arrays for every record will cause Node.js memory exhaustion when the run history grows. This constraint protects system stability and query performance.

**Independent Test**: Can be fully tested by creating several completed backtest records, calling `GET /backtests`, and asserting that no `trades` or `safetyOrders` field appears in any item in the response array.

**Acceptance Scenarios**:

1. **Given** multiple completed backtests are stored, **When** `GET /backtests` is called, **Then** the response is an array where each object contains `id`, `status`, `config`, `summary` (PnL metrics) but does NOT contain `trades` or `safetyOrders` fields.
2. **Given** 100 completed backtest records exist, **When** `GET /backtests` is called, **Then** the response is returned in under 2 seconds and the heap memory increase during the request is negligible.
3. **Given** a mix of `pending`, `running`, `completed`, and `failed` backtest records exist, **When** `GET /backtests` is called, **Then** all records are returned regardless of status, with the correct `status` value for each.

---

### User Story 4 - Market Data Cache Verified Before Any Network Calls (Priority: P4)

When a backtest is submitted, the system must check the `market_data_syncs` table to determine whether the required data range is already downloaded before initiating any ClickHouse queries. The sync ledger's `end_date` records the actual timestamp of the latest downloaded candle (i.e., "now" at the time of the download), not the backtest's user-configured `end_date`, so that partial downloads are accurately detected.

**Why this priority**: Without the sync ledger check, every backtest submission triggers a redundant full re-download from ClickHouse even when data is already present, wasting network bandwidth and adding minutes of latency. Accurate `end_date` tracking prevents false cache-hits that would cause the system to skip a required download and run the engine against incomplete data.

**Independent Test**: Can be fully tested by seeding the `market_data_syncs` table with a record covering a specific symbol and date range, then submitting a backtest for a period fully within that range, and verifying — via mock or spy — that no ClickHouse network call was made.

**Acceptance Scenarios**:

1. **Given** `market_data_syncs` has a record showing data for BTC/USDC from 2023-01-01 to 2025-03-15, **When** a backtest is submitted for BTC/USDC from 2024-01-01 to 2024-12-31, **Then** `GapResolver` serves the request from the existing data without any ClickHouse call.
2. **Given** `market_data_syncs` has no record for the requested symbol, **When** a backtest is submitted, **Then** `GapResolver` proceeds to fetch data from ClickHouse and records the result in `market_data_syncs`.
3. **Given** a fresh data download completes for BTC/USDC from 2023-01-01 onward, **When** the `market_data_syncs` record is written, **Then** its `end_date` is set to the timestamp of the latest downloaded candle (approximately "now"), NOT the user's configured backtest `end_date`.
4. **Given** `market_data_syncs` has a record with `end_date` of 2024-06-01 but the backtest requests data up to 2025-03-01, **When** `GapResolver` evaluates the cache, **Then** the gap (2024-06-01 → 2025-03-01) triggers a new ClickHouse fetch to fill the missing range.

---

### User Story 5 - Infrastructure Provisioned via Docker Compose (Priority: P5)

A developer clones the repository and runs `docker-compose up` from the project root. Without any manual database provisioning, the Postgres service starts with persistent storage and the pgAdmin management UI is available for inspection and debugging.

**Why this priority**: Reproducible local infrastructure is a prerequisite for every contributor and CI environment. Without it, the Postgres-backed architecture cannot be run or tested locally.

**Independent Test**: Can be fully tested by running `docker-compose up -d` on a clean machine and verifying that Postgres is accepting connections on its designated port and pgAdmin is reachable in a browser, without any manual setup steps.

**Acceptance Scenarios**:

1. **Given** the project root `docker-compose.yml` is updated, **When** `docker-compose up -d` is run, **Then** a `postgres` container starts and accepts connections on a defined port.
2. **Given** Docker Compose is running, **When** `docker-compose down` is run and then `docker-compose up -d` again, **Then** Postgres data from the previous session is preserved (persistent volume).
3. **Given** Docker Compose is running, **When** a browser navigates to the pgAdmin port, **Then** the pgAdmin login screen is displayed.
4. **Given** Postgres is running via Docker Compose, **When** the Node.js orchestrator starts, **Then** it successfully connects to Postgres and runs schema migrations automatically.

---

### Edge Cases

- What happens when the Go engine exits with a non-zero code? → The background worker marks the job as `failed` with the captured stderr as `error_message`. The process crash must not crash the Node.js process.
- What happens when the Go engine produces output larger than 1MB? → Because `spawn` is used instead of `exec`, stdout is streamed in chunks and assembled incrementally, avoiding the buffer cap. No data is lost.
- What happens when Postgres is temporarily unavailable during a submission? → The API returns `503 Service Unavailable`. The job is never created in the database. The user can retry without risk of ghost jobs.
- What happens when a job is in `pending` state for an excessive duration (e.g., worker crashed before picking it up)? → This edge case is documented as a known limitation for this phase; no automatic retry or timeout escalation is required in this iteration.
- What happens when `market_data_syncs` has a stale or corrupt record? → The record is treated as authoritative; the system proceeds to download only the uncovered gap. A manual delete of the record by the operator resets the cache for that symbol.

## Requirements *(mandatory)*

### Functional Requirements

#### Docker Infrastructure
- **FR-001**: The root `docker-compose.yml` MUST include a `postgres` service using the official Postgres image with a named persistent volume mapped to the Postgres data directory.
- **FR-002**: The root `docker-compose.yml` MUST include a `pgadmin` service mapped to a distinct localhost port, providing a browser-accessible database management UI.
- **FR-003**: The Postgres service MUST expose credentials (host, port, user, password, database name) as environment variables consumable by the orchestrator without hardcoded values in source code.

#### Date Range Validation Removal
- **FR-004**: The API validation layer MUST remove any maximum date range constraint that previously limited backtest submissions to a 1-month window.
- **FR-005**: After removing the limit, the API MUST accept any date range where `start_date` is before `end_date`, with no upper bound on duration.

#### Database Schema & ORM
- **FR-006**: The orchestrator MUST use Postgres as its persistence layer via Drizzle ORM for all database interactions (schema definition, migrations, and queries).
- **FR-007**: A `backtests` table MUST be defined with at minimum: `id` (UUID primary key), `status` (enum: pending/running/completed/failed), `config` (JSONB), `summary` (JSONB, nullable), `trades` (JSONB, nullable), `safety_orders` (JSONB, nullable), `error_message` (text, nullable), `created_at`, `updated_at`.
- **FR-008**: A `market_data_syncs` table MUST be defined with at minimum: `id` (UUID primary key), `symbol` (text), `start_date` (timestamptz), `end_date` (timestamptz), `created_at`, `updated_at`. The `end_date` column MUST store the actual timestamp of the latest downloaded data record (the download run's "now"), not the user-configured backtest `end_date`.
- **FR-009**: Schema migrations MUST be managed by Drizzle and applied automatically on application startup.

#### Asynchronous Backtest Submission (HTTP 202 Detachment)
- **FR-010**: `POST /backtest` MUST insert a new row into the `backtests` table with `status = 'pending'` and return `HTTP 202 Accepted` with the new `job_id` immediately — before the Go engine is invoked.
- **FR-011**: The HTTP response lifecycle for `POST /backtest` MUST be fully closed before the Go engine process is spawned. The engine execution MUST occur in a background worker entirely decoupled from the original HTTP request.

#### Background Worker & Buffer Safety
- **FR-012**: The background worker that launches the Go engine binary MUST use `child_process.spawn` (not `child_process.exec`) to stream stdout incrementally rather than buffering the entire output in memory.
- **FR-013**: The worker MUST update the backtest row's `status` to `running` immediately after the Go process starts.
- **FR-014**: Upon successful completion (process exit code 0 and valid JSON on stdout), the worker MUST parse the streamed JSON, update the `backtests` row with `status = 'completed'` and persist `summary`, `trades`, and `safety_orders` into the corresponding JSONB columns.
- **FR-015**: Upon failure (non-zero exit code or JSON parse error), the worker MUST update the `backtests` row with `status = 'failed'` and write the stderr output to `error_message`. The Node.js process MUST NOT crash.

#### List Endpoint — Select Omission
- **FR-016**: `GET /backtests` MUST explicitly exclude the `trades` and `safety_orders` JSONB columns from its database SELECT query so that these arrays are never loaded into Node.js heap memory when listing runs.
- **FR-017**: `GET /backtests` MUST return all backtest records across all statuses, ordered by `created_at` descending.

#### Single Result Endpoint
- **FR-018**: `GET /backtests/:id` MUST return the full row including `trades` and `safety_orders`.
- **FR-019**: `GET /backtests/:id/status` MUST return a lightweight status-only payload: `{ id, status, error_message }`.

#### Sync Ledger Priority (GapResolver)
- **FR-020**: `GapResolver` MUST query the `market_data_syncs` table FIRST — before any ClickHouse network call — to determine whether downloaded market data already covers the required date range for the requested symbol.
- **FR-021**: If the sync ledger confirms full coverage, `GapResolver` MUST skip the ClickHouse fetch entirely.
- **FR-022**: If a download is required, `GapResolver` MUST fetch data from the requested `start_date` through the current system time ("now"). After the download completes, the `market_data_syncs` row's `end_date` MUST be set to the timestamp of the latest candle received (i.e., "now" at execution time), not the user-configured backtest `end_date`.

#### File System Eradication
- **FR-023**: The `ProcessManager` class MUST be deleted entirely from the codebase.
- **FR-024**: The `ResultStore` class MUST be deleted entirely from the codebase.
- **FR-025**: All code paths that use `fs.readFileSync` for reading backtest result JSON files MUST be removed. Backtest results MUST only be read from the Postgres `backtests` table.
- **FR-026**: All references to result index files and UUID-keyed JSON files on disk for backtest persistence MUST be removed.

### Key Entities

- **Backtest Job**: Represents a single backtest run from submission through completion. Identified by a UUID. Tracks lifecycle status, the input configuration, and the full output (summary metrics, trades, safety orders).
- **Market Data Sync Record**: Represents a completed download of market data for a specific trading symbol. Records the actual temporal coverage of the downloaded data (start and end timestamps of real candles), enabling the Gap Resolver to avoid redundant network downloads.
- **Background Worker**: A long-running process within Node.js that reads pending Backtest Job records, spawns the Go engine binary as a streaming child process, and writes results back to the database. Not exposed over HTTP.
- **Gap Resolver (`GapResolver`)**: Determines whether a requested time range and symbol already have downloaded market data. Acts as the cache-check gate before any ClickHouse network calls are initiated.

## Architectural Constraints *(mandatory — non-negotiable implementation gates)*

These constraints are derived from the project constitution and MUST be enforced during implementation review. Violation of any of these blocks merge.

| Gate | Constraint | Verification |
|------|-----------|--------------|
| **HTTP 202 Detachment** | `POST /backtest` returns 202 before spawning the Go process. The HTTP response must be sent and the connection closed prior to any engine invocation. | Integration test: submit request, assert 202 within 500ms before any child process event fires. |
| **Select Omission** | `GET /backtests` (list) SELECT query MUST NOT include `trades` or `safety_orders` columns. | Unit test: spy on the ORM query call and assert no `trades`/`safetyOrders` field exists in the returned payload. |
| **Sync Ledger Priority** | `GapResolver.resolve()` MUST perform a Postgres read against `market_data_syncs` BEFORE any ClickHouse client method is invoked. | Unit test: mock both Postgres and ClickHouse; assert ClickHouse mock is never called when sync ledger covers the range. |
| **Buffer Overflow Guard** | The engine-spawning worker MUST use `child_process.spawn`, never `child_process.exec`. | Code review gate: grep the worker file for `exec(`; any match is a hard rejection. |
| **File System Eradication** | Zero references to `ProcessManager`, `ResultStore`, or `fs.readFileSync` for result file reads exist in the merged code. | Code review gate + automated grep in CI: any match is a hard rejection. |
| **Sync Ledger End Date Accuracy** | `end_date` in `market_data_syncs` is always set to the timestamp of the latest downloaded candle, not the user's backtest `end_date`. | Integration test: trigger a download, assert the recorded `end_date` equals the actual last-candle timestamp, not the config value. |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Multi-year backtest submissions (1 month → 4 years) are accepted without any date-range validation error.
- **SC-002**: The `POST /backtest` endpoint responds with `202 Accepted` within 500 milliseconds regardless of how long the underlying backtest computation takes.
- **SC-003**: The `GET /backtests` list endpoint response payload contains zero bytes of trade or safety-order data even when 50 completed runs are stored.
- **SC-004**: A second backtest submission made while the first is still running receives its own `job_id` and is processed independently — no blocking or queuing delay imposed by the first run.
- **SC-005**: When a market data range is already covered by `market_data_syncs`, zero ClickHouse network calls are made for that submission.
- **SC-006**: A fresh `docker-compose up` from a clean state brings up a functioning Postgres instance and pgAdmin UI with no manual configuration steps.
- **SC-007**: After the migration, zero source files in the orchestrator reference `ProcessManager`, `ResultStore`, or filesystem-based result reads. Confirmed by a CI grep assertion.
- **SC-008**: Go engine output of arbitrary size (tested with a simulated 5MB result payload) is correctly captured and persisted without errors.

## Assumptions

- The Go engine binary path remains configurable via environment variable; no change to the engine build process is required in this feature.
- ClickHouse remains the market data query source after the data download; only the pre-download cache check (sync ledger) is added in this feature.
- Database schema migrations are applied once at application start; no runtime migration tooling is required.
- pgAdmin is a development/local-only convenience service and is not intended for production deployment.
- A single background worker instance (single-process) is sufficient for this iteration; horizontal worker scaling is out of scope.
- The Drizzle ORM schema and migrations are co-located in the `orchestrator/api` codebase, not in a separate migrations service.
