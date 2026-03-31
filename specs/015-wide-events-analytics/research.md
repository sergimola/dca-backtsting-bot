# Research: Wide Events Analytics Engine

**Feature**: 015-wide-events-analytics  
**Date**: 2026-03-31  
**Status**: Complete — all NEEDS CLARIFICATION resolved

---

## Decision 1: Go Decimal JSON Serialization

**Decision**: Use plain `json:"field_name"` struct tags on all `decimal.Decimal` fields. No `,string` modifier needed.

**Rationale**: `shopspring/decimal` implements `json.Marshaler`. Its `MarshalJSON()` already produces quoted strings by default (e.g., `"49.09800000"`). The package-level flag `decimal.MarshalJSONWithoutQuotes` defaults to `false`. The `,string` struct tag modifier is silently ignored by `encoding/json` for types implementing `json.Marshaler`, and causes double-quoting bugs with `json-iterator`.

**Alternatives considered**:
- `json:",string"` — rejected: no-op on decimal, harmful on json-iterator
- Global flag `MarshalJSONWithoutQuotes = true` — rejected: produces unsafe floats
- Custom `MarshalJSON` per struct — rejected: unnecessary overhead; default already correct

**Fixed precision**: Use `decimal.Decimal.StringFixed(8)` when consistent 8dp output is required (e.g., in the default value sentinel `"0.00000000"`). Default marshaling calls `d.String()` which omits trailing zeros. The plan opts for a lightweight wrapper type `WideDecimal` using `StringFixed(8)` to guarantee uniform precision in all JSONL output fields.

---

## Decision 2: bufio.Writer Configuration

**Decision**: Use `bufio.NewWriterSize(file, 256*1024)` (256 KiB buffer) for the JSONL writer. Flush explicitly before Close.

**Rationale**:
- Default `bufio.NewWriter` is 4 KiB — too small for high-throughput JSONL line writes. Each WideEvent JSON object is approximately 600–800 bytes; a 4 KiB buffer would syscall every 5–6 events. A 256 KiB buffer amortizes syscall cost across ~350 events per flush.
- `os.File.Close()` does NOT flush `bufio.Writer` — they are independent. Explicit `bw.Flush()` before `file.Close()` is mandatory.
- `bufio.Writer` records the first write error as a sticky error; checking `Flush()` once at shutdown is sufficient to detect any prior failure during the run.

**Shutdown sequence** (MANDATORY ORDER — never deviate):
1. `close(ch)` — signal worker goroutine to drain
2. `<-done` — wait for worker goroutine to finish
3. `bw.Flush()` — flush remaining bytes from writer buffer to OS
4. `file.Sync()` (optional, for fsync durability)
5. `file.Close()` — release file descriptor

---

## Decision 3: Channel Buffer Size and Back-Pressure Strategy

**Decision**: `make(chan WideEvent, 65536)` — lossless bounded buffer. Worker goroutine blockingly reads. PSM loop sends with `ch <- event` (blocking send), which provides natural back-pressure when buffer is full.

**Rationale**:
- Normal simulation throughput: the PSM processes candles sequentially; market data candles are read from ClickHouse and each processed in microseconds. The writer goroutine serializes to `bufio.Writer` (memory-only under normal conditions) at a rate faster than the simulation loop produces events.
- Back-pressure condition: occurs only if `bufio.Flush()` is delayed by actual disk I/O (the buffer is full, triggering a syscall). In pathological cases (disk I/O stall), the send blocks the PSM loop for the duration of the stall — this is the correct behavior per FR-008 (lossless guarantee).
- A blocking send (`ch <- event`, not `select { case ch <- event: default: drop }`) is the simplest and most correct pattern for a lossless guarantee.
- Back-pressure duration is exposed in the final run summary (FR-012) via measuring time blocked on the channel send.

**Alternatives considered**:
- `select { case ch <- event: default: counter++ }` (non-blocking drop) — rejected: loss-tolerant, violates FR-008
- Unbounded slice buffer — rejected: unbounded memory growth for multi-year runs (500K+ events × ~1 KB = ~500 MB)
- Separate goroutine per event — rejected: goroutine spawn overhead per event on the hot-path

---

## Decision 4: WideEvent Struct — No Pointer Fields

**Decision**: All WideEvent fields use value types (no pointer types). Absence of a position uses the empty-string / `"0"` sentinel pattern specified in FR-013. JSON null is prohibited.

**Rationale**: Pointer fields in a Go struct serialize as JSON `null` when nil. FR-013 explicitly prohibits JSON null to allow ClickHouse non-nullable column types. Using value types with sentinel defaults eliminates this risk structurally — a `decimal.Decimal` zero value marshals as `"0"`, a `string` zero value marshals as `""`.

**Default value contract**:
- `trade_id` when no position: `""` (empty string)
- All numeric position/analytics fields when no position: `decimal.Zero` → serializes as `"0"` by default  
- For 8dp precision: use `WideDecimal` wrapper → serializes as `"0.00000000"`
- `close_reason` when not a close event: `""` (empty string)
- `order_number` when not a fill event: `0` (integer zero, not decimal)

---

## Decision 5: Node.js ClickHouse Ingestion Pattern

**Decision**: Use the existing `@clickhouse/client` HTTP client (already wired in `ClickHouseClient.ts`). Issue `ALTER TABLE wide_events DROP PARTITION '{run_id}'` via `chClient.command()`, then stream the JSONL file using `chClient.insert()` with a Node.js `fs.createReadStream()`.

**Rationale**:
- The codebase already uses `@clickhouse/client` (HTTP, port 8123). The Go engine uses the native TCP driver (port 9000). Staying on the HTTP client for Node.js avoids adding a second client library.
- `chClient.command()` issues DDL statements (including `ALTER TABLE ... DROP PARTITION`). This is the correct API for the partition-drop idempotency operation.
- `@clickhouse/client` `insert()` accepts a `ReadableStream` or `Readable` (Node.js Streams API). `fs.createReadStream(filePath)` produces a Readable. The format `JSONEachRow` is already in use in the codebase (`ClickHouseWriter.ts`). This is the streaming bulk insert pattern — the file is never fully loaded into memory.
- `INSERT FROM INFILE` is a ClickHouse-local (CLI) feature not available via the HTTP client. The streaming `insert()` is the correct HTTP equivalent and achieves the same bulk performance.

**Alternatives considered**:
- `clickhouse-go` native client from Node.js side — rejected: wrong language
- `INSERT FROM INFILE` via HTTP — rejected: not supported on HTTP interface, only in clickhouse-local CLI
- Loading entire JSONL into memory and calling `insertBatch(rows)` — rejected: unbounded memory for 500K+ events

---

## Decision 6: File Path Convention

**Decision**: The Go engine writes the JSONL file to `{output_dir}/{run_id}.jsonl`. The `output_dir` is passed as a CLI flag or `OrchestratorConfig` field, defaulting to `./output/wide_events/`. The Node.js wrapper receives the file path via stdout JSON (same pattern used by existing engine output parsing).

**Rationale**: The existing `cmd/engine` binary writes results as structured JSON to stdout. Adding the JSONL file path to the stdout result object is the minimal integration point — the Node.js caller already parses this JSON (see `engine-mapping.integration.test.ts`). No new IPC mechanism needed.

---

## Decision 7: WideEvent Enricher Placement

**Decision**: The `WideEventEnricher` is a new file in `core-engine/application/orchestrator/` (e.g., `wide_event_enricher.go`). It is initialized in `NewOrchestrator()` and held as a field on `Orchestrator`. The PSM loop calls a new `orch.emitWideEvent(candle, psmEvents)` helper after each candle's PSM events are processed.

**Rationale**: The orchestrator package already contains all the state needed for enrichment: `orch.position`, `orch.runningBalance`, `orch.globalCandleCount`, and the raw candle. Placing the enricher here avoids any domain pollution (the core `domain/position` package stays pure). The enricher is infrastructure (I/O-producing adapter), not domain — this placement is correct per Clean Architecture and the project constitution.

**Alternatives considered**:
- Placing enricher in `domain/position` — rejected: domain must have zero I/O dependencies (constitution)
- Placing enricher in a new `infrastructure/` package — rejected: premature abstraction; the orchestrator package is already the app-layer adapter boundary
