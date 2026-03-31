# Data Model: Wide Events Analytics Engine

**Feature**: 015-wide-events-analytics  
**Date**: 2026-03-31

---

## WideEvent (Go struct — output artifact)

The canonical Go struct for a single wide event record, placed in  
`core-engine/application/orchestrator/wide_event.go`.

All monetary and percentage fields are `WideDecimal` (a thin wrapper over `decimal.Decimal`  
that serializes with exactly 8 decimal places via `StringFixed(8)`).  
All string fields are plain `string` (empty string `""` as the no-data sentinel).  
Integer fields are `int` or `int64`. No pointer types are used anywhere.

```
WideEvent
├── Identity
│   ├── schema_version   int         // Always 1 for this spec version
│   ├── run_id           string      // FK to backtest_configs (BacktestRun.ID)
│   ├── trade_id         string      // Active TradeID; "" when no position is open
│   ├── timestamp        time.Time   // UTC candle timestamp (serializes as RFC3339 string)
│   ├── event_type       string      // "price_changed" | "order_filled" | "position_opened" | "position_closed"
│   └── symbol           string      // e.g. "BTCUSDC"
│
├── Market (snapshot of the triggering candle)
│   ├── candle_open      WideDecimal // candle.Open
│   ├── candle_high      WideDecimal // candle.High
│   ├── candle_low       WideDecimal // candle.Low
│   ├── candle_close     WideDecimal // candle.Close
│   └── candle_volume    WideDecimal // candle.Volume
│
├── Portfolio
│   ├── running_account_balance  WideDecimal // orch.runningBalance at event time
│   └── global_candle_count      int64       // orch.globalCandleCount at event time
│
├── Position (value when position active; sentinel defaults when no position)
│   ├── position_state        string      // "idle"|"active"|"closed"; "" when no position
│   ├── average_entry_price   WideDecimal // Position.AverageEntryPrice; "0.00000000" default
│   ├── position_quantity     WideDecimal // Position.PositionQuantity (base); "0.00000000" default
│   ├── total_capital_deployed WideDecimal// Σ(QuoteAmount+Fee) across all fills; "0.00000000" default
│   ├── fees_accumulated      WideDecimal // Position.FeesAccumulated; "0.00000000" default
│   ├── take_profit_price     WideDecimal // Position.TakeProfitTarget; "0.00000000" default
│   ├── liquidation_price     WideDecimal // Position.LiquidationPrice; "0.00000000" default
│   └── filled_orders_count   int         // len(Position.Orders); 0 default
│
├── Analytics (computed at emit time)
│   ├── unrealized_pnl       WideDecimal // (candle_close - avg_entry) × qty; "0.00000000" when no position
│   └── current_drawdown_pct WideDecimal // (candle_low - avg_entry) / avg_entry × 100; "0.00000000" when no position
│
└── Action (event-specific; sentinel defaults for non-fill events)
    ├── action_price     WideDecimal // Fill price; "0.00000000" for price_changed
    ├── action_quantity  WideDecimal // Fill quantity (base); "0.00000000" for price_changed
    ├── action_fee       WideDecimal // Fee paid; "0.00000000" for price_changed
    ├── order_number     int         // 1-indexed DCA order number; 0 for non-fill events
    ├── realized_pnl     WideDecimal // Net profit on close; "0.00000000" for non-close events
    └── close_reason     string      // "take_profit"|"liquidation"|"exit_on_last_order"|""; "" for non-close
```

### WideDecimal wrapper

```
WideDecimal (alias over decimal.Decimal)
└── MarshalJSON() → "\"" + StringFixed(8) + "\"" (always 8 decimal places, quoted)
```

---

## WideEventEnricher (Go struct)

Placed in `core-engine/application/orchestrator/wide_event_enricher.go`.

```
WideEventEnricher
├── ch          chan WideEvent    // buffered, capacity 65536 (lossless back-pressure model)
├── done        chan struct{}     // closed by worker when drain is complete
├── file        *os.File         // the .jsonl output file (created at init)
├── bw          *bufio.Writer    // 256 KiB buffer wrapping file
├── stallTime   time.Duration    // cumulative PSM stall duration (FR-012 observability)
└── outputPath  string           // absolute path of the .jsonl file
```

**Lifecycle**:
1. `NewWideEventEnricher(outputDir, runID) (*WideEventEnricher, error)` — creates file, initializes struct, starts worker goroutine
2. `Emit(event WideEvent)` — blocking send to channel (back-pressure when full); measures and accumulates stall time
3. `Close() (stallTime time.Duration, err error)` — closes channel, waits on `done`, flushes `bw`, closes file; returns stall duration for FR-012 logging

**Worker goroutine**:
- Reads from `ch` in a `for range ch` loop (drains completely before exiting)
- Serializes each `WideEvent` to JSON via `json.Marshal`
- Writes JSON bytes + `\n` to `bw`
- On `json.Marshal` error: skips event, logs warning (malformed struct, not a data loss scenario)
- On `bw.Write` error: the sticky-error behavior of bufio.Writer ensures `Flush()` at Close detects it

---

## BacktestRunSummary extension

The existing `BacktestRun` struct gains one field for FR-012 observability:

```
BacktestRun (existing struct, extended)
└── WideEventStallDuration time.Duration // cumulative PSM stall from enricher back-pressure
```

---

## ClickHouse Table Schema (out of scope — reference only)

The `wide_events` ClickHouse table schema is defined in a separate migration feature.  
This data model specifies only the field names and types that the migration must honour.

```
wide_events (ClickHouse MergeTree)
PARTITION BY run_id
ORDER BY (run_id, timestamp, event_type)

Columns:
schema_version           UInt8
run_id                   String
trade_id                 String           (empty string when no position)
timestamp                DateTime64(3)    (UTC)
event_type               String           LowCardinality
symbol                   String           LowCardinality
candle_open              Decimal(38,8)
candle_high              Decimal(38,8)
candle_low               Decimal(38,8)
candle_close             Decimal(38,8)
candle_volume            Decimal(38,8)
running_account_balance  Decimal(38,8)
global_candle_count      Int64
position_state           String           LowCardinality
average_entry_price      Decimal(38,8)
position_quantity        Decimal(38,8)
total_capital_deployed   Decimal(38,8)
fees_accumulated         Decimal(38,8)
take_profit_price        Decimal(38,8)
liquidation_price        Decimal(38,8)
filled_orders_count      UInt16
unrealized_pnl           Decimal(38,8)
current_drawdown_pct     Decimal(38,8)
action_price             Decimal(38,8)
action_quantity          Decimal(38,8)
action_fee               Decimal(38,8)
order_number             UInt8
realized_pnl             Decimal(38,8)
close_reason             String           LowCardinality

NOTE: All Decimal columns are non-Nullable because Go emits "0.00000000" as the 
default, never JSON null. LowCardinality on string columns with bounded enumerations 
(event_type, symbol, position_state, close_reason) significantly reduces storage.
```

---

## TypeScript Types (Node.js ingestion layer)

Placed in `orchestrator/api/src/services/WideEventIngester.ts`.

```
EngineRunResult (existing interface, extended)
└── wideEventFilePath?: string  // absolute path to the .jsonl file; undefined if enricher was disabled

WideEventIngester (new class)
├── constructor(chClient: ClickHouseClient, database: string)
├── ingest(runId: string, filePath: string): Promise<IngestResult>
│   1. Stats check: if file is empty → warn + return { rowsInserted: 0 }
│   2. ALTER TABLE wide_events DROP PARTITION '{runId}'   (via chClient.command())
│   3. chClient.insert({ table, values: fs.createReadStream(filePath), format: 'JSONEachRow' })
│   4. Return { rowsInserted: number } from ClickHouse INSERT summary
└── IngestResult
    ├── rowsInserted  number
    └── durationMs    number
```
