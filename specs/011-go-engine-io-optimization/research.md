# Research: Go Engine I/O Optimization

**Date**: 2026-03-15 | **Feature**: 011-go-engine-io-optimization | **Phase**: 0

---

## 1. Progress State Sharing Between Hot Loop and Ticker Goroutine

**Decision**: Use a hybrid of `sync/atomic` for high-frequency counters and a single `sync.Mutex`-guarded struct for low-frequency rich state.

**Rationale**: The hot loop increments the candle counter on every iteration — potentially 600,000 times/second. A mutex lock at that frequency would itself become a bottleneck. `sync/atomic.Int64` provides lock-free reads and writes. Rich state (`currentDate`, `currentPrice`, `realizedPnl`) only changes on position events (far less frequent), so a mutex there adds negligible overhead.

**Alternatives considered**:
- **Full mutex on all fields**: Simple but introduces lock contention proportional to candle throughput.
- **Channel-based snapshot passing**: Elegant but adds GC pressure from per-candle allocations; a buffered channel of size 1 with a non-blocking select would be needed to avoid head-of-line blocking, which adds complication.
- **Read-copy-update pointer swap**: Correct but complex; overkill for a single goroutine writer.

**Concrete struct design**:
```go
type progressState struct {
    processedCandles atomic.Int64  // Updated per-candle in hot loop
    lastTickCandles  atomic.Int64  // Swapped atomically each tick
    totalCandles     int64         // Immutable after pre-flight COUNT
    // Protected by mu — updated only on position events (~rare)
    mu           sync.Mutex
    currentDate  time.Time
    currentPrice decimal.Decimal
    realizedPnl  decimal.Decimal
}
```

---

## 2. Total Candle Count for Accurate Progress Percentage

**Decision**: Add a `Count() (int64, error)` method to the `CandleLoader` interface and implement it in `ClickHouseCandleLoader` as a pre-flight `SELECT count(*) FROM ohlcv WHERE symbol=... AND timestamp BETWEEN start AND end` issued before the streaming cursor opens.

**Rationale**: `EstimatedCandleCount` in `OrchestratorConfig` is currently hardcoded to `10000` — wildly wrong for multi-year datasets. An accurate count makes progress percentages meaningful. A ClickHouse COUNT on a time-range with an indexed `timestamp` column is typically sub-10ms.

**Alternatives considered**:
- **Use `EstimatedCandleCount` from config**: Already available; zero round-trip. Rejected because the value is hardcoded (`10000`) and would cap progress at 99% immediately on any real dataset.
- **Stream-length estimation from date range**: Compute `(end - start) / 60s` to estimate 1-minute candle count. Acceptable fallback if COUNT fails; plan should support this as a fallback.
- **No count — stream without percentage**: Show `processed_candles` and `total_candles: 0`. Rejected by spec (FR-012 requires `percent`).

**Fallback**: If `Count()` returns an error or 0, the engine falls back to `EstimatedCandleCount` from config. If still 0, `percent` is omitted (set to 0), and `total_candles` is reported as 0.

---

## 3. In-Go Aggregation — Porting TypeScript Logic to Go

**Decision**: Create a new file `core-engine/cmd/engine/aggregator.go` containing three functions ported from the TypeScript codebase.

**Source → destination mapping**:

| TypeScript source | Go destination | Notes |
|---|---|---|
| `ResultAggregator.aggregateGoEvents()` (ResultAggregator.ts:235) | `aggregateBacktestEvents()` in aggregator.go | Port the event-walk loop for fees, realized PnL, safety order counts |
| `processGoEventsForFrontend()` (BackgroundWorker.ts:48) | `buildTradeEvents()` in aggregator.go | Port the trade ID counter, event type mapping, fee patching |
| `BackgroundWorker` storedSummary construction (BackgroundWorker.ts:215) | `buildSafetyOrderUsage()` in aggregator.go | Sort map keys and emit as slice |

**Key precision note**: All intermediate aggregation uses `decimal.Decimal`. Only the final output struct fields (`Roi`, `MaxDrawdown`, `TotalFees`, `Price`, etc.) are converted to `float64` via `.InexactFloat64()` immediately before JSON serialization. No intermediate float64 computation occurs.

**Max drawdown algorithm**: Walk the accumulated realized PnL per-trade. Track `peakEquity = initialBalance + runningRealizedPnl` and `maxDrawdown = max(maxDrawdown, (peakEquity - runningEquity) / peakEquity * 100)`.

---

## 4. CLI Flag Parsing Before Stdin JSON Read

**Decision**: Use Go's standard `flag` package. Parse flags via `flag.Parse()` before `json.NewDecoder(os.Stdin).Decode(&request)`.

**Rationale**: The engine currently has no CLI flags — all config arrives via stdin JSON. The `flag` package handles `--log-level INFO` and `--progress-interval-ms 250` cleanly. `flag.Parse()` consumes only `os.Args[1:]`; stdin is unaffected.

**Alternatives considered**:
- **cobra/viper**: Feature-rich but heavyweight for two flags on a CLI that will likely remain simple.
- **Environment variables**: Cleaner in Docker but harder to pass per-job from BackgroundWorker without env mutation.
- **Embed flags in the stdin JSON body** (`"log_level": "INFO"`): Keeps stdin as the single config channel, but pollutes the engine request schema with operational concerns. Rejected.

**Flag validation**:
```
--log-level      string   Valid: DEBUG|INFO|WARN|ERROR  (case-insensitive). Default: INFO
--progress-interval-ms  int  Valid: >0. If 0 or negative: substitute 250, emit WARN slog.
```

---

## 5. Node.js Readline Streaming Strategy

**Decision**: Use Node.js built-in `readline.createInterface({ input: childProcess.stdout, crlfDelay: Infinity })` inside `BacktestService.executeInternal()`. Replace the `stdoutBuffer` string accumulation and the on-exit `JSON.parse(trimmed)` blob parser.

**Rationale**: `readline` splits the stdout stream at newline boundaries, handles partial chunk delivery transparently, and emits complete lines. It is part of the Node.js stdlib (no new dependencies). `crlfDelay: Infinity` prevents readline from treating `\r` inside large JSON values as a line break.

**Critical memory note**: The final result JSON can be several megabytes for long backtests (many thousands of trades). `readline` holds only the current line in memory — no full-buffer accumulation. This eliminates the potential for OOM on large payloads.

**Chunk-splitting guarantees**: TCP/pipe reads deliver data in arbitrary chunks. `readline` correctly accumulates chunks until it sees `\n`, then emits the complete line. Partial JSON objects are never emitted mid-object.

**Alternatives considered**:
- **`split2` npm package**: Functionally equivalent but adds a dependency.
- **Stay with buffer + parse on exit**: Simple but: (a) blocks progress updates until death, (b) the single `exec`-style buffer in `BacktestService` has a de-facto size limit that could OOM on large payloads, (c) makes real-time progress impossible.
- **Transform streams**: More control but more code; `readline` is the right tool for line-oriented protocols.

---

## 6. BacktestService Interface Evolution — Backward Compatibility

**Decision**: Add an optional `progressHandler?: (line: ProgressLine) => Promise<void>` parameter to the `execute()` and `executeWithStderr()` call signatures. Change the `BacktestExecutionResult` return type to match the new Go output schema. Update existing test fixtures to use the new return shape.

**Rationale**: `BacktestService` existing tests use the old `{events, finalPosition, executionTimeMs}` shape. Changing the return type requires updating those tests, but this is preferable to maintaining a dual-format parser indefinitely.

**Backward compatibility for non-JSON stdout lines**: Lines that fail `JSON.parse` are silently discarded (with WARN logging). This means the old ndjson format (legacy mock binary) will no longer be parsed correctly — but no production binary uses that format. The mock binary test fixture will need to be updated to emit the new `{"type":"result",...}` format.

**Approach for existing integration tests**: The engine integration tests that spawn the real binary will pass once the binary is updated. The `event-aggregation.integration.test.ts` tests use a mock binary. That mock binary needs updating to emit the new `{"type":"result",...}` JSON. The `BacktestService` unit tests need new fixture JSON in the new format.

---

## 7. Drizzle Schema Additions

**Decision**: Add two columns via a new Drizzle migration:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `progress` | `integer NOT NULL DEFAULT 0` | `0` | Real-time completion percentage 0–100; updated by BackgroundWorker on each progress line |
| `current_metrics` | `jsonb` | `NULL` | Last complete progress snapshot (full `ProgressLine` object); allows polling endpoint to return rich engine state |

**`execution_time_ms` (already exists)**: Added in migration `0001_dry_human_fly.sql` (`ALTER TABLE "backtests" ADD COLUMN "execution_time_ms" integer`). Present in `schema.ts`. No action needed. ✅

**`progress` — why integer not real**: The UI displays it as a percentage integer (0–100). Float precision (e.g., `45.22`) is only needed for the progress line JSON itself; when stored, flooring to integer is fine and matches FR-024 (`Math.floor(line.percent)`).

**`current_metrics` — security note**: This JSONB column is only written by the server-side BackgroundWorker and never sourced from user input. The engine emits it via a trusted internal process. It is read-only from the API consumer's perspective. No injection risk.

---

## 8. `slog` Handler Configuration and stderr-Only Constraint

**Decision**: Use `slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level})` rather than `slog.NewJSONHandler`. Text format is more readable in operator terminals and log aggregators. All output goes to `os.Stderr`; `os.Stdout` is reserved exclusively for the newline-delimited JSON protocol.

**Rationale for text over JSON for slog**: The JSON progress/result protocol on stdout already requires careful parsing. If slog also emitted JSON to stderr, an operator might confuse the two streams. Text handler is unambiguous.

**slog level guard**: The hot loop calls `slog.Debug(...)` which is a no-op when the level is INFO or higher — evaluated entirely in the slog handler before any string formatting occurs. This means there is zero string allocation overhead in the hot loop at INFO level.
