# Data Model: Pro Optimizer Workspace (017)

**Feature Branch**: `017-pro-optimizer-workspace`

---

## New Database Entities

### SweepSession

Parent record for one complete optimizer sweep (completed or cancelled). Created when a sweep finishes execution (not at sweep start — the existing in-memory `OptimizerSession` handles the in-progress lifecycle).

**Table**: `sweep_sessions`  
**Layer**: `orchestrator/api/src/db/schema.ts`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | Auto-generated database PK |
| `trading_pair` | `text` | NOT NULL | e.g., `"BTC/USDC"` |
| `start_date` | `text` | NOT NULL | ISO date string (matches engine format) |
| `end_date` | `text` | NOT NULL | ISO date string |
| `total_runs` | `integer` | NOT NULL, DEFAULT 0 | Count of SweepRunSummary records |
| `max_roi` | `numeric(10,4)` | NULLABLE | Max ROI across all runs; null if 0 completed |
| `total_execution_time_ms` | `bigint` | NULLABLE | Wall-clock ms from first result to last |
| `status` | `text` | NOT NULL, CHECK IN ('running','completed','cancelled') | Lifecycle status |
| `config_snapshot` | `jsonb` | NOT NULL | Full `SweepDefinition` JSON for audit/re-run |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT now() | Sweep creation timestamp |

**Indexes**: `created_at DESC` (default sort for history list)

**State Transition**:
```
(API creates session) → status: 'running' (not stored in DB yet — in-memory only)
(engine completes) → INSERT into sweep_sessions with status: 'completed'
(user cancels) → INSERT into sweep_sessions (or UPDATE if pre-created) with status: 'cancelled'
```
Note: The SweepSession is persisted to the database on completion/cancellation, not at launch. The in-memory `OptimizerSession` manages the live lifecycle.

---

### SweepRunSummary

Child record for one individual run within a sweep. Persisted as each batch result arrives (not buffered to end). Cascade-deleted when parent `SweepSession` is deleted.

**Table**: `sweep_run_summaries`  
**Layer**: `orchestrator/api/src/db/schema.ts`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | Auto-generated DB PK (independent of run_id) |
| `session_id` | `uuid` | FK → sweep_sessions(id) ON DELETE CASCADE | Parent session |
| `run_id` | `text` | NOT NULL | Engine-assigned ID (maps to config `idempotency_key`) |
| `config_json` | `jsonb` | NOT NULL | Individual run parameter config |
| `roi` | `numeric(10,4)` | NULLABLE | ROI % (e.g., `14.3500`) |
| `max_drawdown` | `numeric(10,4)` | NULLABLE | Max drawdown % |
| `total_fees` | `numeric(10,4)` | NULLABLE | Total fees in base currency |
| `win_rate` | `numeric(6,4)` | NULLABLE | TP closes / total closes; `null` if 0 closes |
| `capital_efficiency` | `numeric(10,4)` | NULLABLE | `roi / max_capital_required × 100`; null if pre-flight unavailable |
| `execution_time_ms` | `bigint` | NULLABLE | Run execution time in ms |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT now() | Record creation timestamp |

**Indexes**: 
- `(session_id)` — for fast child lookup by parent
- `(session_id, roi DESC)` — for leaderboard ordering queries

**Explicitly Excluded** (FR-008 — no trade-level data):
- ~~`trade_events`~~ — never persisted for sweep runs
- ~~`safety_order_usage`~~ — never persisted for sweep runs

---

## Modified In-Memory Entities (TypeScript)

### OptimizerSession (extended)

**File**: `orchestrator/api/src/types/optimizer.ts`

```typescript
interface OptimizerSession {
  sessionId: string
  phase: 'validating' | 'running' | 'complete' | 'cancelled' | 'partial'
  sweepDefinition: SweepDefinition
  validConfigs: GeneratedConfig[]
  pruningResult: PruningResult
  results: BatchRunResult[]
  createdAt: Date
  // NEW: pre-flight map for capital_efficiency lookup during persistence
  preFlightMap: Map<string, PreFlightSummary>
}
```

### BatchRunResult (extended)

**File**: `orchestrator/api/src/types/optimizer.ts` + `frontend/src/hooks/useOptimizer.ts`

```typescript
interface BatchRunResult {
  run_id: string
  type: 'result' | 'error'
  error?: string
  pnlSummary?: { roi: number; maxDrawdown: number; totalFees: number }
  executionTimeMs?: number
  candleCount?: number
  eventCount?: number
  // NEW: win rate fields from Go engine
  winRate?: number | null          // null when totalPositionsClosed = 0
  totalPositionsClosed?: number
}
```

### SweepHistoryEntry (new — UI projection)

**File**: `frontend/src/hooks/useOptimizer.ts` (or `types/optimizer.ts`)

```typescript
interface SweepHistoryEntry {
  id: string
  tradingPair: string
  startDate: string
  endDate: string
  totalRuns: number
  maxRoi: number | null        // null for cancelled with 0 runs
  status: 'completed' | 'cancelled'
  createdAt: string
}
```

### PruneReason (extended)

**File**: `orchestrator/api/src/types/optimizer.ts`

```typescript
type PruneReason =
  | 'capital_exceeds_balance'
  | 'base_order_below_minimum'
  | 'guaranteed_fee_loss'           // NEW
  | 'exceeds_100_percent_drawdown'  // NEW
  | 'tick_size_violation'           // NEW
```

### PruneBreakdown (new)

**File**: `orchestrator/api/src/types/optimizer.ts`

```typescript
interface PruneBreakdown {
  capital_exceeds_balance: number
  base_order_below_minimum: number
  guaranteed_fee_loss: number
  exceeds_100_percent_drawdown: number
  tick_size_violation: number
}
```

### PruningResult (extended)

**File**: `orchestrator/api/src/types/optimizer.ts`

```typescript
interface PruningResult {
  generated: number
  pruned: number
  valid: number
  validConfigs: GeneratedConfig[]
  prunedConfigs: PrunedConfig[]
  // NEW: per-reason breakdown (FR-016)
  pruneReasons: PruneBreakdown
}
```

---

## Modified Go Engine Entities

### EngineRequest (extended)

**File**: `core-engine/cmd/engine/main.go`

```go
type EngineRequest struct {
  // ... existing 18 fields (unchanged) ...
  
  // NEW: FR-025 — optional boolean; absent payload defaults to false
  EnableWideEvents *bool `json:"enable_wide_events,omitempty"`
}
```

### BatchResultPayload (extended)

**File**: `core-engine/cmd/engine/preflight_types.go`

```go
type BatchResultPayload struct {
  RunID            string               `json:"run_id"`
  Type             string               `json:"type"`
  Error            string               `json:"error,omitempty"`
  PnlSummary       *PnlSummaryOutput    `json:"pnlSummary,omitempty"`
  TradeEvents      []TradeEventOutput    `json:"tradeEvents,omitempty"`
  SafetyOrderUsage []SafetyOrderUsageEntry `json:"safetyOrderUsage,omitempty"`
  ExecutionTimeMs  int64                `json:"executionTimeMs,omitempty"`
  CandleCount      int                  `json:"candleCount,omitempty"`
  EventCount       int                  `json:"eventCount,omitempty"`
  // NEW: FR-010 — win rate fields
  WinRate               *float64 `json:"winRate,omitempty"`       // null when 0 positions closed
  TotalPositionsClosed  int      `json:"totalPositionsClosed,omitempty"`
}
```

---

## Validation Rules

### SweepSession
- `trading_pair`: must be non-empty
- `total_runs`: must be ≥ 0
- `status`: must be one of `running | completed | cancelled`
- `max_roi`: nullable; if present, must be a valid decimal

### SweepRunSummary
- `session_id`: must reference a valid SweepSession
- `run_id`: must match engine-emitted `run_id` (= `idempotency_key` in config)
- `win_rate`: if `totalPositionsClosed = 0`, stored as `null` (not `0/0`)
- `capital_efficiency`: if `PreFlightSummary` unavailable, stored as `null`
- All financial fields stored as `numeric(10,4)` — direct from engine float output, no re-computation

### ID Mapping (FR-011)
```
SweepRunSummary.id        ← gen_random_uuid()  (DB-generated, opaque)
SweepRunSummary.run_id    ← engine.run_id = config.idempotency_key = GeneratedConfig.run_id
SweepSession.id           ← gen_random_uuid()  (DB-generated, opaque)
```

---

## Entity Relationships

```
SweepSession (1) ──── (*) SweepRunSummary
  id (UUID PK)              id (UUID PK)
  status                    session_id (FK, CASCADE DELETE)
  trading_pair              run_id (engine idempotency_key)
  config_snapshot           config_json
  max_roi                   roi, max_drawdown, total_fees
  total_runs                win_rate, capital_efficiency
  total_execution_time_ms   execution_time_ms
  created_at                created_at
```

The parent `SweepSession.max_roi` is updated by the API layer as new run summaries arrive, keeping it in sync with the highest ROI across all completed summaries.
