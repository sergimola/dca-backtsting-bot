# Research: Optimizer Workspace (016)

**Branch**: `016-optimizer-workspace` | **Date**: 2026-04-01

---

## R-001: Pre-Flight Math — Ladder Algorithm

**Decision**: Reuse existing `domain/config` sequences API (`ComputePriceSequence`, `ComputeAmountSequence`) for Pre-Flight ladder calculation — no new math code required.

**Rationale**: `sequences.go` already implements the SDD §2.1/§2.2 recurrences with `decimal.Decimal` (ROUND_HALF_UP, 8dp) and canonical test coverage. Pre-Flight needs only to drive these functions with a normalized $100 entry price and sum the resulting amount sequence.

**Key facts discovered**:
- `ComputePriceSequence(currentPrice)` returns `[]decimal.Decimal` price levels P_0…P_{N-1}. For Pre-Flight, pass `currentPrice = decimal.NewFromInt(100)` (normalized $100 entry).
- `ComputeAmountSequence(dynamicBalance)` returns USDT order sizes. For Pre-Flight, pass `dynamicBalance = amountPerTrade` (absolute USDT mode; when `amountPerTrade > 1.0` the function already treats it as absolute).
- `max_drawdown_covered_pct = (P_{N-1} - P_0) / P_0 * 100` — the deepest safety-order price as a % from entry. This is always negative (price dropped) for N > 0.
- `total_capital_required = sum(A_0…A_{N-1})` — sum of all safety-order USDT amounts.

**Alternatives considered**:
- Re-implementing the ladder from scratch in a dedicated Pre-Flight package → rejected: would duplicate tested math and create a divergence risk.
- Calling sequences from the orchestrator (Node.js) → rejected: constitution forbids monetary re-computation outside Go domain.

---

## R-002: Pre-Flight CLI Interface

**Decision**: Add a `--preflight` flag to the existing `cmd/engine/main.go` dispatch. Engine reads config JSON from stdin and writes a single Pre-Flight result JSON to stdout. For batch mode add `--batch-preflight <json-array>` that accepts a JSON file path; engine returns a JSON array of results.

**Rationale**: Consistent with the existing pattern. The engine already reads JSON from stdin and writes NDJSON to stdout. Batch Pre-Flight extends this without architectural changes to how the Node.js service spawns the binary.

**Flag dispatch table** (new routing logic in `main.go`):

| Flags Present | Mode | stdin | stdout |
|---------------|------|-------|--------|
| *(none)* | Single backtest (existing) | `EngineRequest` JSON | NDJSON progress + result |
| `--preflight` | Single Pre-Flight | `EngineRequest` JSON | `PreFlightResult` JSON |
| `--batch-config <path>` | Batch backtest (new) | *(unused)* | NDJSON result per run, tagged `run_id` |
| `--batch-preflight <path>` | Batch Pre-Flight (new) | *(unused)* | `BatchPreFlightResult` JSON array |

**Alternatives considered**:
- Subcommand model (`engine preflight`, `engine batch`) → rejected: the existing codebase uses flags from `flag` package; adding `cobra` would be a significant dependency change for modest gain.

---

## R-003: Batch Execution Grouping & Worker Pool

**Decision**: Group configs by `(symbol, start_date, end_date)` tuple using a `map[string][]BatchRunConfig`. Spawn one ClickHouse loading goroutine per group sequentially before launching the worker pool. Pass a `[]Candle` slice (loaded by `clickhouse_loader.go`) as a read-only value to workers.

**Rationale**: `clickhouse_loader.go` in `core-engine/application/orchestrator/` streams candle rows. For the batch case we need to materialize all candles into a `[]Candle` slice first (one allocation per group), then share that slice across workers by value (Go slice headers are cheap copies; the underlying array is shared read-only). This requires a new `LoadAll() ([]Candle, error)` method on the loader or a new `LoadCandlesForGroup` function.

**Worker pool pattern** (standard Go):
```go
jobs := make(chan BatchJob, len(configs))
results := make(chan BatchJobResult, len(configs))
wg := sync.WaitGroup{}
for i := 0; i < runtime.NumCPU(); i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for job := range jobs {
            result := runSingleBacktest(job.Config, job.Candles) // fresh Orchestrator + PSM per call
            results <- result
        }
    }()
}
```

**Execution State Isolation**: `runSingleBacktest` creates `position.NewStateMachine()` and `orchestrator.NewOrchestrator(psm, ...)` fresh per call. These are stack-local; zero sharing with other goroutines. Only `job.Candles` (a `[]Candle` slice header) is shared, and the underlying array is read-only after group load.

**stdout safety**: Worker results are funneled through the `results` channel and consumed by a single result-writer goroutine that serializes JSON output to stdout — no concurrent stdout.Write calls.

**Candle type**: Needs a new `Candle` struct in `application/orchestrator` (or reuse the existing anonymous struct from `clickhouse_loader.go`) and a `LoadAll() ([]Candle, error)` method.

**Alternatives considered**:
- Streaming candles directly to each worker via separate channels → rejected: would require N ClickHouse queries — the entire point of this feature is 1 query per group.
- `sync.Mutex` on candle slice reads → rejected: unnecessary overhead; Go slice reads are concurrency-safe when no goroutine writes.

---

## R-004: Node.js Cartesian Product & Batch Pre-Flight Pipeline

**Decision**: Implement as a new Express route (`POST /optimizer/sweep`) with three sequential steps: (1) O(k) size check, (2) Cartesian expansion, (3) single `--batch-preflight` invocation for pruning.

**Rationale**:
- **O(k) size check**: `const count = sweepDimensions.reduce((acc, d) => acc * d.values.length, 1)` — runs before any object allocation. Reject with 400 if `count > 10_000`.
- **Cartesian expansion**: Standard iterative `reduce` over arrays of dimension value-lists. TypeScript has no risk of stack overflow with iterative Cartesian; recursive is only needed for 100k+ which is already rejected.
- **Batch Pre-Flight**: Spawn engine once with `--batch-preflight <tmpfile>`. Parse the returned JSON array (one `PreFlightResult` per config). Filter configs where `totalCapitalRequired > accountBalance` or `baseOrderSize < EXCHANGE_MIN_ORDER` (= $10). Return pruning summary.
- **Streaming results**: A new `POST /optimizer/execute` endpoint spawns the engine with `--batch-config <tmpfile>` and SSE-streams NDJSON result lines directly to the frontend (reuses `BacktestService` readline pattern).

**Best practices for Cartesian product**:
```typescript
function cartesian<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap(combo => arr.map(val => [...combo, val])),
    [[]]
  );
}
```
This produces at most 10,000 arrays of ~15 elements; memory cost ≈ 10k × 15 × 8 bytes ≈ 1.2 MB — safe.

**Range expansion**: `start=1.0, end=2.0, step=0.5` → use `decimal.js` for step arithmetic (avoids float drift: `1.0 + 0.1 + 0.1 + 0.1 ≠ 1.3` in float64). Since this is presentation math (not monetary), `decimal.js` is appropriate in Node.js.

**Alternatives considered**:
- Lazy/generator-based Cartesian → deferred: premature optimization; the 10k cap makes eager allocation safe and simpler.
- Re-implementing Pre-Flight math in TypeScript → rejected: constitution violation.

---

## R-005: Frontend State Architecture

**Decision**: Single `OptimizerPage` component with a `useOptimizer` hook holding the session state machine. Right panel content is determined by a `sweepPhase: 'idle' | 'running' | 'complete' | 'cancelled'` discriminated union.

**Rationale**:
- Reuse existing `BacktestService`-like SSE pattern: `EventSource` or `fetch` with `ReadableStream` to stream batch results. Each `{"type":"result","run_id":"...","pnlSummary":{...}}` line appended to a growing `results[]` array that drives the Leaderboard.
- Pre-Flight Visualizer: use existing `SafetyOrderChart.tsx` as a base; extend to render min/max ladder bands as an overlay zone rather than a single ladder.
- Heatmap: implement as a pure SVG grid component (no extra charting lib dependency needed for a 2D colored grid); cells are `<rect>` elements with `fill` computed from a linear PnL-to-RGB interpolation.
- Leaderboard: reuse column-sorting pattern from existing `TradeEventsTable.tsx`.

**Key decisions**:
- CSV export: `papaparse` (already used in project) to serialize the results array.
- Fixed/Sweep toggle: controlled inputs with a `mode: 'fixed' | 'sweep'` field per parameter in form state.
- Range popover: `Popover` from Headless UI (already used in project), containing three numeric inputs.
- Footer combinatorial math: computed live from form state via `useMemo`; calls `POST /optimizer/sweep/count` (lightweight endpoint returning only `{generated, pruned, valid}` without building all configs).

**Alternatives considered**:
- Redux/Zustand for optimizer state → rejected: a single page's local state is sufficient; custom hook is simpler.
- Recharts for Heatmap → rejected: Recharts doesn't have a native 2D heatmap; custom SVG is ~50 lines and zero dep.

---

## R-006: Temp File Strategy for Batch Config & Pre-Flight Files

**Decision**: Use Node.js `os.tmpdir()` to create uniquely named temporary JSON files for `--batch-config` and `--batch-preflight` inputs. Clean up on process exit or request completion.

**Rationale**: The Go engine reads batch config from a file path (not stdin) to avoid buffering limitations with large JSON arrays. Node.js writes the temp file, passes the path via flag, and deletes it after the engine exits. Use `randomUUID()` in the filename to prevent collisions.

**Security note**: Temp files contain config parameters (no credentials beyond ClickHouse connection info which is already trusted server-side). Files are deleted immediately after the subprocess exits.

---

## R-007: Streaming Results — SSE vs WebSocket

**Decision**: Server-Sent Events (SSE via `text/event-stream`) for streaming batch results to the frontend.

**Rationale**: SSE is unidirectional (server → client), which is all that's needed for streaming results. It works over HTTP/1.1 without a protocol upgrade, is natively supported by browsers, and is already used in the existing architecture. The frontend doesn't need to send data back during execution (only a cancel signal, handled via a separate `DELETE /optimizer/session/:id` endpoint).

**Alternatives considered**:
- WebSocket → rejected: bidirectional overkill; SSE is simpler and sufficient.
- Long polling → rejected: high latency between results, worse UX for the live Leaderboard.
