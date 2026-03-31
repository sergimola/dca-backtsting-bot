# Implementation Plan: Wide Events Analytics Engine (ClickHouse Observability)

**Branch**: `015-wide-events-analytics` | **Date**: 2026-03-31 | **Spec**: [spec.md](spec.md)

## Summary

Introduce an asynchronous `WideEventEnricher` in the Go Orchestrator layer that intercepts every PSM domain event, merges it with the current candle/position/portfolio snapshot, computes on-the-fly analytics (`unrealized_pnl`, `current_drawdown_pct`), and writes the result as a fully-denormalized `WideEvent` to a per-run `.jsonl` file via a lossless buffered-channel + goroutine pattern. On the Node.js side, a new `WideEventIngester` class issues `ALTER TABLE wide_events DROP PARTITION` (idempotent partition-drop) then streams the file to ClickHouse using `@clickhouse/client`'s streaming insert. All monetary fields use `shopspring/decimal` serialized as quoted 8dp strings; JSON null is prohibited everywhere.

## Technical Context

**Language/Version**: Go 1.22 (core engine) · TypeScript 5.x / Node.js 20 (orchestrator API)  
**Primary Dependencies**: `shopspring/decimal` (Go), `bufio` stdlib, `encoding/json` stdlib, `@clickhouse/client` (Node.js, already present), `clickhouse-go/v2` (Go, already present)  
**Storage**: ClickHouse (OLAP, JSONL bulk insert) · PostgreSQL (job queue, no change)  
**Testing**: `go test` (unit + table-driven) · Jest (Node.js unit + integration)  
**Target Platform**: Linux server (Docker Compose)  
**Performance Goals**: 500,000 events written with ≤5% wall-clock overhead vs. enricher-disabled run  
**Constraints**: Zero event loss (lossless back-pressure); zero JSON null; all decimals as quoted 8dp strings  
**Scale/Scope**: One `.jsonl` file per backtest run; single bulk ClickHouse insert per run

## Constitution Check

| Gate | Status | Evidence |
|------|--------|---------|
| No Live Trading | ✅ Pass | Enricher is a pure observability adapter; no trade execution paths are touched |
| Green Light Protocol | ✅ Gated | All new Go and TS files require passing tests before merge; existing suites must remain green |
| Fixed-Point Arithmetic | ✅ Pass | All monetary/percentage fields use `decimal.Decimal`; `WideDecimal` wrapper enforces `StringFixed(8)`. No `float64` at any serialization boundary |
| Single-Position Invariant | ✅ Pass | Enricher reads `orch.position` (read-only value copy); PSM state machine is not modified |
| Gap-Down Execution Rule | ✅ Pass | Enricher is post-hoc (reads already-computed PSM events); does not influence order execution |
| Clean Architecture | ✅ Pass | `WideEventEnricher` placed in `application/orchestrator/` (app layer); `domain/position/` package is not modified |
| Async/Non-blocking Observability | ✅ Pass | Channel + goroutine pattern decouples serialization; back-pressure exposes stall duration (FR-012) |

**BDD acceptance scenarios**: [spec.md US1](spec.md#user-story-1), [spec.md US2](spec.md#user-story-2), [spec.md US5](spec.md#user-story-5)

## Project Structure

### Documentation (this feature)

```text
specs/015-wide-events-analytics/
├── plan.md                          # This file
├── research.md                      # ✅ Decision log (decimal JSON, bufio, CH streaming)
├── data-model.md                    # ✅ WideEvent struct, WideEventEnricher, TS types
├── contracts/
│   └── jsonl-wide-event-contract.md # ✅ File format, field reference, ingester sequence
└── tasks.md                         # Phase 2 output (/speckit.tasks command)
```

### Source Code Changes

```text
core-engine/application/orchestrator/
├── wide_event.go               # NEW — WideDecimal wrapper + WideEvent struct
├── wide_event_enricher.go      # NEW — WideEventEnricher struct, goroutine, lifecycle
├── wide_event_test.go          # NEW — unit tests for WideEvent struct serialization
├── wide_event_enricher_test.go # NEW — unit tests for enricher lifecycle + back-pressure
├── orchestrator.go             # MODIFIED — init enricher, call emitWideEvent per candle
└── types.go                    # MODIFIED — add WideEventStallDuration to BacktestRun

orchestrator/api/src/services/
├── WideEventIngester.ts        # NEW — partition-drop + streaming insert
└── WideEventIngester.test.ts   # NEW — unit tests (mocked chClient)
```

---

## Phase 0 Research (Complete)

All NEEDS CLARIFICATION items resolved. See [research.md](research.md).

| Unknown | Resolution |
|---------|-----------|
| Decimal JSON serialization | Default `shopspring/decimal` MarshalJSON already produces quoted strings; use `WideDecimal` wrapper for `StringFixed(8)` uniformity |
| bufio.Writer configuration | `bufio.NewWriterSize(file, 256*1024)` (256 KiB); explicit `Flush()` before `Close()` |
| Buffer overflow strategy | Lossless blocking send (`ch <- event`); 65,536 slot bounded channel; stall duration tracked |
| Pointer types / JSON null | All value types; `WideDecimal` zero → `"0.00000000"`; string zero → `""` |
| ClickHouse idempotency | `ALTER TABLE DROP PARTITION` (not DELETE); `PARTITIONED BY run_id` prerequisite |
| Node.js ingestion | `@clickhouse/client` streaming insert via `fs.createReadStream()`; `chClient.command()` for DDL |
| File path IPC | Go engine writes path to stdout JSON result; Node.js reads existing stdout parse path |

---

## Phase 1 Design

### 1.1 — WideDecimal Type and WideEvent Struct

**File**: `core-engine/application/orchestrator/wide_event.go`

Define `WideDecimal` as a type alias over `decimal.Decimal` with a custom `MarshalJSON` that calls `StringFixed(8)` and wraps in quotes. This guarantees all monetary/percentage fields serialize as `"49.09800000"` regardless of the underlying decimal's string representation.

Define `WideEvent` as a plain Go struct with no pointer fields. Field ordering in the struct should follow the six dimension groups from the spec (Identity → Market → Portfolio → Position → Analytics → Action) with matching `json:"..."` tags matching the [JSONL contract](contracts/jsonl-wide-event-contract.md) field names exactly.

`timestamp` in JSON must be RFC3339 UTC — use `json:"timestamp"` and implement `MarshalJSON` via Go's standard `time.Time` RFC3339 formatting, or use the struct tag `json:"timestamp"` with `time.Time`'s built-in JSON marshaling (which produces RFC3339).

**Zero-value contract**: Every field's Go zero value must produce the correct no-data sentinel when marshaled. Verify this with table-driven unit tests in `wide_event_test.go`.

### 1.2 — WideEventEnricher

**File**: `core-engine/application/orchestrator/wide_event_enricher.go`

```
struct WideEventEnricher
  ch         chan WideEvent      // cap = 65536
  done       chan struct{}       // closed after worker drain completes
  file       *os.File
  bw         *bufio.Writer      // NewWriterSize(file, 256*1024)
  stallTime  time.Duration      // accumulated stall duration
  stallMu    sync.Mutex         // protects stallTime
  outputPath string
```

**Constructor** `NewWideEventEnricher(outputDir, runID string) (*WideEventEnricher, error)`:  
1. `os.MkdirAll(outputDir, 0755)` — create directory if absent  
2. `os.Create(filepath.Join(outputDir, runID+".jsonl"))` — create or truncate file  
3. Initialize struct with 256 KiB bufio.Writer  
4. `go e.worker()` — start background goroutine  
5. Return enricher

**Emit** `(e *WideEventEnricher) Emit(event WideEvent)`:  
```go
start := time.Now()
e.ch <- event           // blocking send — back-pressure when buffer full
elapsed := time.Since(start)
if elapsed > 0 {
    e.stallMu.Lock()
    e.stallTime += elapsed
    e.stallMu.Unlock()
}
```
(Note: in practice elapsed is near-zero unless disk I/O stalls; no mutex overhead on the happy path.)

**worker** `(e *WideEventEnricher) worker()`:  
```go
defer close(e.done)
for event := range e.ch {              // drains until channel is closed
    b, err := json.Marshal(event)
    if err != nil {
        slog.Warn("wide_event: marshal error", "err", err)
        continue
    }
    e.bw.Write(b)             // bufio buffers; syscall only when buffer fills
    e.bw.WriteByte('\n')
}
```

**Close** `(e *WideEventEnricher) Close() (stallTime time.Duration, err error)`:  
```go
close(e.ch)         // 1. signal: no more events
<-e.done            // 2. wait: goroutine drains channel completely
flushErr := e.bw.Flush()   // 3. flush: write remaining bytes to OS
e.file.Sync()       // 4. (optional) fsync for durability
closeErr := e.file.Close() // 5. release FD
if flushErr != nil { return e.stallTime, flushErr }
return e.stallTime, closeErr
```

**Unit tests** (`wide_event_enricher_test.go`):
- Write N events, call `Close()`, read back .jsonl file, verify line count = N and each line parses to `WideEvent`
- Simulate back-pressure: fill the channel to capacity, verify `Emit()` blocks until worker drains, verify zero events dropped
- Verify correct shutdown sequence (`Close()` after `Emit()`)

### 1.3 — Orchestrator Integration

**File**: `core-engine/application/orchestrator/orchestrator.go` (modify)  
**File**: `core-engine/application/orchestrator/types.go` (modify)

**Changes to `Orchestrator` struct**:
```go
type Orchestrator struct {
    // ...existing fields...
    enricher *WideEventEnricher   // nil when wide-event output is disabled
}
```

**Changes to `OrchestratorConfig`**:
```go
type OrchestratorConfig struct {
    // ...existing fields...
    WideEventOutputDir string  // if empty, wide-event output is disabled
}
```

**Changes to `NewOrchestrator`**:  
After creating the EventBus, if `config.WideEventOutputDir != ""`:
```go
enricher, err := NewWideEventEnricher(config.WideEventOutputDir, config.BacktestID)
if err != nil {
    return nil, fmt.Errorf("wide event enricher: %w", err)
}
orch.enricher = enricher
```

**Changes to `RunBacktest`** — add `emitWideEvent` call after PSM events are processed per candle, and add enricher close at the end:

The PSM event processing loop already collects `psmEvents` per candle. After the existing `for _, psmEvent := range psmEvents` loop (which appends to EventBus), add:
```go
if orch.enricher != nil {
    orch.emitWideEvent(candle, psmEvents)
}
```

For candles that produce **no PSM events** (position open, no fills), the `PriceChangedEvent` wide event must still be emitted once per candle tick:
```go
// After PSM processing block (whether or not psmEvents is non-empty)
if orch.enricher != nil && orch.position != nil {
    orch.emitCandleWideEvent(candle)  // always emit price_changed
}
```

**Teardown** — at the end of `RunBacktest`, before returning:
```go
if orch.enricher != nil {
    stallDur, err := orch.enricher.Close()
    if err != nil {
        slog.Error("wide event enricher close error", "err", err)
    }
    backtest.WideEventStallDuration = stallDur
    backtest.WideEventFilePath = orch.enricher.OutputPath()
    if stallDur > 0 {
        slog.Warn("wide event enricher: PSM stall detected",
            "stall_duration", stallDur,
        )
    }
}
```

**Changes to `BacktestRun`** (types.go):
```go
type BacktestRun struct {
    // ...existing fields...
    WideEventFilePath       string        // path to .jsonl file; "" if enricher disabled
    WideEventStallDuration  time.Duration // cumulative PSM stall from enricher back-pressure
}
```

### 1.4 — emitWideEvent Mapping Logic

**New helper method** `(orch *Orchestrator) emitCandleWideEvent(candle *Candle)`:

Reads the orchestrator's current state snapshot and builds a `WideEvent`. This is the `price_changed` event (one per candle when a position is active or inactive).

**State reading rules** (all reads are value-copied from orch fields at the moment of call):
- `run_id` = `orch.config.BacktestID`
- `trade_id` = `orch.position.TradeID` if `orch.position != nil`, else `""`
- `timestamp` = `candle.Timestamp`
- `event_type` = `"price_changed"`
- `symbol` = `backtest.Symbol` (or `candle.Symbol`)
- Market fields = candle OHLCV fields
- `running_account_balance` = `orch.runningBalance`
- `global_candle_count` = `orch.globalCandleCount`
- Position fields: populate from `orch.position` if non-nil; else sentinel defaults
- Analytics: compute from `orch.position` and candle if position is non-nil:
  - `unrealized_pnl = (candle.Close − pos.AverageEntryPrice) × pos.PositionQuantity`
  - `current_drawdown_pct = (candle.Low − pos.AverageEntryPrice) / pos.AverageEntryPrice × 100`
  - Both use `decimal.Decimal` arithmetic; no float64 intermediate values
  - If `pos.AverageEntryPrice.IsZero()` → both analytics fields sentinel `"0.00000000"`
- Action fields: all sentinels (price_changed has no fill action)

**New overload** `(orch *Orchestrator) emitFillWideEvent(candle *Candle, psmEvent position.Event)`:

Called once per PSM event for `BuyOrderExecutedEvent`, `TradeOpenedEvent`, `TradeClosedEvent`.  
Builds a `WideEvent` with `event_type` mapped from the PSM event type, and populates Action fields from the event's payload (price, quantity, fee, order number, profit, reason).

**Event type mapping**:
| PSM event type | WideEvent event_type |
|---|---|
| `trade.opened` | `position_opened` |
| `order.buy.executed` | `order_filled` |
| `order.sell.executed` | `order_filled` |
| `trade.closed` | `position_closed` |

### 1.5 — Node.js WideEventIngester

**File**: `orchestrator/api/src/services/WideEventIngester.ts`

```typescript
export interface IngestResult {
  rowsInserted: number;
  durationMs: number;
}

export class WideEventIngester {
  constructor(private readonly client: ClickHouseClient, private readonly db: string) {}

  async ingest(runId: string, filePath: string): Promise<IngestResult> {
    const startMs = Date.now();

    // 1. Empty file guard
    const stat = await fs.stat(filePath);
    if (stat.size === 0) {
      console.warn(`[WideEventIngester] empty file for run ${runId} — skipping`);
      return { rowsInserted: 0, durationMs: Date.now() - startMs };
    }

    // 2. Schema version check (first line)
    const firstLine = await readFirstLine(filePath);
    const firstEvent = JSON.parse(firstLine);
    if (firstEvent.schema_version !== 1) {
      throw new Error(`Unsupported schema_version: ${firstEvent.schema_version}`);
    }

    // 3. Idempotent partition drop (zero-cost metadata operation)
    await this.client.command({
      query: `ALTER TABLE ${this.db}.wide_events DROP PARTITION '${runId}'`,
    });

    // 4. Streaming bulk insert
    const stream = createReadStream(filePath);
    const insertResult = await this.client.insert({
      table: `${this.db}.wide_events`,
      values: stream,
      format: 'JSONEachRow',
    });

    return {
      rowsInserted: parseInt(insertResult.summary?.written_rows ?? '0', 10),
      durationMs: Date.now() - startMs,
    };
  }
}
```

**Tests** (`WideEventIngester.test.ts`):
- Empty file → returns `{rowsInserted: 0}`, no ClickHouse calls
- Unknown `schema_version` → throws error before any ClickHouse calls
- Valid file → `DROP PARTITION` called before `insert`; `insert` receives a ReadStream
- Verify `DROP PARTITION` includes the correct `runId` in the query string

---

## Phase 1 Constitution Re-Check (Post-Design)

| Gate | Re-Check Status | Notes |
|------|----------------|-------|
| Fixed-Point Arithmetic | ✅ Pass | `WideDecimal.MarshalJSON()` calls `StringFixed(8)`; analytics use `decimal.Div`, `decimal.Mul` only |
| No JSON null | ✅ Pass | All Go struct fields are value types; zero values produce `"0.00000000"` / `""` |
| Non-blocking core loop | ✅ Pass | PSM loop blocks only if disk I/O stalls (pathological case); measured via `stallTime` |
| Clean Architecture | ✅ Pass | `WideEventEnricher` sits in app orchestrator layer; domain packages unmodified |
| Green Light Protocol | ✅ Gated | `wide_event_test.go` and `wide_event_enricher_test.go` must pass before merge |

---

## Complexity Tracking

> No constitution violations. No additional complexity justified beyond spec requirements.

---

## Quickstart Reference

See [quickstart.md](quickstart.md) for local development steps once tasks are implemented.

