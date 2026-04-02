# API Contracts: Optimizer Sweep Session Persistence (017)

**Layer**: `orchestrator/api/src/routes/optimizer.routes.ts`  
**Base path**: `/optimizer`

---

## New Endpoints

### GET /optimizer/sessions

Returns paginated list of `SweepSession` records, sorted by `created_at DESC`.

**Query Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number (1-based) |
| `limit` | integer | `50` | Items per page (max 50) |

**Response 200 OK**:
```json
{
  "sessions": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "tradingPair": "BTC/USDC",
      "startDate": "2024-01-01",
      "endDate": "2024-12-31",
      "totalRuns": 120,
      "maxRoi": 14.35,
      "status": "completed",
      "createdAt": "2025-03-15T12:00:00Z"
    }
  ],
  "total": 87,
  "page": 1,
  "hasMore": true
}
```

**Response fields**:
- `maxRoi`: `null` when no runs completed (e.g., cancelled before first result)
- `status`: `"completed"` | `"cancelled"`

**Error 500**:
```json
{ "error": "Database query failed" }
```

---

### GET /optimizer/sessions/:id/results

Returns all `SweepRunSummary` records for the given session.

**Path Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | UUID string | SweepSession primary key |

**Response 200 OK**:
```json
{
  "results": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "sessionId": "550e8400-e29b-41d4-a716-446655440000",
      "runId": "sweep-session-abc-001",
      "configJson": {
        "price_scale": "1.1",
        "amount_scale": "2.0",
        "number_of_orders": 10,
        "take_profit_distance_percent": "0.5"
      },
      "roi": 14.3500,
      "maxDrawdown": 8.2100,
      "totalFees": 45.3200,
      "winRate": 0.6700,
      "capitalEfficiency": 12.5000,
      "executionTimeMs": 12450,
      "createdAt": "2025-03-15T12:01:30Z"
    }
  ],
  "count": 120
}
```

**Response 404**:
```json
{ "error": "Session not found" }
```

---

### DELETE /optimizer/session/:id (updated)

Cancels a running sweep AND/OR deletes the session record(s) from the database. If the session is in-memory (still running), sends SIGTERM to the engine. If the session exists in the database, cascade-deletes the session and all child `SweepRunSummary` records.

**Path Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | UUID string | Session ID (in-memory or DB) |

**Response 200 OK**:
```json
{ "status": "cancelled" }
```

**Response 404**:
```json
{ "error": "Session not found" }
```

---

## Modified Endpoints

### POST /optimizer/sweep (modified response)

The existing `POST /optimizer/sweep` response is extended with a `pruneReasons` breakdown in `pruningResult`:

**Response 200 OK** (delta from current):
```json
{
  "sessionId": "...",
  "pruningResult": {
    "generated": 200,
    "pruned": 50,
    "valid": 150,
    "prunedConfigs": [...],
    "pruneReasons": {
      "capital_exceeds_balance": 30,
      "base_order_below_minimum": 10,
      "guaranteed_fee_loss": 5,
      "exceeds_100_percent_drawdown": 3,
      "tick_size_violation": 2
    }
  },
  "validConfigs": [...],
  "preFlightSummary": {
    "minDrawdown": -8.5,
    "maxDrawdown": -35.2,
    "maxCapital": "9500"
  }
}
```

Note: All five `pruneReasons` keys are always present. Keys with zero violations have value `0`.

---

### POST /optimizer/session/:id/execute (modified SSE stream)

The execution SSE stream is extended with two new event types:

**New event type: `persistence_error`**:
```
data: {"type":"persistence_error","message":"Failed to persist session: Connection refused"}
```

**New event type: `cancelled`** (emitted when DELETE /session/:id is called mid-stream):
```
data: {"type":"cancelled","completed":30,"total":100}
```

**Existing batch result `type: "result"` (extended fields)**:
```json
{
  "run_id": "sweep-session-abc-001",
  "type": "result",
  "pnlSummary": { "roi": 14.35, "maxDrawdown": 8.21, "totalFees": 45.32 },
  "executionTimeMs": 12450,
  "candleCount": 525600,
  "eventCount": 247,
  "winRate": 0.67,
  "totalPositionsClosed": 3
}
```

---

## Go Engine Contract Changes

### EngineRequest (FR-025)

The Go engine's single-run JSON payload and `BatchJobConfig` file accept an optional `enable_wide_events` field:

```json
{
  "trading_pair": "BTC/USDC",
  "start_date": "2024-01-01T00:00:00Z",
  "end_date": "2024-12-31T00:00:00Z",
  "...all existing fields...",
  "enable_wide_events": true
}
```

- **Absent**: defaults to `false`
- **True** + `ENABLE_WIDE_EVENTS=false` in env → emits wide events (OR logic: `false OR true = true`)
- **False** + `ENABLE_WIDE_EVENTS=true` in env → emits wide events (OR logic: `true OR false = true`)
- **Absent** + `ENABLE_WIDE_EVENTS=false` in env → no wide events

### BatchResultPayload (extended)

Each `run_id` result line emitted from `--batch-config` mode now includes win rate:

```json
{
  "run_id": "sweep-abc-001",
  "type": "result",
  "pnlSummary": { "roi": 14.35, "maxDrawdown": 8.21, "totalFees": 45.32 },
  "executionTimeMs": 12450,
  "candleCount": 525600,
  "eventCount": 247,
  "winRate": 0.67,
  "totalPositionsClosed": 3
}
```

When `totalPositionsClosed = 0` (no positions closed in severe drawdown):
```json
{
  "run_id": "sweep-abc-002",
  "type": "result",
  "pnlSummary": { "roi": -99.9, "maxDrawdown": 100.0, "totalFees": 5.0 },
  "winRate": null,
  "totalPositionsClosed": 0
}
```

---

## SSE Event Type Enum (Frontend Contract)

All SSE event types emitted on the execution stream:

```typescript
type SseEventType =
  | 'result'              // individual run completed
  | 'error'               // individual run errored (engine-level)
  | 'complete'            // all runs finished
  | 'persistence_error'   // NEW: DB write failed
  | 'cancelled'           // NEW: sweep terminated mid-run
```
