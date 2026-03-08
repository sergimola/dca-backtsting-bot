# Data Model: API Layer - HTTP Service

**Feature**: 004-api-layer | **Date**: 2026-03-08 | **Phase**: Phase 1 Design

## Entity Relationship Diagram

```
User
  │
  ├─ POST /backtest
  │   └─ BacktestRequest (validation)
  │       │
  │       └─ [ProcessManager - Worker Pool]
  │           └─ [BacktestService.execute()]
  │               ├─ spawn Core Engine process
  │               ├─ stream JSON config → stdin
  │               └─ read ndjson events from stdout
  │                   │
  │                   └─ [EventBusParser]
  │                       └─ TradeEvent[] (PositionOpened, OrderFilled, etc.)
  │                           │
  │                           └─ [BacktestResult aggregator]
  │                               ├─ final_position: PositionState
  │                               ├─ pnl_summary: PnlSummary
  │                               └─ execution_time_ms: number
  │
  ├─ GET /backtest/:request_id
  │   └─ [ResultStore.retrieve(request_id)]
  │       └─ BacktestResult (from disk/SQLite)
  │
  ├─ GET /backtest?from=X&to=Y
  │   └─ [ResultStore.queryByDateRange(from, to)]
  │       └─ BacktestResult[] (paginated)
  │
  └─ GET /health
      └─ [HealthMonitor.getStatus()]
          └─ HealthResponse
```

---

## Core Entities

### 1. BacktestRequest

**Purpose**: User-submitted configuration for a single backtest execution

**Type**: Immutable input (received from HTTP request body)

**Attributes**:

| Attribute | Type | Format | Constraints | Example |
|-----------|------|--------|-------------|---------|
| entry_price | string | Decimal | > 0, 8 places max | "100.50000000" |
| amounts[] | string[] | Decimal | > 0, 8 places max | ["10.25000000", "10.25000000"] |
| sequences[] | number[] | Integer | >= 0, < 100 | [0, 1, 2] |
| leverage | string | Decimal | > 1.0 | "2.00" |
| margin_ratio | string | Decimal | 0 <= mmr < 1 | "0.50" |
| market_data_csv_path | string | Path | File must exist on Core Engine host | "/data/BTCUSDT_1m.csv" |
| idempotency_key | string (optional) | UUID RFC 4122 | Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx | "550e8400-e29b-41d4-a716-446655440000" |

**Validation Rules** (enforced by API before subprocess invocation):
- All required fields present
- Types correct (no floats for monetary values)
- Ranges valid (entry_price > 0, margin_ratio in [0,1), etc.)
- Sequences length matches amounts length
- No field duplicated

**Related Entities**:
- ← BacktestResult (1-to-1, after execution)
- → Error/ValidationError (if validation fails)

**Storage**: NOT persisted (ephemeral; only result persisted)

---

### 2. TradeEvent (Union Type)

**Purpose**: Immutable event emitted by Core Engine during backtest execution

**Type**: Streaming output from Core Engine subprocess

**Polymorphic Variants**:

1. **PositionOpenedEvent**
   - timestamp (Unix ms)
   - entry_price (Decimal)
   - initial_quantity (Decimal)
   - position_id (UUID)
   - position_state (PositionState snapshot)

2. **OrderFilledEvent**
   - timestamp (Unix ms)
   - order_id (UUID)
   - price (Decimal)
   - quantity (Decimal)
   - fee (Decimal)
   - position_state (PositionState snapshot after fill)

3. **PositionClosedEvent**
   - timestamp (Unix ms)
   - close_price (Decimal)
   - pnl (Decimal)
   - close_reason (enum: take_profit, user_exit, stop_loss)
   - position_state (final PositionState)

4. **LiquidationEvent**
   - timestamp (Unix ms)
   - liquidation_price (Decimal)
   - liquidation_fee (Decimal)
   - realized_loss (Decimal)
   - position_state (LIQUIDATED)
   - reason (string)

5. **GapDownEvent**
   - timestamp (Unix ms)
   - previous_high (Decimal)
   - current_low (Decimal)
   - filled_orders[] (array of { order_id, limit_price, quantity, fee })
   - position_state (PositionState after gap-down fills)

**Relationships**:
- Multiple TradeEvents per BacktestResult
- Events are ordered by timestamp (execution order)
- Each event contains PositionState snapshot (state delta)
- No mutable state across events (each is immutable)

**Storage**: Accumulated in BacktestResult; persisted as part of result JSON

**Parsing**: Emitted by Core Engine as ndjson (one JSON object per line)

---

### 3. PositionState

**Purpose**: Snapshot of position attributes at a specific point in time

**Type**: Value object (immutable, embedded in events)

**Attributes**:

| Attribute | Type | Format | Meaning |
|-----------|------|--------|---------|
| status | enum | OPEN / CLOSED / LIQUIDATED | Current lifecycle state |
| quantity | Decimal | 8 places | Total accumulated quantity held |
| average_cost | Decimal | 8 places | Weighted average entry price |
| margin_ratio | Decimal | 8 places | Current mmr (liquidation risk indicator) |
| max_margin_ratio | Decimal | 8 places | Configured threshold for liquidation |
| leverage | Decimal | 8 places | Current leverage multiplier |
| total_fees | Decimal | 8 places | Cumulative fees paid |
| unrealized_pnl | Decimal | 8 places | P&L if position closed at current price |
| last_update_time | Unix ms | Integer | When this state was calculated |

**Constraints**:
- 0 ≤ margin_ratio < max_margin_ratio (before liquidation)
- margin_ratio ≥ max_margin_ratio (at liquidation point)
- quantity ≥ 0 (can't be negative)
- total_fees ≥ 0 (fees only increase)

**Lifecycle**:
1. Created at PositionOpenedEvent
2. Updated at each OrderFilledEvent
3. Finalized at PositionClosedEvent or LiquidationEvent

**Storage**: Embedded in each TradeEvent; final state stored in BacktestResult.final_position

---

### 4. BacktestResult

**Purpose**: Complete output of a single backtest execution

**Type**: Immutable aggregate (persisted record)

**Attributes**:

| Attribute | Type | Format | Meaning |
|-----------|------|--------|---------|
| request_id | UUID | RFC 4122 | Unique result identifier |
| status | enum | success / failed | Execution outcome |
| events[] | TradeEvent[] | Array | All events in execution order |
| final_position | PositionState | Object | Position state at end of backtest |
| pnl_summary | PnlSummary | Object | Aggregated P&L metrics |
| execution_time_ms | number | Integer ms | Time to execute backtest in subprocess |
| timestamp | ISO 8601 | String | When result was generated (server time) |
| error | ErrorDetails (optional) | Object | Error details if status: failed |

**Relationships**:
- 1-to-1 with BacktestRequest (created from one request)
- 1-to-many with TradeEvents (contains all events)
- Contains final PositionState (last event's state snapshot)

**Storage**: Persisted to disk/SQLite for 7-day retention

**Retrieval**:
- By request_id: O(1) from SQLite index
- By date range: O(n) scan with date filtering

---

### 5. PnlSummary

**Purpose**: Aggregated profit/loss metrics calculated from event sequence

**Type**: Value object (derived from events)

**Calculated Attributes**:

| Attribute | Formula | Example |
|-----------|---------|---------|
| total_pnl | sum of (fill_price - avg_cost) * qty - total_fees | "15.50000000" |
| entry_fee | fee at PositionOpendEvent | "1.00000000" |
| trading_fees | sum of fees at OrderFilledEvents | "0.25000000" |
| liquidation_fee | fee at LiquidationEvent (if any) | "0" or "0.50000000" |
| total_fees | entry_fee + trading_fees + liquidation_fee | "1.25000000" |
| roi_percent | (total_pnl / initial_investment) * 100 | "5.50" (2 places) |
| max_drawdown_percent | ((peak_balance - trough_balance) / peak_balance) * 100 | "12.30" |
| total_fills | count of OrderFilledEvents | 3 |
| realized_pnl | final P&L (same as total_pnl for closed positions) | "15.50000000" |
| unrealized_pnl | if position still OPEN: P&L at last market price | "0" or "-5.00000000" |
| safety_order_usage_counts | frequency map: { index: count } for each safety order filled during backtest | { "1": 45, "2": 12, "3": 0 } |

**Calculation Rules**:
- All decimal calculations use `Decimal` (no floats)
- All results rounded to required precision (8 for amounts, 2 for percentages)
- Initial investment = entry_price * initial_quantity + entry_fee

**Storage**: Calculated once after all events parsed; included in BacktestResult JSON

---

### 6. ErrorDetails

**Purpose**: Error information if backtest execution failed

**Type**: Value object (only present if status: failed)

**Attributes**:

| Attribute | Type | Example |
|-----------|------|---------|
| code | string | "EXECUTION_TIMEOUT" |
| message | string | "Backtest execution exceeded 30-second timeout." |
| technical_message | string (optional) | "SIGTERM signal received" |
| core_engine_stderr | string (optional) | Truncated stdout/stderr from binary |

**Scenarios**:
- Validation error before subprocess: code = VALIDATION_*
- Subprocess timeout: code = EXECUTION_TIMEOUT
- Subprocess crash: code = EXECUTION_BINARY_CRASH
- Infrastructure error: code = BINARY_FILE_NOT_FOUND, etc.

---

## State Machine: Request Lifecycle

```
┌─────────────────┐
│  BacktestRequest│  (HTTP POST body)
│   (Received)    │
└────────┬────────┘
         │
         ├─→ [Validate]
         │    ├─→ ❌ Invalid
         │    │    └─→ HTTP 400/422 + ValidationError
         │    └─→ ✅ Valid
         │
         ├─→ [Queue Request]
         │    (Add to WorkerPool queue if all workers busy)
         │
         ├─→ [Await Worker]
         │    (Wait for available worker slot)
         │
         ├─→ [Execute Core Engine]
         │    ├─→ spawn('core-engine')
         │    ├─→ write JSON → stdin
         │    ├─→ read ndjson → stdout
         │    ├─→ timeout: 30s
         │    │
         │    ├─→ ✅ Success
         │    │    ├─→ Parse TradeEvents[]
         │    │    ├─→ Calculate PnlSummary
         │    │    └─→ Create BacktestResult (status: success)
         │    │
         │    └─→ ❌ Crashed / Timeout
         │         ├─→ Capture stderr
         │         ├─→ Map to ErrorDetails
         │         └─→ Create BacktestResult (status: failed)
         │
         ├─→ [Persist Result]
         │    ├─→ Write JSON to disk (data/results/{request_id}.json)
         │    ├─→ Index in SQLite (request_id, timestamp, status)
         │    └─→ Cleanup: Delete results > 7 days old
         │
         ├─→ [Return Result]
         │    └─→ HTTP 200 + BacktestResult (as JSON)
         │
         └─→ [Retrieval]
              ├─→ GET /backtest/:request_id → HTTP 200 + BacktestResult
              ├─→ GET /backtest?from=X&to=Y → HTTP 200 + BacktestResultPage
              └─→ GET /backtest/:request_id (404 if expired) → HTTP 404

```

---

## Data Flow: Event Sequence Processing

```
Core Engine Process
    │
    ├─→ stdout (ndjson stream)
    │    │
    │    ├─→ {"type":"PositionOpened","timestamp":...}
    │    ├─→ {"type":"OrderFilled","timestamp":...}
    │    ├─→ {"type":"OrderFilled","timestamp":...}
    │    └─→ {"type":"PositionClosed","timestamp":...}
    │
    └─ [EventBusParser]
        │
        ├─→ Split by newline
        ├─→ JSON.parse each line
        ├─→ Validate event schema
        └─→ Type events as TradeEvent[]
            │
            └─ [BacktestResult Builder]
                ├─→ Collect TradeEvent[]
                ├─→ Extract final_position from last event
                ├─→ Calculate pnl_summary from all events
                ├─→ Assign request_id + timestamp
                ├─→ Record execution_time_ms
                └─→ Create BacktestResult

```

---

## Persistence Model: 7-Day Result Storage

```
File Structure:
  data/
  ├─ results/
  │  ├─ 550e8400-e29b-41d4-a716-446655440000.json  (BacktestResult)
  │  ├─ 550e8400-e29b-41d4-a716-446655440001.json
  │  └─ ... (one file per backtest)
  │
  └─ results.db  (SQLite index)

SQLite Schema:
  CREATE TABLE results (
    request_id TEXT PRIMARY KEY,
    timestamp DATETIME NOT NULL,
    status TEXT NOT NULL,  -- 'success' | 'failed'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,  -- 7 days from created_at
    file_path TEXT NOT NULL
  );

  CREATE INDEX idx_timestamp ON results(timestamp DESC);
  CREATE INDEX idx_status ON results(status);
  CREATE INDEX idx_expires_at ON results(expires_at);

Cleanup Job:
  - Runs daily (e.g., 2 AM server time)
  - DELETE FROM results WHERE expires_at < NOW()
  - Remove corresponding JSON files
  - VACUUM results.db (reclaim space)
```

---

## Validation Invariants (NON-NEGOTIABLE)

All entities MUST satisfy these constraints:

1. **Decimal Precision**: All monetary values with exactly 8 decimal places (no rounding artifacts)
2. **Event Ordering**: TradeEvents in BacktestResult sorted by timestamp (ascending)
3. **Position State Consistency**: Each PositionState must have valid margin ratio (0 ≤ mmr < 1 before liquidation)
4. **P&L Calculation**: Must match Core Engine computation exactly (zero transformation loss)
5. **No Float Precision Loss**: All serialization/deserialization preserves exact decimal values

---

## Related References

- **Contracts**: See [contracts/](contracts/) for TypeScript interface definitions
- **Specification**: [spec.md](spec.md) § User Scenarios & Canonical Test Data
- **Core Engine**: `core-engine/domain/position/` (position state machine source of truth)
