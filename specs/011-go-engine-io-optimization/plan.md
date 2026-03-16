# Implementation Plan: Go Engine I/O Optimization

**Branch**: `011-go-engine-io-optimization` | **Date**: 2026-03-15 | **Spec**: [spec.md](spec.md)

## Summary

Refactor the Go backtest engine (`core-engine`) and the Node.js `BackgroundWorker` to eliminate synchronous I/O bottlenecks, implement high-fidelity progress streaming, and move all result aggregation in-process.

The primary changes are grouped across three sub-systems:

1. **Go engine (`core-engine/cmd/engine/`, `core-engine/application/orchestrator/`)**: Replace ≈32 `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]...")` calls with `slog.Debug(...)`. Add `--log-level` (default `INFO`) and `--progress-interval-ms` (default `250`) CLI flags. Add a pre-flight ClickHouse `COUNT(*)` for accurate progress percentages. Launch a `time.Ticker` goroutine that atomically reads shared candle state and emits `{"type":"progress",...}` NDJSON lines to stdout. Port the Node.js `aggregateGoEvents()` + `processGoEventsForFrontend()` aggregation pipelines into Go. Replace `BacktestOutput` with `EngineResultPayload` (JSON tags aligned to TypeScript interfaces). Emit a single `{"type":"result",...}` line at the end.

2. **Node.js orchestrator (`orchestrator/api/src/services/`)**: Refactor `BacktestService.executeInternal()` to use `readline` over the child process stdout stream. Route `type === "progress"` lines to an optional `progressHandler` callback. Route `type === "result"` to resolve the promise. Update `BacktestExecutionResult` to match the new payload shape. Update `BackgroundWorker.processJob()` to pass the progress handler (calling `BacktestJobRepository.updateProgress()`), remove `ResultAggregator` usage, and remove `processGoEventsForFrontend` usage.

3. **Database (`orchestrator/api/src/db/schema.ts` + migration)**: Add `progress INTEGER NOT NULL DEFAULT 0` and `current_metrics JSONB` columns to the `backtests` table.

## Technical Context

**Language/Version**: Go 1.22 (core engine), TypeScript 5.x / Node.js 20 LTS (orchestrator)
**Primary Dependencies**:
- Go: `log/slog` (stdlib), `flag` (stdlib), `sync/atomic` (stdlib), `time.Ticker` (stdlib), `github.com/shopspring/decimal` (existing), `encoding/json` (stdlib)
- Node.js: `readline` (stdlib), `child_process.spawn` (existing), `drizzle-orm` (existing)

**Storage**: PostgreSQL 16 via Drizzle ORM (two new columns); ClickHouse (new pre-flight COUNT query)
**Testing**: `go test ./...` (existing suite must remain green), Jest (orchestrator suite must remain green)
**Target Platform**: Linux server / Docker
**Performance Goals**: ≥500,000 candles/second at `--log-level INFO`; progress tick emit overhead <5ms per tick
**Constraints**: `stdout` must carry zero non-JSON bytes after the first progress line; all monetary arithmetic remains in `decimal.Decimal` in Go throughout computation
**Scale/Scope**: Engine processes up to ~5M candles per simulation (5-year daily granularity); progress updates fire at 250ms intervals

## Constitution Check

*GATE: Pre-Phase-0 evaluation. Re-evaluated post-Phase-1 design.*

| Gate | Status | Evidence |
|---|---|---|
| **No Live Trading** | ✅ PASS | Only simulation path modified; no live order submission code exists or is touched |
| **Green Light Protocol** | ✅ PASS | All existing `go test ./...` and Jest tests must be green before merge. New test list documented in Testing Strategy section |
| **Fixed-point arithmetic** | ✅ PASS | Monetary arithmetic path (`RunBacktest`, PSM, aggregation) stays in `decimal.Decimal` throughout. Float conversion (`InexactFloat64()`) only at final JSON serialization boundary. Nothing flows back in as float. |
| **Single-position invariant** | ✅ PASS | `RunBacktest` hot loop is not altered. The candle-processing and PSM dispatch code is unchanged — only the logging calls around it are replaced |
| **Gap-Down Rule** | ✅ PASS | PSM `ProcessCandle` is not modified; the Gap-Down fill ordering is preserved |
| **Architecture (core-engine purity)** | ✅ PASS | `core-engine/domain/position/` is not touched. Changes live in `cmd/engine/` (CLI) and `application/orchestrator/` (orchestrator-level). Logging, ticker, and aggregation are CLI concerns, not domain concerns |
| **Architecture (adapter isolation)** | ✅ PASS | `CandleLoader` interface (port) is extended with `Count()`. The ClickHouse implementation adds the pre-flight COUNT. No ClickHouse client code enters the domain layer |

**Post-Phase-1 re-evaluation**: All gates still pass. The `EngineResultPayload` struct and aggregation functions added to `cmd/engine/aggregator.go` are CLI-layer concerns (data serialization), not domain concerns.

## Project Structure

### Documentation (this feature)

```text
specs/011-go-engine-io-optimization/
├── plan.md              ← this file
├── research.md          ← Phase 0 output: 8 decisions resolved
├── data-model.md        ← Phase 1: Go structs, TS interfaces, DB schema
├── quickstart.md        ← Phase 1: build, run, verify guide
├── contracts/
│   ├── engine-stdout-protocol.md    ← NDJSON line protocol spec
│   └── backtest-service-interface.md ← TS interface versioned contract
└── tasks.md             ← Phase 2 output (generated by /speckit.tasks)
```

### Source Code Changes (Polyglot Architecture)

```text
core-engine/                         ← Go — changes here
├── cmd/engine/
│   ├── main.go                      MODIFY: add flag parsing, slog init, progress goroutine,
│   │                                         replace convertBacktestToOutput with new pipeline,
│   │                                         replace BacktestOutput with EngineResultPayload
│   └── aggregator.go                CREATE: aggregateBacktestEvents(), buildTradeEvents(),
│                                             buildSafetyOrderUsage()
├── application/orchestrator/
│   ├── orchestrator.go              MODIFY: replace all fmt.Fprintf(os.Stderr,"[ENGINE-DEBUG]...")
│   │                                         with slog.Debug(); add progressState updates
│   ├── types.go                     MODIFY: add Count() to CandleLoader interface
│   └── clickhouse_loader.go         MODIFY: implement CandleLoader.Count() method
└── (no domain/ changes)

orchestrator/api/                    ← TypeScript — changes here
├── src/
│   ├── types/index.ts               MODIFY: add ProgressLine, SafetyOrderUsageEntry interfaces;
│   │                                         update BacktestExecutionResult
│   ├── db/schema.ts                 MODIFY: add progress, currentMetrics columns
│   ├── services/
│   │   ├── BacktestService.ts       MODIFY: replace buffer with readline in executeInternal();
│   │   │                                     add progressHandler option; update return type
│   │   ├── BacktestJobRepository.ts MODIFY: add updateProgress(); update claimNext() mapping;
│   │   │                                     update BacktestRow type
│   │   └── BackgroundWorker.ts      MODIFY: pass progressHandler to service.execute();
│   │                                         remove ResultAggregator call;
│   │                                         remove processGoEventsForFrontend call
│   ├── routes/
│   │   └── backtest.routes.ts       REVIEW: confirm status endpoint exposes progress field
│   └── tests/                       MODIFY: update fixtures and assertions for new payload shape
└── drizzle/
    └── 0002_*.sql                   CREATE: ADD COLUMN progress, ADD COLUMN current_metrics
```

**Feature Placement Contract**:
- All engine changes (`main.go`, `aggregator.go`, `orchestrator.go`, `clickhouse_loader.go`) belong to `core-engine/` — mathematical event processing and CLI output. ✅
- All persistence, streaming, and API changes belong to `orchestrator/api/`. ✅
- `domain/position/` is not touched. ✅

## Change Group Descriptions

### CG-1: CLI Flag Infrastructure in `main.go`

Add `flag.Parse()` before stdin decode. Validate flag values:

```go
// Placement: top of main(), before json.NewDecoder(os.Stdin)
logLevel          := flag.String("log-level", "INFO", "")
progressIntervalMs := flag.Int("progress-interval-ms", 250, "")
flag.Parse()

// Validation
if *progressIntervalMs <= 0 {
    slog.Warn("--progress-interval-ms must be >0; using default 250")
    *progressIntervalMs = 250
}
```

### CG-2: slog Initialization

```go
func configureSlog(levelStr string) {
    var level slog.Level
    switch strings.ToUpper(strings.TrimSpace(levelStr)) {
    case "DEBUG": level = slog.LevelDebug
    case "WARN":  level = slog.LevelWarn
    case "ERROR": level = slog.LevelError
    default:      level = slog.LevelInfo
    }
    slog.SetDefault(slog.New(
        slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}),
    ))
}
```

Called immediately after flag parsing.

### CG-3: Replace [ENGINE-DEBUG] fmt.Fprintf Calls

**In `core-engine/cmd/engine/main.go`** (~20 calls):

| Old call | New slog.Debug call |
|---|---|
| `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] Decoded request:\n")` | removed (attrs on next calls sufficient) |
| `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   trading_pair = %q\n", ...)` | `slog.Debug("request decoded", "trading_pair", request.TradingPair, ...)` |
| `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] buildConfigFromRequest called\n")` | `slog.Debug("buildConfig called")` |
| `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]   TradingPair = %q\n", ...)` | merged into `slog.Debug("config params", "trading_pair", req.TradingPair, ...)` |
| `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] Parsed decimals OK: ...")` | `slog.Debug("decimals parsed", "price_entry", priceEntry, ...)` |

**In `core-engine/application/orchestrator/orchestrator.go`** (~12 calls):

| Old call | New slog.Debug call |
|---|---|
| `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] First candle: Symbol=%q ...")` | `slog.Debug("first candle", "symbol", candle.Symbol, "config_pair", configPair)` |
| `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] WARNING: candle.Symbol %q does not match ...")` | `slog.Warn("symbol mismatch", "candle_symbol", candle.Symbol, "config_pair", configPair)` |
| `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] ComputePriceSequence error: %v\n", priceErr)` | `slog.Error("price sequence computation failed", "err", priceErr)` |
| `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] ComputePriceSequence OK: ...")` | `slog.Debug("price sequence computed", "count", len(priceSeq), "entry_price", actualEntryPrice)` |
| `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] Opening new position: ...")` | `slog.Debug("opening position", "trade_id", tradeID, "entry_price", candle.Close)` |
| `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] ProcessCandle candle#%d: ...")` | `slog.Debug("process candle", "index", candleCount, "ts", candle.Timestamp, "close", candle.Close)` |
| `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] candle#%d produced %d PSM event(s)\n", ...)` | `slog.Debug("PSM events emitted", "candle", candleCount, "count", len(psmEvents))` |
| `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] Position closed at candle#%d ...\n", ...)` | `slog.Debug("position closed", "candle", candleCount)` |

All `fmt.Fprintf(os.Stderr, "Failed to ...")` error calls in main.go are kept as-is (they use stderr and only fire on fatal errors, not in the hot loop).

### CG-4: Pre-Flight Candle COUNT

**In `orchestrator/types.go`**: Add `Count() (int64, error)` to `CandleLoader` interface:

```go
type CandleLoader interface {
    NextCandle() (*Candle, error)
    Count() (int64, error)    // NEW: pre-flight row count for progress %
    Close() error
}
```

**In `orchestrator/clickhouse_loader.go`**: Implement `Count()`:

```go
func (l *ClickHouseCandleLoader) Count() (int64, error) {
    var count uint64
    row := l.conn.QueryRow(l.ctx,
        `SELECT count(*) FROM ohlcv WHERE symbol = ? AND timestamp >= ? AND timestamp < ?`,
        l.symbol, l.startTime, l.endTime,
    )
    if err := row.Scan(&count); err != nil {
        return 0, err
    }
    return int64(count), nil
}
```

**In `main.go`**: After creating `loader`, call `loader.Count()` before starting the progress ticker:

```go
totalCandles, err := loader.Count()
if err != nil {
    slog.Warn("could not determine candle count; progress percent will be approximate", "err", err)
    totalCandles = int64(orchConfig.EstimatedCandleCount)
}
```

Any mock `CandleLoader` in tests must also implement `Count()` — trivially returns `(len(candles), nil)`.

### CG-5: Progress Goroutine in `main.go`

```go
type progressState struct {
    processedCandles atomic.Int64
    lastTickCandles  atomic.Int64
    totalCandles     int64       // immutable after init
    mu               sync.Mutex  // guards currentDate, currentPrice, realizedPnl
    currentDate      time.Time
    currentPrice     decimal.Decimal
    realizedPnl      decimal.Decimal
}

func startProgressTicker(ctx context.Context, state *progressState, intervalMs int, out io.Writer) {
    ticker := time.NewTicker(time.Duration(intervalMs) * time.Millisecond)
    enc := json.NewEncoder(out)
    go func() {
        var lastTickTime = time.Now()
        for {
            select {
            case t := <-ticker.C:
                elapsed := t.Sub(lastTickTime).Seconds()
                processed := state.processedCandles.Load()
                lastProcessed := state.lastTickCandles.Swap(processed)
                cps := int64(0)
                if elapsed > 0 {
                    cps = int64(float64(processed-lastProcessed) / elapsed)
                }
                pct := 0.0
                if state.totalCandles > 0 {
                    pct = math.Min(99.0, float64(processed)/float64(state.totalCandles)*100.0)
                }
                state.mu.Lock()
                pkt := ProgressPayload{
                    Type:             "progress",
                    Percent:          pct,
                    CurrentDate:      state.currentDate.UTC().Format(time.RFC3339),
                    ProcessedCandles: processed,
                    TotalCandles:     state.totalCandles,
                    CurrentPrice:     state.currentPrice.InexactFloat64(),
                    RealizedPnl:      state.realizedPnl.InexactFloat64(),
                    CandlesPerSecond: cps,
                }
                state.mu.Unlock()
                lastTickTime = t
                _ = enc.Encode(pkt) // json.Encoder appends \n automatically
            case <-ctx.Done():
                ticker.Stop()
                return
            }
        }
    }()
}
```

**Hot loop integration** — in `orchestrator.go`'s `RunBacktest` (called via the orchestrator config's `ProgressCallback`):

The cleanest approach is to pass the `progressState` through `OrchestratorConfig.ProgressCallback`:

```go
// In OrchestratorConfig (already exists):
ProgressCallback func(candleIdx int, eventCount int) error

// In main.go, set it:
orchConfig.ProgressCallback = func(idx int, _ int) error {
    state.processedCandles.Store(int64(idx + 1))
    state.mu.Lock()
    state.currentDate = lastCandleTimestamp  // set by caller context
    state.currentPrice = lastCandleClose
    state.mu.Unlock()
    return nil
}
```

Since `ProgressCallback` is already in `OrchestratorConfig` but not currently called, we wire it into the hot loop. Alternatively, `progressState` is passed directly into `RunBacktest` via extended config — but using the existing callback avoids adding new parameters to the public `OrchestratorConfig` API.

**realizedPnl update** — in the event-processing section of `RunBacktest`, after each `PositionClosed` event is appended to the bus, update realizedPnl in the state. This requires passing `state` into `RunBacktest`, OR reading it from the PositionClosed event data during the aggregation post-pass and keeping a running total separately. The cleanest approach: maintain a `runningRealizedPnl decimal.Decimal` local var in the main function's goroutine (updated in the progress callback) rather than inside the clean orchestrator domain.

**Actual implementation**: The progress state updates happen in `main.go`'s callback that the orchestrator calls, not inside `orchestrator.go` itself.

### CG-6: In-Go Aggregation (`core-engine/cmd/engine/aggregator.go`)

New file. Three public functions:

#### aggregateBacktestEvents(events []orchestrator.Event, accountBalance decimal.Decimal) → aggregationResult

```go
type aggregationResult struct {
    PnlSummary       PnlSummaryOutput
    SafetyOrderCounts map[int]int   // internal; converted to []SafetyOrderUsageEntry in caller
    TotalFills       int
}

func aggregateBacktestEvents(events []orchestrator.Event, accountBalance decimal.Decimal) aggregationResult {
    var entryFees, tradingFees, realizedPnl decimal.Decimal
    var peakEquity, maxDrawdown decimal.Decimal
    safetyCounts := make(map[int]int)
    runningPnl := decimal.Zero

    for _, ev := range events {
        d := ev.Data
        switch ev.Type {
        case orchestrator.EventTypePositionOpened:
            if poe, ok := d.(*position.TradeOpenedEvent); ok {
                entryFees = entryFees.Add(decimal.RequireFromString(poe.EntryFee))
            }
        case orchestrator.EventTypeBuyOrderExecuted:
            if boe, ok := d.(*position.BuyOrderExecutedEvent); ok {
                tradingFees = tradingFees.Add(decimal.RequireFromString(boe.Fee))
                soIndex := boe.OrderNumber - 1
                safetyCounts[soIndex]++
            }
        case orchestrator.EventType("SellOrderExecuted"):
            if soe, ok := d.(*position.SellOrderExecutedEvent); ok {
                tradingFees = tradingFees.Add(decimal.RequireFromString(soe.Fee))
            }
        case orchestrator.EventTypePositionClosed:
            if pce, ok := d.(*position.TradeClosedEvent); ok {
                profit := decimal.RequireFromString(pce.Profit)
                realizedPnl = realizedPnl.Add(profit)
                runningPnl = runningPnl.Add(profit)
                equity := accountBalance.Add(runningPnl)
                if equity.GreaterThan(peakEquity) {
                    peakEquity = equity
                }
                if peakEquity.IsPositive() {
                    drawdown := peakEquity.Sub(equity).Div(peakEquity).Mul(decimal.NewFromInt(100))
                    if drawdown.GreaterThan(maxDrawdown) {
                        maxDrawdown = drawdown
                    }
                }
            }
        }
    }

    totalFees := entryFees.Add(tradingFees)
    roi := decimal.Zero
    if accountBalance.IsPositive() {
        roi = realizedPnl.Div(accountBalance).Mul(decimal.NewFromInt(100))
    }

    return aggregationResult{
        PnlSummary: PnlSummaryOutput{
            Roi:         roi.InexactFloat64(),
            MaxDrawdown: maxDrawdown.InexactFloat64(),
            TotalFees:   totalFees.InexactFloat64(),
        },
        SafetyOrderCounts: safetyCounts,
    }
}
```

> **Precision note**: All arithmetic uses `decimal.Decimal`. `InexactFloat64()` is called only when constructing the output structs — never mid-calculation.

#### buildTradeEvents(events []orchestrator.Event) → []TradeEventOutput

Ports `processGoEventsForFrontend` from `BackgroundWorker.ts:48`. Logic maintained identically:
- Trade ID counter increments on each `PositionOpened`
- `SellOrderExecuted` patches the fee of the last emitted EXIT event, then continues (not emitted)
- Only `PositionOpened`, `BuyOrderExecuted`, `PositionClosed` produce output entries

Key implementation note: since this function holds a pointer to the last EXIT event for fee-patching, and the `SellOrderExecuted` always immediately follows `PositionClosed` in the event stream, the patching is straightforward.

#### buildSafetyOrderUsage(counts map[int]int) → []SafetyOrderUsageEntry

Sorts map keys ascending, converts to sorted slice of `SafetyOrderUsageEntry{Level: strconv.Itoa(k+1), Count: v}`.

### CG-7: Replace BacktestOutput with EngineResultPayload in `main.go`

Old `convertBacktestToOutput` function and `BacktestOutput` struct are deleted. Replaced by the new pipeline in `main.go`:

```go
// After RunBacktest:
cancelTicker() // stop progress goroutine
time.Sleep(time.Duration(*progressIntervalMs) * time.Millisecond) // drain in-flight tick

allEvents := backtest.EventBus.GetAllEvents()
aggResult := aggregateBacktestEvents(allEvents, cfg.AccountBalance())
tradeEvents := buildTradeEvents(allEvents)
soUsage := buildSafetyOrderUsage(aggResult.SafetyOrderCounts)

payload := EngineResultPayload{
    Type:             "result",
    PnlSummary:       aggResult.PnlSummary,
    TradeEvents:      tradeEvents,
    SafetyOrderUsage: soUsage,
    ExecutionTimeMs:  backtest.EndTime.Sub(backtest.StartTime).Milliseconds(),
    CandleCount:      backtest.CandleCount,
    EventCount:       backtest.EventCount,
}
if err := json.NewEncoder(os.Stdout).Encode(payload); err != nil {
    fmt.Fprintf(os.Stderr, "Failed to write result: %v\n", err)
    os.Exit(1)
}
```

`json.Encoder.Encode` appends `\n` automatically, satisfying the NDJSON protocol.

### CG-8: BacktestService readline refactor (`orchestrator/api/src/services/BacktestService.ts`)

Replace the `stdoutBuffer` buffer pattern in `executeInternal()`:

**Delete these lines**:
```typescript
let stdoutBuffer = '';
child.stdout.on('data', (data: Buffer) => {
  stdoutBuffer += data.toString();
});
```

**Replace with**:
```typescript
import readline from 'readline';

let resultLine: EngineResultLine | null = null;
let resultReceived = false;

const rl = readline.createInterface({
  input: child.stdout!,
  crlfDelay: Infinity,
  terminal: false,
});

rl.on('line', (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed) as { type: string };
    if (parsed.type === 'progress' && options?.progressHandler) {
      void options.progressHandler(parsed as ProgressLine).catch((e) => {
        // Fire-and-forget: error in progress handler must not crash execution
        console.warn('[BacktestService] progressHandler error:', e);
      });
    } else if (parsed.type === 'result') {
      resultLine = parsed as EngineResultLine;
      resultReceived = true;
    }
    // Unknown types silently discarded (FR-028)
  } catch {
    console.warn('[BacktestService] non-JSON stdout line discarded');
  }
});
```

**Replace the on-exit success handler** (old `JSON.parse(trimmed)` blob logic):
```typescript
child.on('exit', (exitCode, signal) => {
  clearTimeouts();
  rl.close();
  const executionTimeMs = Math.round(performance.now() - startTime);

  if (exitCode === 0 && resultReceived && resultLine) {
    resolve(mapResultLine(resultLine));
    return;
  }
  if (!resultReceived) {
    reject(new ProcessError(
      `Engine exited without result line (code=${exitCode})`,
      exitCode, signal, stderr,
    ));
    return;
  }
  reject(new ProcessError(`Engine exited non-zero`, exitCode, signal, stderr));
});
```

**Add `execute()` overload param**:
```typescript
async execute(
  request: ApiBacktestRequest & ClickhouseCredentials,
  options?: BacktestExecuteOptions,
): Promise<BacktestExecutionResult>
```

Pass `options` through `executeInternal`, which stores `progressHandler` as a local closure variable for the promise's duration.

**Engine flags**: Modify the spawn args to include:
```typescript
const engineArgs = [
  '--log-level',            process.env.ENGINE_LOG_LEVEL ?? 'INFO',
  '--progress-interval-ms', process.env.ENGINE_PROGRESS_INTERVAL_MS ?? '250',
  ...flags,
];
```

### CG-9: BackgroundWorker update

```typescript
// In processJob(), REMOVE:
//   const summary = await this.aggregator.aggregateGoEvents(execResult.events, accountBalance);
//   const processedTrades = processGoEventsForFrontend(execResult.events);

// REPLACE service.execute() call with:
const claimStartTime = Date.now();
const execResult = await this.service.execute({
  ...config,
  clickhouse_addr: chAddr,
  // ...
}, {
  progressHandler: async (line: ProgressLine) => {
    await this.repo.updateProgress(id, line.percent, line);
  },
});

// REPLACE markCompleted call:
await this.repo.markCompleted(
  id,
  execResult.pnlSummary,
  execResult.tradeEvents,
  execResult.safetyOrderUsage,
  Date.now() - claimStartTime,   // worker wall-clock time
);
```

`ResultAggregator` can be retained in `BackgroundWorker` constructor (for legacy/mock paths) but no longer needs to be called for the Go engine path.

### CG-10: Drizzle Schema + Migration

**New migration file** (generated via `npm run db:generate`):

```sql
-- 0002_go_engine_io_optimization.sql
ALTER TABLE "backtests" ADD COLUMN "progress" integer NOT NULL DEFAULT 0;
ALTER TABLE "backtests" ADD COLUMN "current_metrics" jsonb;
```

**`schema.ts` diff**:
```typescript
// Add to import:
import type { StoredPnlSummary, StoredTradeEvent, ProgressLine } from '../types/index.js';

// Add to backtests table definition:
progress:       integer('progress').notNull().default(0),
currentMetrics: jsonb('current_metrics').$type<ProgressLine | null>(),
```

**`BacktestJobRepository` additions**:

1. New `updateProgress()` method (see data-model.md for full implementation)
2. Update `claimNext()` raw SQL result mapping to include the two new columns
3. Update `BacktestRow` type inference (automatic via Drizzle `$inferSelect`)

### CG-11: Backtest Routes Status Endpoint

Confirm `GET /backtests/:id/status` exposes the `progress` field in its response. If the status handler currently returns a subset of columns from `findById()`, ensure `progress` is included.

## Data Structures & JSON Tag Alignment

> Full struct definitions are in [data-model.md](data-model.md). This section highlights the critical alignment requirements.

### JSON Tag Audit

| Go struct field | Go JSON tag | TypeScript interface field | Type |
|---|---|---|---|
| `EngineResultPayload.PnlSummary` | `"pnlSummary"` | `BacktestResultLine.pnlSummary` | camelCase |
| `EngineResultPayload.TradeEvents` | `"tradeEvents"` | `BacktestResultLine.tradeEvents` | camelCase |
| `EngineResultPayload.SafetyOrderUsage` | `"safetyOrderUsage"` | `BacktestResultLine.safetyOrderUsage` | camelCase |
| `EngineResultPayload.ExecutionTimeMs` | `"executionTimeMs"` | `BacktestResultLine.executionTimeMs` | camelCase |
| `EngineResultPayload.CandleCount` | `"candleCount"` | `BacktestResultLine.candleCount` | camelCase |
| `EngineResultPayload.EventCount` | `"eventCount"` | `BacktestResultLine.eventCount` | camelCase |
| `PnlSummaryOutput.Roi` | `"roi"` | `StoredPnlSummary.roi` | lowercase |
| `PnlSummaryOutput.MaxDrawdown` | `"maxDrawdown"` | `StoredPnlSummary.maxDrawdown` | **camelCase — critical** |
| `PnlSummaryOutput.TotalFees` | `"totalFees"` | `StoredPnlSummary.totalFees` | **camelCase — critical** |
| `TradeEventOutput.Timestamp` | `"timestamp"` | `StoredTradeEvent.timestamp` | lowercase |
| `TradeEventOutput.RawTimestamp` | `"rawTimestamp"` | `StoredTradeEvent.rawTimestamp` | camelCase |
| `TradeEventOutput.EventType` | `"eventType"` | `StoredTradeEvent.eventType` | camelCase |
| `TradeEventOutput.TradeID` | `"trade_id"` | `StoredTradeEvent.trade_id` | **snake_case — exception** |
| `SafetyOrderUsageEntry.Level` | `"level"` | `SafetyOrderUsageEntry.level` | lowercase |
| `SafetyOrderUsageEntry.Count` | `"count"` | `SafetyOrderUsageEntry.count` | lowercase |
| `ProgressPayload.CandlesPerSecond` | `"candles_per_second"` | `ProgressLine.candles_per_second` | snake_case |
| `ProgressPayload.CurrentDate` | `"current_date"` | `ProgressLine.current_date` | snake_case |
| `ProgressPayload.ProcessedCandles` | `"processed_candles"` | `ProgressLine.processed_candles` | snake_case |
| `ProgressPayload.TotalCandles` | `"total_candles"` | `ProgressLine.total_candles` | snake_case |
| `ProgressPayload.CurrentPrice` | `"current_price"` | `ProgressLine.current_price` | snake_case |
| `ProgressPayload.RealizedPnl` | `"realized_pnl"` | `ProgressLine.realized_pnl` | snake_case |

> Note the mixed casing: `EngineResultPayload` uses camelCase (matching the Postgres-stored domain), `ProgressPayload` uses snake_case (matching the real-time streaming domain). Both conventions are locked — changing either would break the respective consumer.

## Testing Strategy

### Go Tests (new, all in `core-engine/`)

| Test file | Test name | What it verifies |
|---|---|---|
| `cmd/engine/aggregator_test.go` | `TestAggregateBacktestEvents_RoiCalc` | ROI = realizedPnl / accountBalance × 100 with decimal.Decimal inputs |
| `cmd/engine/aggregator_test.go` | `TestAggregateBacktestEvents_MaxDrawdown` | Peak correctly tracked; drawdown correctly computed across multiple trades |
| `cmd/engine/aggregator_test.go` | `TestAggregateBacktestEvents_TotalFees` | entryFee + tradingFees + sellFees accumulated correctly |
| `cmd/engine/aggregator_test.go` | `TestAggregateBacktestEvents_SafetyOrderCounts` | soIndex = orderNumber - 1; counts increment correctly |
| `cmd/engine/aggregator_test.go` | `TestBuildTradeEvents_EntryAndSafetyOrder` | ENTRY and SAFETY_ORDER events mapped with correct price/qty/balance |
| `cmd/engine/aggregator_test.go` | `TestBuildTradeEvents_ExitFeePatchedFromSellOrder` | EXIT.fee is patched from next SellOrderExecuted |
| `cmd/engine/aggregator_test.go` | `TestBuildTradeEvents_MultipleTradesSequentialIds` | trade_id "1", "2", "3"... per PositionOpened |
| `cmd/engine/aggregator_test.go` | `TestBuildSafetyOrderUsage_SortedAscending` | levels appear as "1","2",... sorted |
| `cmd/engine/main_test.go` | `TestLogLevelFlag_InfoProducesNoDebugOnStderr` | Running at INFO: stderr empty for clean backtest |
| `cmd/engine/main_test.go` | `TestLogLevelFlag_DebugProducesEntriesOnStderr` | Running at DEBUG: stderr contains slog entries |
| `cmd/engine/main_test.go` | `TestProgressIntervalMs_ValidInterval_TicksFire` | Progress lines appear on stdout at ~250ms intervals |
| `cmd/engine/main_test.go` | `TestProgressIntervalMs_InvalidZero_DefaultsTo250` | WARN emitted; defaulting behavior |
| `application/orchestrator/orchestrator_test.go` | existing tests | Must all remain green after debug print removal |

### TypeScript Tests (new/modified, all in `orchestrator/api/`)

| File | Test | What it verifies |
|---|---|---|
| `src/services/BacktestService.test.ts` | `progress lines invoke progressHandler` | Mock process emits 2 progress lines; handler called twice |
| `src/services/BacktestService.test.ts` | `result line resolves with BacktestExecutionResult` | Result line mapped correctly to interface |
| `src/services/BacktestService.test.ts` | `non-JSON stdout line discarded without crash` | Service doesn't throw; result still received |
| `src/services/BacktestService.test.ts` | `exit without result line rejects with ProcessError` | Correct error type and message |
| `src/services/BacktestJobRepository.test.ts` | `updateProgress writes progress and current_metrics` | DB update with floored percent |
| `src/services/BacktestJobRepository.test.ts` | `claimNext includes progress and currentMetrics fields` | camelCase mapping correct |
| `src/services/BackgroundWorker.test.ts` | `processJob passes progressHandler to service` | Spy confirms handler passed through |
| `src/services/BackgroundWorker.test.ts` | `processJob calls markCompleted with result data` | Direct result passthrough (no aggregator) |
| `src/integration/` | existing integration tests | Must all remain green |

### Fixture Update Required: Mock Binary

The mock engine binary used in integration tests currently emits the old `{events, final_position, execution_time_ms}` JSON blob. It must be updated to emit:
1. 2–3 `{"type":"progress",...}` lines (can be minimal/placeholder values)
2. 1 `{"type":"result",...}` line with the new payload structure

## Drizzle Schema Verification

| Column | Type | Migration | Status |
|---|---|---|---|
| `execution_time_ms` | `integer` | `0001_dry_human_fly.sql` | ✅ EXISTS |
| `progress` | `integer NOT NULL DEFAULT 0` | `0002_*.sql` (new) | ❌ TO ADD |
| `current_metrics` | `jsonb` | `0002_*.sql` (new) | ❌ TO ADD |

## Complexity Tracking

| Change | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| `time.Ticker` goroutine with `sync/atomic` | Progress reporting requires concurrent read/write without hot-loop mutex contention | Single goroutine with channel: adds allocation per candle; polling every N candles: interval is count-based not time-based (erratic for variable throughput) |
| `readline` in BacktestService | Stream the final result and progress lines simultaneously without buffer limits | Buffer all stdout then parse on exit: progress updates would only appear post-mortem; large payloads can OOM |
| In-Go aggregation (`aggregator.go`) | Eliminate the duplicated TypeScript aggregation pipeline that must stay in sync with Go event schema | Keep Node.js aggregation: creates a stable two-language schema sync burden; every new event type must be handled in both languages |
| Pre-flight ClickHouse COUNT query | Accurate `percent` in progress ticks | `EstimatedCandleCount = 10000` in OrchestratorConfig is a hardcoded constant; would cap progress at 99 before 1% of candles are processed on any real backtest |
