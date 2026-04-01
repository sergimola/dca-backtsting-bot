# Contract: Node.js API — Optimizer Endpoints

**Branch**: `016-optimizer-workspace` | **Date**: 2026-04-01

---

## Overview

Three new HTTP endpoints are added to the existing Express API (`orchestrator/api/src/routes/`).

All request/response bodies use `application/json` unless noted. Authenticated via the existing middleware (no changes required).

---

## `POST /optimizer/sweep/count`

**Purpose**: Return combinatorial math (generated / pruned / valid) for real-time Configurator footer display. Lightweight — does **not** invoke the Go engine; pruning counts are estimated from the O(k) Pre-Flight logic only.

### Request Body

```typescript
interface SweepCountRequest {
  parameters: SweepParameter[];    // see data-model.md
  accountBalance: string;          // decimal string
}
```

### Response `200 OK`

```typescript
interface SweepCountResponse {
  generated: number;
  pruned: number;       // estimated from parameter validation only (base_order < $10)
  valid: number;
  overLimit: boolean;
  limitExceeded?: {
    count: number;
    limit: number;      // always 10_000
  };
}
```

**Note**: `pruned` in this response is a lower-bound estimate (only validates `base_order < $10` locally; full capital-based pruning requires Go batch-preflight and is NOT done here). The Configurator footer treats this as directional — precise counts are shown after  `POST /optimizer/sweep` completes.

### Error Responses

| Status | Condition |
|--------|-----------|
| `400` | Invalid sweep parameter schema |

---

## `POST /optimizer/sweep`

**Purpose**: Expand sweep parameters, invoke Go `--batch-preflight`, prune, return valid configs and precise pruning summary.

### Request Body

```typescript
type SweepRequest = SweepDefinition;  // see data-model.md
```

### Response `200 OK`

```typescript
interface SweepResponse {
  sessionId: string;       // UUID v4 — use to launch execution
  pruningResult: PruningResult;
  preFlightResults: PreFlightSummary[];  // one per valid config
}

interface PreFlightSummary {
  run_id: string;
  max_drawdown_covered_pct: string;
  total_capital_required: string;
}
```

### Error Responses

| Status | Condition |
|--------|-----------|
| `400` | `generated > 10_000` — body: `{ error: "combination_limit_exceeded", count: N, limit: 10000 }` |
| `400` | Invalid range (start > end, step <= 0) |
| `400` | Missing required fields (symbol, dates) |
| `500` | Go batch-preflight subprocess failed |

---

## `POST /optimizer/session/:sessionId/execute`

**Purpose**: Spawn Go `--batch-config` for the given session and stream results as Server-Sent Events.

### URL Parameters

| Param | Type | Description |
|-------|------|-------------|
| `sessionId` | string | UUID from `POST /optimizer/sweep` response |

### Response Headers

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

### SSE Event Stream

Each event is a JSON-encoded `BatchRunResult`. Events are emitted as each Go worker completes a run.

**Event format**:
```
data: {"type":"result","run_id":"...","pnlSummary":{...},"executionTimeMs":1234,...}\n\n
```

**Error run event**:
```
data: {"type":"error","run_id":"...","error_message":"..."}\n\n
```

**Completion event** (final event after all runs):
```
data: {"type":"batch_summary","total_runs":100,"completed_runs":98,"error_runs":2,"total_execution_time_ms":45230}\n\n
```

**Error (stream-level)** — emitted if Go process crashes before all runs complete:
```
data: {"type":"stream_error","message":"Go engine process exited unexpectedly","completed_runs":40,"total_runs":100}\n\n
```

### Error Responses (before streaming starts)

| Status | Condition |
|--------|-----------|
| `404` | `sessionId` not found |
| `409` | Session already executing |
| `500` | Temp file write failed |

---

## `DELETE /optimizer/session/:sessionId`

**Purpose**: Cancel a running sweep. Terminates the Go engine process and preserves completed results.

### Response `200 OK`

```typescript
interface CancelResponse {
  sessionId: string;
  cancelledAt: string;   // ISO 8601
  completedRuns: number;
  totalRuns: number;
}
```

### Error Responses

| Status | Condition |
|--------|-----------|
| `404` | Session not found |
| `409` | Session already complete or cancelled |
