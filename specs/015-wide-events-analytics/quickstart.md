# Quickstart: Wide Events Analytics Engine

**Feature**: 015-wide-events-analytics

## What This Feature Adds

After implementing this feature, every backtest run will produce a `.jsonl` file containing one wide event per simulated minute (and per order fill), fully enriched with candle state, position snapshot, and computed analytics. The Node.js API then bulk-ingests this file into ClickHouse for deep quantitative analysis.

---

## Running the Go Engine with Wide Events Enabled

The engine accepts a `--wide-event-dir` flag (to be added in tasks). Pass a directory path:

```bash
cd core-engine
go run ./cmd/engine \
  --backtest-id my-run-001 \
  --symbol BTCUSDC \
  --start 2024-01-01T00:00:00Z \
  --end   2024-12-31T23:59:00Z \
  --wide-event-dir ./output/wide_events
```

After completion the engine prints (to stdout JSON):
```json
{
  "run_id": "my-run-001",
  "candle_count": 525600,
  "event_count": 1240,
  "wide_event_file": "/absolute/path/output/wide_events/my-run-001.jsonl",
  "wide_event_stall_duration_ms": 0
}
```

`wide_event_stall_duration_ms: 0` confirms no PSM back-pressure occurred (disk I/O was fast enough).

---

## Ingesting into ClickHouse

### Prerequisites

- ClickHouse running (`docker-compose up -d clickhouse`)
- `wide_events` table created with `PARTITIONED BY run_id` (separate migration feature)
- `.jsonl` file produced by the engine

### Via Node.js API

The `WideEventIngester` is called automatically by the Node.js job runner after the engine finishes (wired in the backtest service). To call it manually from a TypeScript script:

```typescript
import { chClient, database } from './services/ClickHouseClient.js';
import { WideEventIngester } from './services/WideEventIngester.js';

const ingester = new WideEventIngester(chClient, database);
const result = await ingester.ingest(
  'my-run-001',
  '/absolute/path/output/wide_events/my-run-001.jsonl'
);
console.log(`Inserted ${result.rowsInserted} rows in ${result.durationMs}ms`);
```

---

## Verifying the Output

Check the JSONL file line count:
```bash
wc -l output/wide_events/my-run-001.jsonl
```

Inspect the first event:
```bash
head -1 output/wide_events/my-run-001.jsonl | jq .
```

Query ClickHouse (via pgAdmin or clickhouse-client):
```sql
SELECT
  toStartOfHour(timestamp) AS hour,
  count()                  AS events,
  minIf(current_drawdown_pct, event_type = 'price_changed') AS worst_drawdown_pct
FROM wide_events
WHERE run_id = 'my-run-001'
GROUP BY hour
ORDER BY hour;
```

---

## Running Tests

Go (core engine):
```bash
cd core-engine
go test ./application/orchestrator/... -run TestWideEvent -v
```

Node.js (ingester):
```bash
cd orchestrator/api
npx jest WideEventIngester --verbose
```
