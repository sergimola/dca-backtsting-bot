# Backtest Timeout & Queue-Blocking Report

**Feature**: 008-clickhouse-market-data  
**Date**: 2026-03-15  
**Symptom**: `POST /backtest` returns 504 after 35s when data download is in progress; subsequent requests queue but never start until the download finishes.

---

## 1. The Execution Model (as-built)

```
HTTP Request
    │
    ▼
backtest.routes.ts ──► processManager.enqueue(jobId, asyncFn)
    │                        │
    │                        └── _processNext() [fire-and-forget]
    │                                │
    │                                ▼
    │                        [FIFO, single-slot, serial]
    │                        executeFn():
    │                          1. gapResolver.check()       ~200ms
    │                          2. downloader.downloadAndStore()  ← CAN TAKE MINUTES
    │                          3. backtestService.execute()  ~5-30s
    │
    ▼
Poll loop (same HTTP request, same Node.js event loop)
    while (elapsed < 35_000ms):
        await getStatus(jobId)
        if complete  → return 200
        if failed    → return 500
        await sleep(500ms)
    → return 504  ← fires after 35s regardless of download progress
```

---

## 2. Root Causes

### Bug A — The 35-second poll ceiling is hardcoded and too short for downloads

`backtest.routes.ts` line ~121:

```typescript
const maxPollTime = 35000; // 35 seconds
```

The poll window was designed for the Go engine execution time only (~5-30s). It does not account for the `downloadAndStore()` step that precedes it. A 2-day range (2,880 candles) takes ~3 pages × 250ms sleep + Binance latency. A 1-month range (44,640 candles) takes ~45 pages, approaching **11+ seconds of sleep alone** before any candle processing.

**Concrete timing for a 1-month range**:

| Step | Estimated time |
|---|---|
| `gapResolver.check()` (COUNT FINAL) | ~300ms |
| `downloadAndStore()` 44,640 candles (~45 pages × 250ms sleep + network) | ~20–60s |
| Go engine execution against ClickHouse | ~5–30s |
| **Total** | **~25–90s** |

The 35s window covers only the fast path. Any first-time download of a non-trivial range overflows it.

---

### Bug B — The HTTP response timeout and the job are the same lifetime

`processManager.enqueue()` is `await`-ed from the **route handler** (the same request context that owns the 35s poll loop). The async job continues running in the background after the 504 fires, but:

- The HTTP response has already been sent (504), so the client has no channel to receive the eventual result.
- The ProcessManager `_isRunning` flag stays `true` for the entire duration of the running job (download + engine). Any subsequent `enqueue()` call for request 2 **pushes to the queue but never starts** because `_processNext()` returns immediately at `if (this._isRunning) return`.

This is why request 2 (`ed1fa76c`) was permanently stuck at `pending` — request 1's download was still running inside `_processNext()`, holding the `_isRunning` lock.

---

### Bug C — No status endpoint for in-progress jobs

The frontend polls `GET /backtest/:id/status`, but that route only queries the `ResultStore`. Results are only written to the store on **success or failure** (after the poll loop ends). While a job is `running` in the ProcessManager, `GET /backtest/:id/status` returns 404 — the frontend receives no feedback during download.

---

## 3. Connected Pieces

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                   backtest.routes.ts                     │
                    │                                                           │
                    │  POST /backtest                                           │
                    │    ├─ processManager.enqueue(jobId, fn)  ◄─ await        │
                    │    └─ poll loop: getStatus() every 500ms / max 35s       │
                    │         └─ timeout → 504                                  │
                    │                                                           │
                    │  GET /backtest/:id/status                                 │
                    │    └─ reads ResultStore only (no ProcessManager check)    │
                    └─────────────────────┬───────────────────────────────────┘
                                          │
                          ┌───────────────▼───────────────┐
                          │        ProcessManager          │
                          │                               │
                          │  _isRunning: boolean          │
                          │  queue: PendingBacktest[]     │
                          │  _processNext() — serial FIFO │
                          └───────────────┬───────────────┘
                                          │ runs job
                          ┌───────────────▼────────────────────────────────────┐
                          │              executeFn (closure)                    │
                          │                                                     │
                          │  1. GapResolver.check()                             │
                          │       └─ SELECT COUNT(*) FINAL from ClickHouse/HTTP │
                          │                                                     │
                          │  2. [conditional] BinanceDownloader.downloadAndStore│
                          │       ├─ ccxt.fetchOHLCV() loop (paginated, 50ms)  │
                          │       ├─ ClickHouseWriter.insertBatch() per page    │
                          │       └─ chClient.insert() → market_data_syncs      │
                          │                                                     │
                          │  3. BacktestService.execute()                       │
                          │       ├─ spawn core-engine.exe                      │
                          │       ├─ write JSON payload to stdin                │
                          │       └─ read stdout JSON blob (events)             │
                          └─────────────────────────────────────────────────────┘
```

---

## 4. Design Options to Evaluate Later

### Option A — Decouple HTTP response from job lifecycle (recommended)
Return `202 Accepted` immediately with the `jobId`. The client polls `GET /backtest/:id/status` which reads from ProcessManager (not just ResultStore). When complete, the result is fetched via `GET /backtest/:id`.

```
POST /backtest → 202 { job_id }
GET /backtest/:id/status → { status: 'pending' | 'downloading' | 'running' | 'complete' | 'failed' }
GET /backtest/:id → { result }
```

**Upside**: No poll ceiling. Download can take as long as Binance needs.  
**Required changes**: routes, frontend polling logic, test contracts.

---

### Option B — Increase the poll ceiling adaptively
Calculate `maxPollTime` from the requested date range:

```typescript
const days = (new Date(backtestReq.end_date).getTime() - new Date(backtestReq.start_date).getTime()) / 86_400_000;
const estimatedDownloadMs = days * 45 * 1000; // ~45s/day worst case
const maxPollTime = Math.max(60_000, estimatedDownloadMs + 60_000);
```

**Upside**: Minimal code change, no frontend refactor.  
**Downside**: HTTP timeout is still an open connection; proxy/load-balancer idle timeouts (typically 60s) may still cut it; inelegant.

---

### Option C — Download as a pre-flight, separate from the queue
Run `gapResolver.check()` + `downloadAndStore()` **before** `processManager.enqueue()`. Return early with `{ status: 'downloading' }` to the client, and trigger engine execution as a subsequent step.

**Upside**: Engine queue is not blocked by downloads.  
**Required changes**: Modest — routes only. Frontend already handles `'downloading'` status (T026).

---

### Option D — Parallel workers (ProcessManager upgrade)
Replace the single `_isRunning` flag with an actual worker pool (e.g., `maxWorkers = cpuCount`). Download and engine jobs run concurrently.

**Upside**: Full throughput.  
**Downside**: Most complex; Binance rate limits must be respected across parallel downloads.

---

## 5. Immediate Workaround

Until this is refactored, the behaviour is:
- **First request for an uncached date range**: downloads data but 504s. The data **is** saved to ClickHouse correctly.
- **Second request for the same range**: `GapResolver` finds the `market_data_syncs` receipt, skips the download, and runs the Go engine directly — this will succeed within 35s.

So the current workaround is: **submit the same request twice**. The second submission will always hit the cached data path.
