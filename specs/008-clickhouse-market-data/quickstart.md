# Quickstart: Auto-Downloader & ClickHouse Migration

**Feature**: 008-clickhouse-market-data  
**Purpose**: Get the system running end-to-end with ClickHouse as market data storage

---

## Prerequisites

- Docker Desktop (or any Docker runtime)
- Go 1.26+
- Node.js 20+

---

## Step 1: Start ClickHouse

```bash
docker run -d \
  --name clickhouse-dca \
  -p 8123:8123 \
  -p 9000:9000 \
  --ulimit nofile=262144:262144 \
  clickhouse/clickhouse-server:latest
```

Verify it is running:

```bash
curl http://localhost:8123/ping
# Expected: "Ok."
```

---

## Step 2: Create the Schema

Run the DDL via the ClickHouse HTTP interface:

```bash
curl -X POST "http://localhost:8123/" \
  --data "CREATE DATABASE IF NOT EXISTS dca_bot"

curl -X POST "http://localhost:8123/?database=dca_bot" \
  --data "
CREATE TABLE IF NOT EXISTS market_data (
    symbol    String,
    timestamp DateTime64(3, 'UTC'),
    open      Float64,
    high      Float64,
    low       Float64,
    close     Float64,
    volume    Float64
) ENGINE = ReplacingMergeTree()
ORDER BY (symbol, timestamp);
"
```

Or connect with the CLI:

```bash
docker exec -it clickhouse-dca clickhouse-client
# Inside the client:
CREATE DATABASE IF NOT EXISTS dca_bot;
USE dca_bot;
CREATE TABLE IF NOT EXISTS market_data ( ... ) ENGINE = ReplacingMergeTree() ORDER BY (symbol, timestamp);
```

---

## Step 3: Configure the Node.js API

Set environment variables before starting the API server:

```bash
# Windows PowerShell
$env:CLICKHOUSE_HOST          = "http://localhost"
$env:CLICKHOUSE_PORT          = "8123"
$env:CLICKHOUSE_NATIVE_PORT   = "9000"
$env:CLICKHOUSE_DATABASE      = "dca_bot"
$env:CLICKHOUSE_USER          = "default"
$env:CLICKHOUSE_PASSWORD      = ""

# Then start the API
cd orchestrator/api
npm start
```

Or create a `.env` file in `orchestrator/api/`:

```dotenv
CLICKHOUSE_HOST=http://localhost
CLICKHOUSE_PORT=8123
CLICKHOUSE_NATIVE_PORT=9000
CLICKHOUSE_DATABASE=dca_bot
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
```

---

## Step 4: Build the Go Engine

```bash
cd core-engine
go build -o ../orchestrator/api/core-engine.exe ./cmd/engine/main.go
```

---

## Step 5: Run a Backtest

Submit a backtest via the frontend or directly with curl. The data auto-downloads on first use:

```bash
curl -X POST http://localhost:4000/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "trading_pair": "BTCUSDT",
    "start_date": "2024-01-01T00:00:00Z",
    "end_date": "2024-01-31T23:59:00Z",
    "price_entry": "42000",
    "price_scale": "1.02",
    "amount_scale": "1.5",
    "number_of_orders": 5,
    "amount_per_trade": "100",
    "margin_type": "isolated",
    "multiplier": "1",
    "take_profit_distance_percent": "1.5",
    "account_balance": "10000",
    "exit_on_last_order": false
  }'
```

**What happens on first request**:
1. API checks ClickHouse — no data found for `BTCUSDT` in January 2024
2. Status transitions to `DOWNLOADING_DATA`
3. API fetches ~44,640 candles from Binance in 45 paginated requests
4. Candles are batch-inserted into ClickHouse
5. Status transitions to `RUNNING` — Go engine starts streaming rows direct from ClickHouse
6. Result returned

**What happens on second request** (same symbol/range):
1. API checks ClickHouse — data is present, count matches
2. Status transitions directly to `RUNNING`
3. Result returned much faster (no download step)

---

## Step 6: Verify Data in ClickHouse

```bash
curl "http://localhost:8123/?database=dca_bot&query=SELECT+symbol,+COUNT(*)+AS+cnt,+MIN(timestamp),+MAX(timestamp)+FROM+market_data+GROUP+BY+symbol+FORMAT+Pretty"
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `ClickHouse ping failed` | Check Docker container is running: `docker ps \| grep clickhouse` |
| `exchange API unreachable` during download | Binance may be rate-limiting; the system auto-retries once. For persistent failures, check network access. |
| Go engine exits with `clickhouse connection failed` | Verify `CLICKHOUSE_NATIVE_PORT=9000` is set and ClickHouse exposes port 9000 |
| Duplicate candles in query results | Run `OPTIMIZE TABLE market_data FINAL` to force synchronous deduplication (normally handled automatically) |
| Frontend shows `DOWNLOADING_DATA` indefinitely | Check Node API logs for download errors; the state transitions to `FAILED` on error |
