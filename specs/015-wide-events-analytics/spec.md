# Feature Specification: Wide Events Analytics Engine (ClickHouse Observability)

**Feature Branch**: `015-wide-events-analytics`  
**Created**: 2026-03-31  
**Status**: Draft  

**Constitution Gates (MANDATORY)**:

- **Green Light Protocol**: All acceptance tests (BDD scenarios below) must pass before merge. The wide-event file output must be validated against the universal schema in a dedicated test run using known fixture data.
- **Fixed-Point Arithmetic**: All monetary fields written to wide events (`action_price`, `action_quantity`, `action_fee`, `realized_pnl`, `unrealized_pnl`, `average_entry_price`, `total_capital_deployed`, `take_profit_price`, `liquidation_price`, `current_drawdown_pct`) MUST originate from `decimal.Decimal` values and be serialized as **quoted JSON strings** (e.g., `"49.09800000"`) — never as raw JSON numbers (no float64 intermediaries).
- **BDD Acceptance Criteria**: All five user stories below carry Given/When/Then scenarios that constitute execution invariants. Scenario 1 (non-blocking I/O) and Scenario 2 (drawdown visibility) are binding acceptance gates.

---

## Overview

The Go Orchestrator layer currently drives the Position State Machine (PSM) and emits narrow domain events (order filled, position opened/closed). These serve the UI/OLTP path well, but they are too narrow for quantitative analysis — individual events lack market context, portfolio state, and derived analytics at the moment they fired.

This feature introduces a **Wide Event Enricher** — an asynchronous component that sits adjacent to the PSM loop. It intercepts every domain event, merges it with the current candle, position, and portfolio snapshot, serializes the result as a single flat JSON object, and buffers it for bulk output. The output contract is a `.jsonl` file per backtest run, consumed by the Node.js API layer for bulk ClickHouse ingestion.

No event detail is ever lost. Simulation ticks pause only in the extreme pathological case of a sustained disk I/O stall, where a brief back-pressure stall is far preferable to corrupting the dataset.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Non-Blocking Wide Event Emission (Priority: P1)

As a quant analyst running a multi-year backtest, I want every simulated minute to emit a wide event that captures the full system state at that instant, without slowing down the simulation, so that I can run analytical queries without re-running backtests.

**Why this priority**: The simulation hot-path is the highest-frequency code path. Any latency introduced here multiplies across hundreds of thousands of candles. This is the foundational correctness gate — if I/O blocks the loop, the entire feature is invalid.

**Independent Test**: Run a 500,000-candle backtest and compare wall-clock duration with and without the wide-event enricher active. The `.jsonl` file must exist and contain exactly 500,000 lines post-run.

**Acceptance Scenarios**:

1. **Given** a backtest run of 500,000 1-minute candles, **When** the enricher is enabled, **Then** the total simulation wall-clock time does not increase by more than 5% compared to a run with the enricher disabled.
2. **Given** the PSM loop is processing candle N, **When** the enricher's internal buffer is full, **Then** the worker goroutine drains the backlog asynchronously; in the extreme pathological case of a sustained disk I/O stall, the enricher applies brief back-pressure to the PSM loop rather than dropping the event — zero events are ever discarded.
3. **Given** a completed backtest run, **When** the output file is read, **Then** it contains one JSON object per line, each line independently parseable, and the line count matches the total event count reported by the engine.

---

### User Story 2 — Deep Drawdown Visibility on Every Minute (Priority: P1)

As a risk analyst, I want `PriceChangedEvent` (fired every minute candle) to emit a wide event carrying the live `unrealized_pnl` and `current_drawdown_pct` — even when no order filled — so that I can reconstruct the full drawdown curve of any position over time.

**Why this priority**: Drawdown analysis requires continuous per-minute state. Without this, data only exists at order-fill moments, producing a sparse, misleading picture of risk exposure.

**Independent Test**: Start a backtest with a single open DCA position. Feed it a candle where `candle_low` is 45.5% below `average_entry_price`. Assert the emitted wide event contains `event_type: "price_changed"`, `current_drawdown_pct: -45.5` (or equivalent exact value), and a valid `unrealized_pnl` computed from `candle_close`.

**Acceptance Scenarios**:

1. **Given** a position is open with `average_entry_price = 100.00`, **When** a candle arrives with `candle_low = 54.50` and `candle_close = 60.00`, **Then** the emitted wide event has `event_type: "price_changed"`, `current_drawdown_pct: -45.50`, and `unrealized_pnl` reflecting the difference between `candle_close` and `average_entry_price` multiplied by `position_quantity`.
2. **Given** no position is open, **When** a `PriceChangedEvent` fires, **Then** the emitted wide event carries safe default values for all position and analytics fields: `trade_id` is `""`, all numerical position and analytics fields are `"0"` (quoted decimal strings). No field is JSON null.
3. **Given** a position is open, **When** 1,000 consecutive minute candles fire with no orders filled, **Then** the `.jsonl` output contains 1,000 lines with `event_type: "price_changed"` and monotonically updated `global_candle_count` values.

---

### User Story 3 — Order Fill Wide Events with Complete Action Context (Priority: P2)

As a quant analyst, I want every order fill event (DCA buy, take-profit sell) to emit a wide event that captures both the action details (price, quantity, fee, order number) and the full resulting position state, so that I can track the precise evolution of each DCA ladder rung.

**Why this priority**: Order fill analysis is the second most critical use case after drawdown. Analysts need to know not just that an order filled, but what the portfolio looked like the instant it filled.

**Independent Test**: Run a backtest that triggers exactly 3 DCA buy orders and 1 take-profit. Assert 4 wide events with `action_price`, `action_quantity`, `action_fee` populated; assert `order_number` increments 1→2→3 on buys; assert the take-profit event has `realized_pnl` populated and `close_reason: "take_profit"`.

**Acceptance Scenarios**:

1. **Given** a DCA buy order fills at order number 2, **When** the wide event is emitted, **Then** `event_type: "order_filled"`, `order_number: 2`, `action_price`, `action_quantity`, and `action_fee` are all populated with exact decimal values.
2. **Given** a position closes via take-profit, **When** the wide event is emitted, **Then** `realized_pnl` contains the exact net profit (after fees), `close_reason: "take_profit"`, and all position fields reflect the state at the moment of close.
3. **Given** a position closes via stop-loss or manual close, **When** the wide event is emitted, **Then** `close_reason` reflects the actual close reason, and `realized_pnl` is negative or zero as appropriate.

---

### User Story 4 — Relational Boundary: No Config Duplication (Priority: P2)

As a data engineer building ClickHouse queries, I want wide events to carry only the `run_id` foreign key (not the static backtest config fields like `amount_scale`, `multiplier`, `take_profit_pct`), so that storage is efficient and analytical joins remain simple.

**Why this priority**: Denormalization is strategic — duplicate the volatile, snapshot-at-time state; join for the static config. This boundary must be specified before schema design to prevent data bloat and query confusion.

**Independent Test**: Inspect the schema of any emitted wide event. Assert none of these fields are present: `amount_scale`, `multiplier`, `take_profit_pct`, `stop_loss_pct`, `initial_investment`, `price_drop_percentage`, `num_safety_orders`.

**Acceptance Scenarios**:

1. **Given** a wide event is serialized, **When** its JSON keys are enumerated, **Then** none of the static config fields defined in the BacktestConfig entity are present.
2. **Given** a ClickHouse query joins `wide_events` on `run_id` to a `backtest_configs` table, **When** the join resolves, **Then** all static config dimensions are available without duplication in storage.

---

### User Story 5 — Bulk ClickHouse Ingestion Without Small Writes (Priority: P3)

As a system operator, I want the bulk ingestion path to deliver events to ClickHouse in a single batch per backtest run (via `.jsonl` file import), so that ClickHouse receives large, efficient batches rather than thousands of small row inserts.

**Why this priority**: ClickHouse is an OLAP engine optimized for bulk operations. Small sequential inserts degrade performance and create write amplification. This story enforces the correct bulk pattern.

**Independent Test**: Run a full backtest and verify that the Node.js ingestion step executes exactly one `INSERT INTO ... FROM INFILE` statement per run, regardless of how many events the run produced.

**Acceptance Scenarios**:

1. **Given** a completed backtest run with 500,000 events, **When** the Node.js ingestion step runs, **Then** exactly one bulk insert command is issued to ClickHouse, and ClickHouse confirms the row count matches the file line count.
2. **Given** a `.jsonl` file is empty (zero-event run or aborted run), **When** ingestion runs, **Then** no insert is issued and the operator receives a warning log entry.

---

### Canonical Test Data & Mathematical Proofs *(MANDATORY FOR CORE DOMAIN)*

| Input State | Action | Expected Exact Value | Notes |
|-------------|--------|----------------------|-------|
| `average_entry_price=100.00`, `candle_low=54.50` | Compute `current_drawdown_pct` | `-45.50000000` | `(54.50 - 100.00) / 100.00 * 100` — uses candle_low, not close |
| `position_quantity=2.500000`, `average_entry_price=100.00`, `candle_close=60.00` | Compute `unrealized_pnl` | `-100.00000000` | `(60.00 - 100.00) * 2.5` |
| `action_quantity=0.500000`, `action_price=98.00`, `action_fee=0.098000` | Compute `total_capital_deployed` after fill | `49.09800000` | `action_quantity * action_price + action_fee` |

**Rationale**: `current_drawdown_pct` must use `candle_low` (worst intracandle price), not `candle_close`, to reflect true intracandle risk. `unrealized_pnl` uses `candle_close` (the settlement price for that minute). Any deviation from this calculation convention is a specification violation.

### Edge Cases

- What happens when `average_entry_price` is zero (no position open)? → `current_drawdown_pct` and `unrealized_pnl` emit `"0"` as their quoted default value; division is never attempted.
- What happens when the enricher's async buffer fills during a backtest? → The 65,536-slot bounded lossless buffer guarantees 100% event delivery. Under normal simulation speed the worker goroutine drains the buffer before it fills. In the pathological case of a sustained disk I/O stall, the enricher applies brief back-pressure to the PSM loop; the simulation pauses momentarily rather than losing any event.
- What happens when the `.jsonl` file write fails mid-run (disk full)? → The simulation must halt gracefully with an error; partial files must not be silently ingested.
- What happens when two concurrent backtest runs exist? → Each run produces its own isolated `.jsonl` file identified by `run_id`; no cross-contamination.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST emit one wide event per domain event processed by the PSM (including `PriceChangedEvent`, `OrderFilledEvent`, `PositionOpenedEvent`, `PositionClosedEvent`).
- **FR-002**: Every wide event MUST include all Identity fields: `run_id`, `trade_id`, `timestamp`, `event_type`, `symbol`.
- **FR-003**: Every wide event MUST include all Market snapshot fields at the moment of emission: `candle_open`, `candle_high`, `candle_low`, `candle_close`, `candle_volume`.
- **FR-004**: Every wide event MUST include Portfolio fields: `running_account_balance` and `global_candle_count`.
- **FR-005**: When a position is active at event time, the wide event MUST include all Position fields: `position_state`, `average_entry_price`, `position_quantity`, `total_capital_deployed`, `fees_accumulated`, `take_profit_price`, `liquidation_price`, `filled_orders_count`.
- **FR-006**: The wide event MUST include Analytics fields: `unrealized_pnl` (computed from `candle_close` against `average_entry_price`) and `current_drawdown_pct` (computed from `candle_low` against `average_entry_price`). Both MUST emit `"0"` (as a quoted decimal string) when no position is open. JSON null is prohibited.
- **FR-007**: Event-specific Action fields (`action_price`, `action_quantity`, `action_fee`, `order_number`, `realized_pnl`, `close_reason`) MUST be populated for fill/close events. For `PriceChangedEvent`, numeric action fields MUST emit `"0"` and `close_reason` MUST emit `""` (empty string). JSON null is prohibited in any action field.
- **FR-008**: The enricher MUST operate asynchronously with respect to the PSM simulation loop, decoupling serialization and disk I/O from candle processing. The enricher uses a fixed-size lossless internal buffer of 65,536 event slots. Under normal operation the worker goroutine drains the buffer faster than the PSM produces events. In the extreme pathological case of a sustained disk I/O stall, the enricher MUST apply brief back-pressure to the PSM loop rather than discarding events. Zero events may ever be dropped; 100% event delivery is required.
- **FR-009**: Wide events MUST be written to a `.jsonl` file (one JSON object per line, newline-delimited) identified by `run_id`. Each line must be independently parseable. Every line MUST include a `schema_version` integer field with value `1`.
- **FR-010**: The wide event schema MUST NOT contain any static backtest configuration fields. Analysis requiring config context MUST join on `run_id`.
- **FR-011**: All monetary and percentage values in the wide event MUST be serialized as quoted JSON strings (e.g., `"49.09800000"`) preserving exact decimal precision. Raw JSON numbers (IEEE 754 floats) are prohibited for any monetary or percentage field.
- **FR-012**: The enricher MUST expose back-pressure observability in the final run summary or log output — specifically the cumulative duration of any PSM stall caused by a full buffer, enabling operators to distinguish a smooth run (zero stall time) from a disk-I/O-constrained run.
- **FR-013**: JSON null is prohibited in all wide event fields. When no position is active, `trade_id` MUST be an empty string `""`, and all numerical position and analytics fields MUST be `"0"` (quoted decimal strings). This ensures ClickHouse can use non-nullable column types, avoiding the storage and query performance penalty of `Nullable` wrappers.
- **FR-014**: The `wide_events` ClickHouse table MUST be `PARTITIONED BY run_id`. The Node.js bulk ingester MUST achieve idempotency by issuing `ALTER TABLE wide_events DROP PARTITION 'your_run_id'` before the bulk INSERT. This is a zero-cost synchronous metadata operation. Standard `DELETE FROM wide_events WHERE run_id = ?` queries are prohibited — they trigger heavy asynchronous background mutations in ClickHouse that destroy write performance.

### Key Entities

- **WideEvent**: The universal, fully-denormalized observation record. Contains all six dimension groups (Identity, Market, Portfolio, Position, Analytics, Action) plus a `schema_version: 1` field. All monetary/percentage values are quoted JSON strings. One record per domain event per candle. Strictly an output artifact — not stored in PostgreSQL.
- **WideEventEnricher**: The asynchronous component that receives domain events, merges them with current state snapshots, and emits `WideEvent` records. Decoupled from the PSM via an internal buffer.
- **WideEventFile**: A `.jsonl` file on disk, one per backtest `run_id`. Produced by the enricher, consumed by the Node.js ingestion step. Filename pattern: `<run_id>.jsonl`.
- **BacktestRunContext**: The read-only snapshot of current candle, position, and portfolio state that the enricher reads at the moment of event emission. This is a value copy, not a shared mutable reference.
- **ClickHouseBulkIngester** (Node.js): The external consumer that reads the `.jsonl` file and executes idempotent ingestion: first `ALTER TABLE wide_events DROP PARTITION 'run_id'` (zero-cost synchronous partition wipe), then a single bulk `INSERT INTO wide_events FROM INFILE`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A multi-year backtest (500,000+ 1-minute candles) completes with wide-event emission enabled and wall-clock duration does not increase by more than 5% compared to a run without emission. This proves non-blocking I/O decoupling.
- **SC-002**: Every minute candle during an open position produces a wide event entry with a non-zero `current_drawdown_pct` value (a quoted string other than `"0"`), enabling full drawdown curve reconstruction at 1-minute granularity for any backtest run.
- **SC-003**: A single ClickHouse `INSERT` operation ingests the complete wide-event dataset for a 500,000-event run in under 60 seconds, demonstrating the bulk-write pattern outperforms row-by-row insertion by at least 10×.
- **SC-004**: Zero monetary precision loss — all decimal fields in the `.jsonl` output are round-trippable with no rounding difference when compared to the originating `decimal.Decimal` values in the Go engine.
- **SC-005**: Analysts can answer the question "what was the unrealized PnL and drawdown depth at every minute of a specific backtest run?" using a single sequential ClickHouse scan with no JOINs other than `run_id` → config.

---

## Clarifications

### Session 2026-03-31

- Q: What is the buffer strategy when the enricher's internal buffer is full? → A: Lossless bounded buffer with back-pressure. The enricher uses a fixed-size buffer of 65,536 event slots. Under normal simulation speed the worker goroutine drains the buffer before it fills. In the extreme pathological case of a sustained disk I/O stall, the enricher applies brief back-pressure to the PSM loop rather than dropping events. 100% event delivery is guaranteed; zero events may be discarded.
- Q: How must monetary and percentage decimal values be serialized in the JSONL output? → A: JSON strings. All decimal fields (e.g., `action_price`, `unrealized_pnl`, `current_drawdown_pct`) MUST be serialized as quoted decimal strings (e.g., `"49.09800000"`) rather than JSON numbers, to preserve exact precision without IEEE 754 truncation.
- Q: What is the idempotency contract for the bulk ingestion step when a `run_id` is retried? → A: Partition-drop idempotency. The `wide_events` table is `PARTITIONED BY run_id`. Before the bulk INSERT, the ingester issues `ALTER TABLE wide_events DROP PARTITION 'your_run_id'`, a zero-cost synchronous metadata operation. Standard `DELETE` queries are prohibited — they trigger heavy async background mutations in ClickHouse that destroy write performance.
- Q: What value does `trade_id` carry in wide events emitted by `PriceChangedEvent` when no position is active? → A: Empty string `""`. JSON null is prohibited across all wide event fields to allow ClickHouse non-nullable column types. An empty string unambiguously indicates no active trade attribution without incurring the `Nullable` column storage and query penalty.
- Q: Should the JSONL format include a schema version field for forward compatibility? → A: Yes. Every wide event MUST include a `schema_version` integer field with value `1` for this specification version. The Node.js ingester MUST reject files containing an unsupported `schema_version` value rather than silently ingesting malformed data.

---

## Assumptions

- The existing Go PSM already tracks `average_entry_price`, `position_quantity`, `total_capital_deployed`, `fees_accumulated`, `take_profit_price`, `liquidation_price`, and `filled_orders_count` as first-class fields on the position entity (per spec 002 and 013).
- The ClickHouse instance is already running and accessible (per spec 008 and the existing `docker-compose.yml`). Schema migration for the `wide_events` table is out of scope for this specification and belongs in a ClickHouse schema migration feature.
- The `run_id` is a stable identifier assigned to each backtest run before simulation begins and is available to the enricher at initialization time.
- The Node.js API layer already has a ClickHouse client and can issue `INSERT FROM INFILE` commands (per spec 008). The trigger mechanism for ingestion (post-run hook, explicit API call, or file watcher) is defined in the implementation plan, not this spec.
- The `.jsonl` output file directory is configurable and defaults to a local `./output/wide_events/` path relative to the engine binary.
- `trade_id` for `PriceChangedEvent` records where no position is active MUST be an empty string `""` (not JSON null, not zero, not the most recently closed trade's ID). This unambiguously distinguishes events with no active trade attribution while enabling ClickHouse non-nullable column types.
- The `wide_events` ClickHouse table MUST be `PARTITIONED BY run_id`. This is a prerequisite for the zero-cost `ALTER TABLE ... DROP PARTITION` idempotency pattern specified in FR-014.

