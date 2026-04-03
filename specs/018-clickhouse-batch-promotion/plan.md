# Implementation Plan: ClickHouse Batch Promotion & Time-in-Market KPIs

**Branch**: `018-clickhouse-batch-promotion` | **Date**: 2026-04-02 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/018-clickhouse-batch-promotion/spec.md`

## Summary

Adds two Time-in-Market KPIs (`longest_trade_duration_ms`, `max_safety_orders_used`) to the Go engine's result payload and Postgres `sweep_run_summaries` table, plus a full Batch Promotion workflow: a Node.js API route that receives selected `run_id`s, re-runs them via a mini Go-engine sweep with `wide_events_to_stdout: true`, bulk-inserts the resulting wide events into ClickHouse `sweep_wide_events` (using a single `IN(...)` pre-deletion mutation for re-promotions), and streams SSE progress to the React frontend. A new Grafana dashboard `04-sweep-promoted-comparison.json` enables deep cross-run analysis. Session deletion is extended to also drop the ClickHouse partition atomically.

## Technical Context

**Language/Version**: Go 1.22 (core-engine) · TypeScript 5 / Node.js 20 (orchestrator/api) · React 18 / TypeScript (frontend)  
**Primary Dependencies**: `@clickhouse/client` (ClickHouse HTTP singleton, existing), `drizzle-orm` + `pg` (Postgres ORM, existing), Express 5 (API, existing), React 18 + TanStack Table (Leaderboard, existing)  
**Storage**: PostgreSQL (sweep summaries, config metadata) + ClickHouse (wide event time-series)  
**Testing**: `go test ./...` (unit, table-driven) · `npx jest` (Node.js API) · Playwright MCP (`mcp_playwright_*`) (E2E with direct DB verification)  
**Target Platform**: Linux server (docker-compose dev + CI)  
**Project Type**: Polyglot web service + analytics pipeline  
**Performance Goals**: Single bulk `IN(...)` delete mutation (≤1 ClickHouse mutation per promotion regardless of batch size) · 1,000-row minimum batch inserts into ClickHouse · Flush-on-exit for partial buffers  
**Constraints**: 200-config hard cap per promotion request · 409 Conflict on concurrent promotion for same session · `promoted_at` must survive page reloads  
**Scale/Scope**: Up to 200 configs per promotion batch · ClickHouse partition per session for O(1) deletion

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Evidence |
|------|--------|----------|
| No Live Trading | ✅ PASS | Feature is purely backtesting — mini-sweep re-runs historical candle data only |
| Green Light Protocol | ✅ PASS | All existing `go test ./...` and `npx jest` suites must be green before merge. New tests added in Phase E. |
| Fixed-point arithmetic | ✅ PASS | Go engine KPI fields (`longest_trade_duration_ms`, `max_safety_orders_used`) are integer counts, not monetary values. All existing `decimal.Decimal` usage unchanged. Node.js uses no new monetary math. |
| Single-position invariant | ✅ PASS | KPI tracking reads existing position events; does not alter position lifecycle or open/close logic |
| Gap-Down execution rules | ✅ PASS | No changes to candle evaluation or order-fill logic |
| Architecture constraints | ✅ PASS | KPI tracking lives in `core-engine/domain/position`. ClickHouse writes live in `orchestrator/api/src/services`. No cross-boundary contamination. |

## Project Structure

### Documentation (this feature)

```text
specs/018-clickhouse-batch-promotion/
├── plan.md              ← This file
├── spec.md              ← Feature specification (approved, 3 clarification sessions)
├── research.md          ← 10 architectural decisions (D-001 to D-010)
├── data-model.md        ← Postgres + ClickHouse DDL + Go structs + API types
├── quickstart.md        ← Dev setup, DDL, smoke tests
├── contracts/
│   └── api.md           ← Endpoint contracts
├── checklists/
│   └── requirements.md  ← Requirements checklist
└── tasks.md             ← [NOT created by /speckit.plan — use /speckit.tasks]
```

### Source Code Changes (Polyglot Architecture)

```text
core-engine/                                      # Go — Pure Domain
├── domain/position/
│   ├── tracker.go                                # NEW: KpiTracker (longestTradeDurationMs, maxSafetyOrdersUsed)
│   └── tracker_test.go                           # NEW: 6 table-driven unit tests
├── cmd/engine/
│   └── main.go                                   # MODIFY: add WideEventsToStdout field to EngineRequest,
│                                                 #         add LongestTradeDurationMs + MaxSafetyOrdersUsed to BatchRunResultOutput,
│                                                 #         wire KpiTracker into batch run loop,
│                                                 #         stdout-streaming wide event mode

orchestrator/api/                                 # TypeScript/Node.js — API + ClickHouse Relay
├── src/
│   ├── db/
│   │   └── schema.ts                             # MODIFY: add 3 columns to sweepRunSummaries
│   ├── drizzle/
│   │   └── XXXX_018_time_in_market_kpis.sql      # NEW: Drizzle migration (3 columns + index)
│   ├── services/
│   │   └── ClickHouseWideEventWriter.ts          # NEW: buffer, bulkDeleteBeforeInsert(), flush(), flushOnExit()
│   ├── services/
│   │   └── SweepPersistence.ts                   # MODIFY: persist longestTradeDurationMs, maxSafetyOrdersUsed, promotedAt
│   └── routes/
│       └── optimizer.routes.ts                   # MODIFY: POST /promote, extended DELETE, extended GET summaries
├── src/__tests__/
│   ├── clickhouse-wide-event-writer.test.ts      # NEW: 4 Jest tests (batch flush, bulk delete, flush-on-exit, 200-cap)
│   └── promote.route.test.ts                     # NEW: 3 Jest tests (409 guard, cap validation, SSE events)

frontend/src/                                     # React 18 — UI
├── components/
│   ├── LeaderboardGrid.tsx                       # MODIFY: add Longest Trade + Max SOs columns, checkbox selection
│   ├── BatchPromotionPanel.tsx                   # NEW: SSE progress, cancel button, promoted badges
│   └── formatters.ts                             # MODIFY (or NEW): msDuration formatter ("2d 4h 30m")
├── hooks/
│   └── useOptimizer.ts                           # MODIFY: promotion state, SSE subscription, promotedAt tracking
└── services/
    └── optimizerService.ts                       # MODIFY: postPromote(), getPromotionStatus() SSE consumer

grafana/dashboards/
└── 04-sweep-promoted-comparison.json             # NEW: Grafana dashboard
```

---

## Phase A — Go Engine: KPI Tracking & Stdout Wide Events

**Domain**: `core-engine/` — pure domain logic, no HTTP, no infrastructure.

### A-1: `KpiTracker` in `domain/position`

Create `core-engine/domain/position/tracker.go`:

```go
// KpiTracker accumulates Time-in-Market KPIs across all positions in a single run.
type KpiTracker struct {
    LongestTradeDurationMs int64
    MaxSafetyOrdersUsed    int
}

// OnPositionClose records a closed position's duration and safety order depth.
// closedAtMs: close candle timestamp in epoch milliseconds.
// openedAtMs: entry candle timestamp in epoch milliseconds.
// safetyOrdersFilled: count of safety orders triggered for this position.
func (k *KpiTracker) OnPositionClose(openedAtMs, closedAtMs int64, safetyOrdersFilled int)

// OnBacktestEnd handles positions still open when the backtest finishes.
// lastCandleMs: timestamp of the last candle processed by the engine.
func (k *KpiTracker) OnBacktestEnd(openedAtMs, lastCandleMs int64, safetyOrdersFilled int)
```

Implementation rules:
- `OnPositionClose`: `durationMs = closedAtMs - openedAtMs`; `if durationMs > k.LongestTradeDurationMs { k.LongestTradeDurationMs = durationMs }`. Same logic for `safetyOrdersFilled` vs. `MaxSafetyOrdersUsed`.
- `OnBacktestEnd`: same formula using `lastCandleMs - openedAtMs`.
- Zero-value struct is the correct initial state (both fields default to 0 — handles runs with no positions or no safety orders).

### A-2: Wire `KpiTracker` into `cmd/engine/main.go`

1. Add to `EngineRequest` struct:
   ```go
   WideEventsToStdout *bool `json:"wide_events_to_stdout,omitempty"`
   ```

2. Add to `BatchRunResultOutput` struct:
   ```go
   LongestTradeDurationMs int64 `json:"longest_trade_duration_ms"`
   MaxSafetyOrdersUsed    int   `json:"max_safety_orders_used"`
   ```

3. Instantiate `KpiTracker` per run. Call `OnPositionClose` when a position closes; call `OnBacktestEnd` for any open position at end of candle loop. Emit final values in `BatchRunResultOutput`.

### A-3: Wide Events Stdout Mode

In `cmd/engine/main.go` batch run loop: when `WideEventsToStdout == true`, emit each wide event as:
```json
{"type":"wide_event","run_id":"<uuid>",...WideEvent fields}
```
to `os.Stdout` as a newline-terminated JSON line. Skip the `.jsonl` temp file path for this mode.

**Result summary** continues to be emitted as `{"type":"run_result",...}` line at the end of each run.

### A-4: Go Unit Tests (`tracker_test.go`)

Six table-driven tests:
1. Three positions with durations 3.6M, 7.2M, 1.8M ms → `LongestTradeDurationMs = 7200000`
2. Safety orders 1+2+3 on first position, 1+2 on second → `MaxSafetyOrdersUsed = 3`
3. Open-at-end: position opened at T1, backtest ends at T_end → duration = `T_end - T1`
4. No safety orders triggered → `MaxSafetyOrdersUsed = 0`
5. No positions opened → both KPIs = 0
6. Single run with 1 position, safety order depth 2, closes normally → both KPIs correct

---

## Phase B — Node.js API: Migration, Writer, Persistence, Routes

**Domain**: `orchestrator/api/` — API adapter layer. No domain logic.

### B-1: Drizzle Migration

File: `orchestrator/api/drizzle/XXXX_018_time_in_market_kpis.sql` (auto-generated by `npx drizzle-kit generate` after updating `src/db/schema.ts`)

```sql
ALTER TABLE sweep_run_summaries
  ADD COLUMN longest_trade_duration_ms BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN max_safety_orders_used    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN promoted_at               TIMESTAMPTZ;

CREATE INDEX idx_sweep_run_summaries_session_promoted
  ON sweep_run_summaries (session_id, promoted_at);
```

Update `src/db/schema.ts`: add `longestTradeDurationMs`, `maxSafetyOrdersUsed`, `promotedAt` to the `sweepRunSummaries` drizzle table definition.

### B-2: `ClickHouseWideEventWriter.ts`

New service at `src/services/ClickHouseWideEventWriter.ts`. Key responsibilities:

```typescript
class ClickHouseWideEventWriter {
  private buffer: WideEventRow[] = [];
  private readonly BATCH_SIZE = 1000;

  // Accumulates a wide event. Flushes automatically when buffer >= BATCH_SIZE.
  async push(row: WideEventRow): Promise<void>

  // Flushes any remaining buffered events. MUST be called on process exit / stream close.
  async flush(): Promise<void>

  // Issues a single ALTER TABLE ... DELETE WHERE session_id = ? AND run_id IN (...)
  // NEVER issues per-run loops. Noop if runIds is empty.
  async bulkDeleteBeforeInsert(sessionId: string, runIds: string[]): Promise<void>

  private async insertBatch(rows: WideEventRow[]): Promise<void>
}
```

**Critical implementation detail for `bulkDeleteBeforeInsert`**:
```typescript
// CORRECT: single mutation regardless of batch size
await chClient.command({
  query: `ALTER TABLE sweep_wide_events DELETE WHERE session_id = {sessionId:UUID} AND run_id IN ({runIds:Array(UUID)})`,
  query_params: { sessionId, runIds: alreadyPromotedRunIds },
});

// FORBIDDEN: never do this
for (const runId of runIds) {          // ← one mutation per run = ClickHouse chokepoint
  await chClient.command({ query: `ALTER TABLE sweep_wide_events DELETE WHERE run_id = ...` });
}
```

**Flush-on-exit rule**: Register `process.on('exit')` AND pipe `child.stdout.on('close')` → call `flush()`. Without this, a run with 350 events never inserts (buffer never reaches 1,000).

### B-3: `SweepPersistence.ts` Extension

Modify `persistRunSummary()` to also persist:
- `longestTradeDurationMs` (from `BatchRunResultOutput.longest_trade_duration_ms`)
- `maxSafetyOrdersUsed` (from `BatchRunResultOutput.max_safety_orders_used`)
- `promotedAt` — set to `new Date()` when called from the promotion workflow; `null` otherwise

### B-4: Promotion Route (`optimizer.routes.ts`)

New route: `POST /optimizer/session/:sessionId/promote`

```
1. Validate sessionId exists in Postgres → 404 if not
2. Validate req.body.run_ids: array, non-empty, ≤ 200 items → 400 otherwise
3. Validate every run_id belongs to sessionId → 400 if any orphan
4. Check activePromotions.has(sessionId) → 409 if already promoting
5. Set res headers: text/event-stream, no-cache, flushHeaders()
6. Query Postgres for run_ids with non-null promoted_at → collect alreadyPromotedIds
7. If alreadyPromotedIds.length > 0 → call writer.bulkDeleteBeforeInsert(sessionId, alreadyPromotedIds)
   (single IN(...) mutation — see B-2)
8. For each run_id, retrieve config_json from sweep_run_summaries (server-side; NOT from request)
9. Append wide_events_to_stdout: true to each config
10. Write configs to tmpFile → spawn Go engine with --batch-config tmpFile
11. Stream stdout: parse \n-delimited lines
    - {"type":"wide_event",...} → push to ClickHouseWideEventWriter buffer
    - {"type":"run_result",...} → persist KPIs + set promotedAt, send promotion_progress SSE
    - {"type":"error",...} → send promotion_error SSE (non-blocking, continue)
12. On child.stdout close → writer.flush() (flush-on-exit)
13. On child.close → writer.flush(), send promotion_complete SSE, stream close
14. Register child in activePromotions map; remove on close
```

**Cancel support**: `DELETE /optimizer/session/:sessionId/promote` — sends SIGTERM to the active promotion child process (mirroring spec 017 cancellation pattern).

### B-5: `DELETE /optimizer/session/:sessionId` Extension

After Postgres cascade delete, also execute:
```sql
ALTER TABLE sweep_wide_events DROP PARTITION '<session_id>'
```
ClickHouse error → log as warning, do NOT block or roll back Postgres delete.

### B-6: `GET /optimizer/session/:sessionId/summaries` Extension

Include three new fields per summary row in the response JSON:
`longest_trade_duration_ms`, `max_safety_orders_used`, `promoted_at` (or `null`).

---

## Phase C — React Frontend: Leaderboard + Batch Promotion UI

**Domain**: `frontend/src/` — UI adapter. No business logic.

### C-1: Leaderboard Columns

In `LeaderboardGrid.tsx`, add two new TanStack Table column definitions:

| Column ID | Header | Cell | Sortable | Filterable |
|-----------|--------|------|----------|------------|
| `longest_trade_duration_ms` | Longest Trade | `msDuration(value)` → "2d 4h 30m" | ✅ | ✅ |
| `max_safety_orders_used` | Max SOs Used | integer | ✅ | ✅ |

`msDuration(ms: number): string` formatter logic:
```typescript
const days  = Math.floor(ms / 86_400_000);
const hours = Math.floor((ms % 86_400_000) / 3_600_000);
const mins  = Math.floor((ms % 3_600_000) / 60_000);
return [days && `${days}d`, hours && `${hours}h`, `${mins}m`].filter(Boolean).join(' ');
```

### C-2: Row Selection Checkboxes

Add a checkbox column (position 0) to `LeaderboardGrid.tsx`:
- Header checkbox → select/deselect all visible rows
- Row checkbox → toggle individual row selection
- Selection state managed in `useOptimizer.ts` as `selectedRunIds: Set<string>`
- When `selectedRunIds.size > 0`: show bulk toolbar with "N selected" label and enabled "Batch Promote to ClickHouse" button
- When `selectedRunIds.size === 0`: toolbar hidden or button disabled

### C-3: `BatchPromotionPanel.tsx`

New component rendered when promotion is active:
- Shows "Promoting N/M configs..." progress bar driven by SSE `promotion_progress` events
- Shows "Cancel Promotion" button → calls `DELETE /optimizer/session/:id/promote`
- On `promotion_complete`: dismiss panel, update promoted badges on rows
- On `promotion_cancelled`: dismiss panel with "Promotion cancelled" toast
- On `promotion_error` events: accumulates error list shown in collapsible details

### C-4: `useOptimizer.ts` Extensions

- `selectedRunIds: Set<string>` + `toggleRunSelection(runId)` + `selectAll()` + `clearSelection()`
- `promotionStatus: BatchPromotionStatus | null`
- `startPromotion(sessionId, runIds)`: opens SSE to `POST /promote`, drives `promotionStatus`
- `cancelPromotion(sessionId)`: calls `DELETE /promote`
- After promotion complete: re-fetch summaries to get updated `promoted_at` badges

### C-5: Promoted Badge

In `LeaderboardGrid.tsx`: rows with non-null `promoted_at` display a "↑ CH" badge or icon in a dedicated column. `promoted_at` is a server-side timestamp from the Leaderboard API — persists across page reloads.

---

## Phase D — Grafana Dashboard

**File**: `grafana/dashboards/04-sweep-promoted-comparison.json`

### Template Variables

| Variable | Type | Query |
|----------|------|-------|
| `session` | query | `SELECT DISTINCT session_id FROM sweep_wide_events ORDER BY session_id` |
| `run_config` | query | `SELECT DISTINCT run_id FROM sweep_wide_events WHERE session_id = '${session}' ORDER BY run_id` |

Both variables use ClickHouse as the datasource and are chained (session → run_config).

### Panels

1. **Equity Curve** (time series): `running_account_balance` over `timestamp`, filtered by `session_id = '${session}' AND run_id IN (${run_config})`
2. **Drawdown Timeline** (time series): `current_drawdown_pct` over `timestamp`
3. **Event Distribution** (bar chart): `count(*) GROUP BY event_type, run_id`
4. **Safety Order Depth Heatmap** (heatmap): `filled_orders_count` distribution per `run_id`

---

## Phase E — Testing

### E-1: Go Unit Tests (`tracker_test.go`)

Six table-driven tests (see Phase A-4 above). Run with `cd core-engine && go test ./domain/position/...`.

### E-2: Jest Unit Tests

**`clickhouse-wide-event-writer.test.ts`** (4 tests):
1. Push 999 rows → no flush. Push 1 more → auto-flush triggers.
2. Push 1,500 rows → exactly 1 batch of 1,000 flushed; 500 remain in buffer.
3. `bulkDeleteBeforeInsert(['id-1','id-2','id-3'])` → `chClient.command` called exactly ONCE with `IN ('id-1','id-2','id-3')` — never 3 times.
4. Flush on exit: 350 rows buffered → `flush()` → `chClient.insert` called with those 350 rows.

**`promote.route.test.ts`** (3 tests):
1. POST /promote while `activePromotions.has(sessionId)` → 409 Conflict.
2. POST /promote with 201 run_ids → 400 Bad Request.
3. POST /promote with valid 5 run_ids → SSE stream receives `promotion_progress` then `promotion_complete`.

### E-3: Playwright MCP E2E Tests

> Requires running dev stack: `docker-compose up` (orchestrator + engine + ClickHouse + Postgres + Grafana)

**Suite 1 — Full Promotion Workflow**
```
1. Navigate to Optimizer workspace
2. Load a completed sweep session with 5 runs
3. Select 3 rows via checkboxes
4. Click "Batch Promote to ClickHouse"
5. Assert: SSE progress events appear in UI ("Promoting 1/3...")
6. Assert: promotion_complete received; badges appear on 3 promoted rows
7. DIRECT DB: curl "http://localhost:8123?query=SELECT+count(*)+FROM+sweep_wide_events+WHERE+session_id='<id>'"
   → count > 0
8. DIRECT DB: psql → SELECT promoted_at FROM sweep_run_summaries WHERE run_id IN (...) → all non-null
```

**Suite 2 — Duplicate Guard (Re-promotion)**
```
1. Promote 3 runs (from Suite 1 pre-condition)
2. Select the same 3 rows again → click "Batch Promote to ClickHouse"
3. Assert: UI shows progress events (promotion proceeds normally)
4. DIRECT DB: query ClickHouse row count before and after re-promotion
   → count stays the same (no duplicates) — pre-deletion fired
5. DIRECT DB: exact query: SELECT count(*) FROM sweep_wide_events WHERE session_id=? AND run_id IN (...)
   → count equals original promoted count (not doubled)
```

**Suite 3 — Session Deletion Dual-DB Cleanup**
```
1. Promote at least 1 run to ClickHouse for session X
2. Delete session X via UI (or DELETE /optimizer/session/:id)
3. Assert: UI shows session removed
4. DIRECT DB Postgres: SELECT count(*) FROM sweep_sessions WHERE id = 'X' → 0
5. DIRECT DB ClickHouse: SELECT count(*) FROM sweep_wide_events WHERE session_id = 'X' → 0
   (partition dropped by ALTER TABLE ... DROP PARTITION 'X')
```

**Suite 4 — Grafana Dropdowns**
```
1. Navigate to Grafana dashboard 04-sweep-promoted-comparison.json
2. Assert: "session" template variable dropdown populates with at least 1 session
3. Select a session → assert "run_config" dropdown re-populates with that session's run_ids
4. Select a run_config → assert panels render data (equity curve has data points > 0)
```

**Suite 5 — Promotion Cancellation**
```
1. Promote 20 runs (enough to take > 2s)
2. Mid-promotion (after first SSE progress event), click "Cancel Promotion"
3. Assert: promotion_cancelled SSE event received; panel dismisses
4. Assert: partially promoted runs retain their ClickHouse rows (data not deleted on cancel)
5. Assert: Postgres promoted_at is set for runs that completed before cancellation
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| ClickHouse mutation queuing under load | Medium | High | Single `IN(...)` bulk delete (D-003). Monitor `system.mutations` in ClickHouse during E2E tests. |
| Flush-on-exit race condition (writer writes after ClickHouse connection closes) | Low | Medium | Register `flush()` on `child.stdout.on('close')`, not `process.on('exit')`. Exit hook is fallback only. |
| Stdout interleaving causes JSON parse failure | Low | Medium | Node.js `\n`-split line buffer pattern (already used in optimizer.routes.ts). Each line is a complete JSON object — partial-line safety guaranteed by newline framing. |
| Drizzle migration rollback leaves schema inconsistent | Low | Low | Test migration up/down in CI. Columns have `DEFAULT 0` / `NULL` — safe to add to live table without locking. |
| Grafana UUID `session_id` in `IN` clause syntax | Low | Low | Test Grafana variable query with a seeded promoted run in dev. Use `toString(session_id)` if UUID casting fails in the template variable datasource query. |

---

## Post-Design Constitution Re-Check

| Gate | Re-Evaluation | Result |
|------|--------------|--------|
| No Live Trading | All new code paths process historical candle data via the existing batch engine. Zero broker API calls. | ✅ PASS |
| Green Light Protocol | Phase E adds 6 Go tests + 7 Jest tests + 5 Playwright suites. All must pass before merge. No existing tests modified. | ✅ PASS |
| Fixed-point arithmetic | `LongestTradeDurationMs` and `MaxSafetyOrdersUsed` are integer arithmetic (subtraction of epoch timestamps, integer max). No decimal finance math introduced. All existing `decimal.Decimal` paths untouched. | ✅ PASS |
| Architecture constraints | KPI logic in `core-engine/domain/position/tracker.go`. ClickHouse writes in `orchestrator/api/src/services/ClickHouseWideEventWriter.ts`. No cross-layer contamination. | ✅ PASS |
| Event-Driven Domain | KpiTracker hooks into existing position close/end events. No new domain events required beyond what already exists in the engine event loop. | ✅ PASS |
