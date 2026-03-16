# Feature Specification: Auto-Downloader & ClickHouse Migration

**Feature Branch**: `008-clickhouse-market-data`  
**Created**: 2026-03-14  
**Status**: Draft  
**Input**: Migrate market data storage from flat CSVs to ClickHouse, and implement an automated downloader that fetches missing historical data from Binance on-demand.

**Constitution Gates (MANDATORY)**:
- **Green Light Protocol**: All existing tests must remain green. New BDD acceptance scenarios covering gap detection, batch insert enforcement, and streaming query correctness must pass before merge.
- **ClickHouse Batching Rule**: Single-row inserts are STRICTLY PROHIBITED. All database writes must use bulk batch operations with a minimum of 1,000 rows per insert. Violating this gate causes MergeTree fragmentation and is a blocking defect.
- **Go Engine Independence**: The Go engine must query ClickHouse directly via the native driver. The Node.js API layer MUST NOT query the database and forward results to Go over stdin as a JSON payload — this anti-pattern defeats streaming and blows memory on large date ranges.
- **BDD acceptance criteria**: Given/When/Then scenarios are provided in each User Story below, covering the three core invariants: gap detection and backfill triggering, batch enforcement, and memory-flat streaming.
- **Data Integrity & Exchange Safety Rules**:
  - The `GapResolver` MUST calculate gaps by comparing the mathematical expected number of 1-minute candles (`floor((endMs - startMs) / 60_000) + 1`) against the actual `COUNT(*)` in the database. Simple `MIN`/`MAX` timestamp checks are **prohibited** — they hide "swiss cheese" patterns where interior days are missing while the boundary timestamps appear complete.
  - The downloader MUST drop the final fetched candle if its timestamp equals the current, ongoing (unclosed) minute. Storing an in-progress candle corrupts `volume` and `close` data permanently; deduplication cannot fix incorrect values, only exact duplicates.
  - The downloader MUST explicitly configure `ccxt` rate limiting (`enableRateLimit: true`) **and** enforce a deliberate sleep (minimum 50 ms) between paginated batch requests. Relying on `ccxt`'s built-in throttle alone is insufficient during massive multi-year backfills and risks an exchange IP ban.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Auto-Download on Gap Detection (Priority: P1)

A user requests a backtest for a symbol and date range. The system detects that some or all of the required candle data is absent from the database. Before the backtest engine is started, the API layer automatically fetches the missing candles from the exchange, stores them in the database, and only then launches the engine — all without the user needing to upload a CSV file manually.

**Why this priority**: This story is the entire motivation for the feature. Without it, users are stuck with manual CSV management. Every other story depends on data being in the database first.

**Independent Test**: With an empty database, submit a backtest request for any symbol and date range. The system must fetch candles automatically, complete the download, and return a valid backtest result — no CSV involvement.

**Acceptance Scenarios**:

1. **Given** the database contains no market data for ETH/USDT, **When** a user submits a backtest request for ETH/USDT from 2024-01-01 to 2024-02-01, **Then** the API layer detects the missing range, downloads the required candles from Binance, inserts them into the database in batches, and then starts the engine.
2. **Given** the database has ETH/USDT data up to 2024-01-15 but the request covers up to 2024-02-01, **When** the gap resolver runs, **Then** only the missing portion (2024-01-16 to 2024-02-01) is fetched and inserted — already-stored candles are not re-downloaded.
3. **Given** the requested date range is fully covered by existing database records, **When** the backtest is submitted, **Then** no download is triggered and the engine starts immediately.
4. **Given** a date range requiring more than 1,000 candles (i.e., a multi-page Binance request), **When** the downloader runs, **Then** it pages through all required requests and the final stored row count matches the full requested range with no gaps.
5. **Given** the downloader fetches candles that partially overlap with data already in the database (e.g., a small overlap on adjacent fetch windows), **When** the batch is inserted, **Then** the overlapping rows are silently deduplicated and no duplicate candles appear in subsequent queries.

---

### User Story 2 - Memory-Flat Streaming for Large Backtests (Priority: P1)

A user runs a long-horizon backtest spanning multiple years of minute-level candles (potentially millions of rows). The Go engine must not load all candles into memory at once. Instead it streams rows one-by-one from the database directly into the backtest loop. The user observes a stable memory profile regardless of the date range selected.

**Why this priority**: Equal priority to P1 because without memory-safe streaming, large backtests crash or become unusable, undermining the feature's core value.

**Independent Test**: Trigger a 3-year backtest at 1-minute resolution (~1.5 million candles). Observe that the Go engine process memory stays flat (does not grow proportionally to candle count) and the backtest completes without an out-of-memory error.

**Acceptance Scenarios**:

1. **Given** a backtest covering 3 years of 1-minute candles for a single symbol, **When** the Go engine queries the database, **Then** it streams rows through an internal channel rather than loading all rows into a slice — memory usage does not scale with candle count.
2. **Given** the Go engine is started for a backtest, **When** the engine requests candle data, **Then** it establishes its own direct connection to the database — the Node.js API layer does not relay or buffer any candle rows.
3. **Given** the Go engine's streaming query is active, **When** the engine consumer processes each row, **Then** rows are yielded in ascending timestamp order (oldest first) matching the backtest's chronological execution requirement.
4. **Given** the streaming query is in progress and the backtest completes or is cancelled, **When** no more rows are needed, **Then** all database resources (cursors, connections) held by the engine are released promptly without leak.

---

### User Story 3 - Visible Download Progress in the UI (Priority: P2)

A user submits a backtest for a large missing date range. While the downloader is running, the UI displays a clear "Downloading market data…" status message. The user understands the system is working and does not perceive it as frozen or failed. When the download finishes, the status automatically transitions to the normal running state.

**Why this priority**: Without visible status, users on slow connections or large date ranges will see a spinner that looks identical to a hang, causing confusion and support requests.

**Independent Test**: Submit a backtest for a large date range not in the database. Confirm the UI transitions through: `PENDING` → `DOWNLOADING_DATA` → `RUNNING` → `COMPLETE` (or `FAILED`). Each state must produce a distinct, readable message in the status area.

**Acceptance Scenarios**:

1. **Given** a backtest is submitted and the gap resolver detects missing data, **When** the download begins, **Then** the UI displays a status of `DOWNLOADING_DATA` with a user-readable message such as "Downloading missing market data…".
2. **Given** the UI is polling for backtest status and receives `DOWNLOADING_DATA`, **When** the download completes and the engine starts, **Then** the status transitions to `RUNNING` without requiring a page refresh.
3. **Given** the status is `DOWNLOADING_DATA`, **When** the user waits, **Then** the UI does not display an error or timeout message during a normal download — the state persists until the transition occurs.
4. **Given** the download fails (e.g., exchange API unreachable), **When** the error is detected, **Then** the status transitions to `FAILED` with an error message explaining that data fetching failed, not that the backtest failed.


### Edge Cases

- What happens when the exchange API is unreachable during a download? The backtest transitions to `FAILED` immediately with a clear error; partially downloaded batches already committed to the database are retained (they are valid data and can be reused on retry).
- What happens when the requested date range extends beyond the current date? The system fetches all available candles up to the latest available timestamp and proceeds with the partial range rather than failing.
- What happens when the database is unreachable at engine start-up? The system returns a `FAILED` status with an error indicating the storage layer is unavailable; no silent fallback to CSV occurs.
- What happens when the downloader fetches a batch of exactly 0 candles from the exchange (exchange has no data for that window)? The batch is skipped without error; the gap resolver stops requesting further pages for that window.
- What happens when a candle row already exists in the database with the same symbol and timestamp? The storage engine's built-in deduplication handles the conflict silently — no error is raised and no duplicate row is created.
- What happens when the entire requested date range is in the database? Gap detection returns no missing ranges immediately and the engine is started without any download step or UI status change to `DOWNLOADING_DATA`.
- What happens when a download is interrupted (process crash or timeout) mid-batch? On the next request for the same range, gap detection re-evaluates what is present and re-downloads only the still-missing portion; already-committed batches are not re-fetched.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The API layer MUST check whether all candles for the requested symbol and date range exist in the database before starting the backtest engine. This check is called the gap resolver and runs synchronously before engine launch.
- **FR-002**: When the gap resolver identifies missing candle data, the system MUST fetch the missing candles from the exchange using paginated requests, assembling the full range from multiple pages as needed.
- **FR-003**: All candle data written to the database MUST be inserted in batches of at least 1,000 rows per operation. Individual row inserts are forbidden.
- **FR-004**: The gap resolver MUST identify the precise missing sub-range within the requested date range and download only those candles — existing data in the database MUST NOT be re-fetched or overwritten through the normal download path.
- **FR-005**: The backtest engine MUST establish its own direct database connection and stream candle rows directly into the processing loop. The API layer MUST NOT act as a data relay between the database and the engine.
- **FR-006**: The backtest engine MUST stream candle rows from the database rather than loading all rows into memory at once; memory usage MUST remain bounded and not scale proportionally with the number of candles in the requested range.
- **FR-007**: Candle rows returned by the engine's streaming query MUST be ordered by ascending timestamp.
- **FR-008**: While the gap resolver is downloading missing data, the system MUST report a `DOWNLOADING_DATA` status that the UI can poll and display to the user.
- **FR-009**: The `DOWNLOADING_DATA` status MUST transition to `RUNNING` (when download succeeds) or `FAILED` (when download fails) without requiring a page reload.
- **FR-010**: When a download fails (e.g., exchange unreachable, network timeout), the system MUST report a `FAILED` status with an error message that distinguishes a data-fetch failure from a backtest-execution failure.
- **FR-011**: The market data storage schema MUST support storing candles for multiple symbols and enable efficient retrieval by symbol and time range.
- **FR-012**: The schema MUST use a storage engine that deduplicates rows sharing the same symbol and timestamp, so that re-downloading overlapping windows does not introduce duplicate candles into query results.
- **FR-013**: Previously supported CSV file-based data loading MUST be removed from the engine. The engine MUST use the database as its sole candle data source.
- **FR-014**: Database connection settings (host, port, credentials) MUST be configurable via environment variables; they MUST NOT be hard-coded.

### Key Entities

- **Candle (OHLCV)**: A single time-period price record for a trading symbol. Attributes: symbol (identifier), timestamp (UTC, millisecond precision), open price, high price, low price, close price, and traded volume. The combination of symbol + timestamp is the natural unique key.
- **Market Data Gap**: A contiguous time interval within the requested backtest range for which no candle records exist in the database. The gap resolver produces a list of such intervals that must be fetched before the engine can be started.
- **Download Batch**: A group of candles fetched in a single exchange API call (bounded by the exchange's per-request limit) and written to the database as a single bulk insert operation of at least 1,000 rows.
- **Backtest Status**: A state machine value communicated from the API layer to the UI. For this feature, a new state `DOWNLOADING_DATA` is introduced alongside the existing `PENDING`, `RUNNING`, `COMPLETE`, and `FAILED` states.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can run a backtest for any supported symbol and date range without manually uploading or locating a CSV file — the system handles data acquisition automatically.
- **SC-002**: A 3-year backtest at 1-minute resolution completes without an out-of-memory crash; peak memory used by the engine does not scale linearly with candle count.
- **SC-003**: The UI displays a "Downloading market data" status during any data fetch, ensuring the user is never presented with a frozen or unresponsive interface during download-backed backtests.
- **SC-004**: Re-running a backtest for the same date range after the initial download does not trigger a second download — results are returned faster on subsequent runs for the same symbol and period.
- **SC-005**: All batch insert operations contain at least 1,000 rows; no single-row insert to the candle table occurs during any test or production run, verifiable by automated test.
- **SC-006**: All existing automated tests continue to pass after CSV loading is removed from the engine (Green Light Protocol satisfied).
- **SC-007**: When the exchange API is unavailable during a download attempt, the UI surfaces a clear failure message within the polling interval rather than timing out silently.

## Assumptions

- A ClickHouse instance is accessible to both the Node.js API and the Go engine (e.g., running in Docker, exposed on the standard ports). Neither component is responsible for provisioning or migrating the ClickHouse instance.
- The exchange's historical OHLCV endpoint returns at most 1,000 candles per request. The downloader must paginate across multiple requests to cover multi-week or multi-month ranges.
- The `ReplacingMergeTree` storage engine's background deduplication is sufficient to handle the occasional overlap between adjacent download windows. Queries may transiently return duplicate rows if the background merge has not yet run; this is acceptable for non-production environments. For correctness-critical queries, a `FINAL` qualifier in the SELECT statement should be used.
- The UI polling interval is short enough (e.g., 1–2 seconds) that `DOWNLOADING_DATA` status changes are visible to users without feeling stale.
- The Go engine's existing CSV-based data loading path is removed entirely as part of this feature; there is no hybrid mode where both CSV and database sources coexist.
