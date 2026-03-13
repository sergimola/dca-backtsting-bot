# Contract: Market Data Resolver

**Layer**: Node.js API — `MarketDataResolver` service  
**Location**: `orchestrator/api/src/services/MarketDataResolver.ts`  
**Version**: v1 (new in this feature)

---

## Purpose

The `MarketDataResolver` maps a `trading_pair` and date range to a concrete CSV file path on the
server's filesystem. It replaces the previous requirement for the client to supply
`market_data_csv_path` explicitly.

---

## Interface

```ts
class MarketDataResolver {
  constructor(marketDataDir: string);

  /**
   * Resolves the CSV file path for a given trading pair and start date.
   *
   * @throws MarketDataNotFoundError if the file does not exist
   * @throws SameMonthGuardError if start/end span multiple months (MVP guard)
   */
  resolve(tradingPair: string, startDate: string, endDate: string): string;
}
```

---

## File Naming Convention

```
{SYMBOL}-1m-{YYYY}-{MM}.csv
```

Where `SYMBOL` = `tradingPair.replace('/', '').toUpperCase()`.

| Input `trading_pair` | Input `start_date` | Resolved filename |
|--------------------|--------------------|-------------------|
| `"LTC/USDT"` | `"2024-01-02 14:00:00"` | `LTCUSDT-1m-2024-01.csv` |
| `"BTC/USDC"` | `"2024-01-05 14:00:00"` | `BTCUSDC-1m-2024-01.csv` |
| `"ETH/USDT"` | `"2023-12-01 00:00:00"` | `ETHUSDT-1m-2023-12.csv` |

---

## Algorithm

```
1. strip('/')  +  toUpperCase()  on trading_pair     → symbol
2. take first 7 chars of start_date                  → "YYYY-MM"
3. take first 7 chars of end_date                    → "YYYY-MM"
4. assert YYYY-MM(start) == YYYY-MM(end)             → SameMonthGuardError if not
5. filename = `${symbol}-1m-${yearMonth}.csv`
6. filePath  = path.join(MARKET_DATA_DIR, filename)
7. if !fs.existsSync(filePath) → MarketDataNotFoundError(symbol, yearMonth)
8. return filePath
```

---

## Environment Variable

| Variable | Description | Default |
|----------|-------------|---------|
| `MARKET_DATA_DIR` | Directory containing OHLCV CSV files | `./data/market` |

Add to `AppConfig` interface and `loadAppConfig()` loader.

---

## Error Types

### `MarketDataNotFoundError`

```ts
class MarketDataNotFoundError extends Error {
  constructor(symbol: string, yearMonth: string, filePath: string) {
    super(`Market data not found for ${symbol} (${yearMonth}). Expected: ${path.basename(filePath)}`);
    this.name = 'MarketDataNotFoundError';
    this.errorCode = ErrorCode.CSV_FILE_NOT_FOUND;
  }
}
```

### `SameMonthGuardError`

```ts
class SameMonthGuardError extends Error {
  constructor(startMonth: string, endMonth: string) {
    super(
      `start_date (${startMonth}) and end_date (${endMonth}) must be in the same calendar month. ` +
      `Multi-month backtests are not yet supported.`
    );
    this.name = 'SameMonthGuardError';
    this.errorCode = ErrorCode.VALIDATION_OUT_OF_BOUNDS;
  }
}
```

---

## Integration Point

In `backtest.routes.ts`, after validation middleware and before calling `backtestService.execute()`:

```ts
const csvPath = marketDataResolver.resolve(
  backtestReq.trading_pair,
  backtestReq.start_date,
  backtestReq.end_date
);
// csvPath is then injected into the EngineRequest as market_data_csv_path
```

The `BacktestService.execute()` signature does not change — the resolved path is simply included in
the JSON payload passed to the engine.
