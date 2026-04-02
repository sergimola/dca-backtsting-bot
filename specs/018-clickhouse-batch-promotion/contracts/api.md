# API Contracts: ClickHouse Batch Promotion & Time-in-Market KPIs

**Branch**: `018-clickhouse-batch-promotion` | **Date**: 2026-04-02

## New Endpoints

### `POST /optimizer/session/:sessionId/promote`

Initiates batch promotion: re-runs the selected configs with wide events enabled and inserts them into ClickHouse. Streams progress via SSE.

**Request**:
```json
{ "run_ids": ["uuid-1", "uuid-2", "..."] }
```
- Max 200 `run_id`s. Returns `400` if empty or > 200. Returns `404` if session not found.
- Returns `409` if a promotion is already active for this session.
- Returns `400` if any `run_id` does not belong to the session.

**Response**: SSE stream (`text/event-stream`)
```
data: {"type":"promotion_progress","completed":5,"total":50}
data: {"type":"promotion_error","run_id":"uuid-3","error":"engine error msg"}
data: {"type":"promotion_complete","completed":49,"failed":1}
```

---

### `DELETE /optimizer/session/:sessionId` (Extended)

Existing endpoint — now also drops the ClickHouse partition.

**Behavior change**: After the Postgres cascade delete, executes:
```sql
ALTER TABLE sweep_wide_events DROP PARTITION '<session_id>'
```
ClickHouse error is logged and returned as a warning but does NOT block or roll back the Postgres delete.

---

## Modified Endpoints

### `GET /optimizer/session/:sessionId/summaries`

Response now includes three additional fields per summary row:

```json
{
  "id": "uuid",
  "run_id": "...",
  "roi": 12.5,
  "longest_trade_duration_ms": 7200000,
  "max_safety_orders_used": 3,
  "promoted_at": "2026-04-02T14:30:00Z",
  ...
}
```

`promoted_at` is `null` if the run has never been promoted.

---

## Go Engine Config — New Field

`wide_events_to_stdout` (bool, optional, default `false`): When `true`, the engine writes each wide event as a JSON line to stdout with `"type":"wide_event"` discriminator, instead of writing to a `.jsonl` temp file.
