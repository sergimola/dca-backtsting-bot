# Data Model: SDD 4.1 Parameters Integration

**Branch**: `006-sdd-params-integration` | **Phase**: 1 | **Date**: 2026-03-12

This document describes every data entity that changes in this feature. It covers the shape of data
at each layer boundary, validation rules, and the field-by-field mapping between layers.

---

## Entity 1: `BacktestConfig` (Cross-layer canonical shape)

This is the **single source of truth** for all 13 SDD 4.1 parameters. It flows from the UI form,
through the API, into the Go engine, and back out in the `final_position` response.

### Fields

| Field | Type | Constraints | SDD §4.1 default |
|-------|------|------------|-----------------|
| `trading_pair` | string | Non-empty, format `AAA/BBB` | `"LTC/USDT"` |
| `start_date` | string | ISO-like `"YYYY-MM-DD HH:MM:SS"`, before `end_date` | `"2024-01-02 14:00:00"` |
| `end_date` | string | ISO-like `"YYYY-MM-DD HH:MM:SS"`, after `start_date` | `"2024-01-05 14:00:00"` |
| `price_entry` | decimal string | > 0, ≤ 8 decimal places | `"2.0"` |
| `price_scale` | decimal string | > 0, ≤ 8 decimal places | `"1.1"` |
| `amount_scale` | decimal string | > 0, ≤ 8 decimal places | `"2.0"` |
| `number_of_orders` | integer | ≥ 1, ≤ 100 | `10` |
| `amount_per_trade` | decimal string | > 0, ≤ 8 decimal places | `"17500"` |
| `margin_type` | enum string | `"cross"` \| `"isolated"` | `"cross"` |
| `multiplier` | integer | ≥ 1 | `1` |
| `take_profit_distance_percent` | decimal string | > 0, ≤ 8 decimal places | `"0.5"` |
| `account_balance` | decimal string | > 0, ≤ 8 decimal places | `"1000"` |
| `exit_on_last_order` | boolean | — | `false` |

### Notes
- `number_of_orders` and `multiplier` are JSON `number` (not string), since they are integers with no precision risk.
- `exit_on_last_order` is JSON `boolean`.
- All other numeric fields are JSON `string` (decimal representation) to prevent IEEE-754 precision loss at the boundary.
- `monthly_addition` is NOT included — it defaults to `0.0` in the engine and is not surfaced in this feature.

---

## Entity 2: `EngineRequest` (Go engine stdin JSON)

**Complete new schema** replacing the old `BacktestRequest`. Consumed by `cmd/engine/main.go`.

```json
{
  "trading_pair":                   "LTC/USDT",
  "start_date":                     "2024-01-02 14:00:00",
  "end_date":                       "2024-01-05 14:00:00",
  "price_entry":                    "2.00000000",
  "price_scale":                    "1.10000000",
  "amount_scale":                   "2.00000000",
  "number_of_orders":               10,
  "amount_per_trade":               "17500.00000000",
  "margin_type":                    "cross",
  "multiplier":                     1,
  "take_profit_distance_percent":   "0.50000000",
  "account_balance":                "1000.00000000",
  "exit_on_last_order":             false,
  "market_data_csv_path":           "/data/market/LTCUSDT-1m-2024-01.csv",
  "idempotency_key":                "optional-uuid"
}
```

**Removed fields** (no longer accepted): `entry_price`, `amounts[]`, `sequences[]`, `leverage`, `margin_ratio`.

**Go struct** in `cmd/engine/main.go`:

```go
type EngineRequest struct {
    TradingPair                string `json:"trading_pair"`
    StartDate                  string `json:"start_date"`
    EndDate                    string `json:"end_date"`
    PriceEntry                 string `json:"price_entry"`
    PriceScale                 string `json:"price_scale"`
    AmountScale                string `json:"amount_scale"`
    NumberOfOrders             int    `json:"number_of_orders"`
    AmountPerTrade             string `json:"amount_per_trade"`
    MarginType                 string `json:"margin_type"`
    Multiplier                 int    `json:"multiplier"`
    TakeProfitDistancePercent  string `json:"take_profit_distance_percent"`
    AccountBalance             string `json:"account_balance"`
    ExitOnLastOrder            bool   `json:"exit_on_last_order"`
    MarketDataCSVPath          string `json:"market_data_csv_path"`
    IdempotencyKey             string `json:"idempotency_key,omitempty"`
}
```

### `buildConfigFromRequest` mapping (all 13 fields)

```go
cfg, err := config.NewConfig(
    config.WithTradingPair(req.TradingPair),
    config.WithStartDate(req.StartDate),
    config.WithEndDate(req.EndDate),
    config.WithPriceEntry(mustDecimal(req.PriceEntry)),
    config.WithPriceScale(mustDecimal(req.PriceScale)),
    config.WithAmountScale(mustDecimal(req.AmountScale)),
    config.WithNumberOfOrders(req.NumberOfOrders),
    config.WithAmountPerTrade(mustDecimal(req.AmountPerTrade)),
    config.WithMarginType(req.MarginType),
    config.WithMultiplier(decimal.NewFromInt(int64(req.Multiplier))),
    config.WithTakeProfitDistancePercent(mustDecimal(req.TakeProfitDistancePercent)),
    config.WithAccountBalance(mustDecimal(req.AccountBalance)),
    config.WithExitOnLastOrder(req.ExitOnLastOrder),
)
```

`mustDecimal(s string)` is a helper that calls `decimal.NewFromString(s)` and returns an error on failure.

---

## Entity 3: `ApiBacktestRequest` (Node.js API — HTTP request body)

The body accepted by `POST /backtest`. Replaces the existing `BacktestRequest` in
`src/types/configuration.ts` and `src/types/index.ts`.

```ts
interface ApiBacktestRequest {
  // Identity
  trading_pair: string;
  start_date: string;
  end_date: string;
  // Price geometry
  price_entry: string;              // decimal string
  price_scale: string;              // decimal string
  // Amount geometry
  amount_scale: string;             // decimal string
  number_of_orders: number;         // integer
  amount_per_trade: string;         // decimal string
  // Position config
  margin_type: 'cross' | 'isolated';
  multiplier: number;               // integer
  take_profit_distance_percent: string;  // decimal string
  account_balance: string;          // decimal string
  exit_on_last_order: boolean;
  // Optional
  idempotency_key?: string;
  // NOTE: market_data_csv_path is NOT accepted from clients — it is derived server-side
}
```

**Removed fields**: `entry_price`, `amounts[]`, `sequences[]`, `leverage`, `margin_ratio`, `market_data_csv_path`.

### Validation rules (enforced by `validateBacktestRequest`)

| Field | Rule |
|-------|------|
| `trading_pair` | Non-empty string, must contain `/` |
| `start_date` / `end_date` | Non-empty strings, parseable as `YYYY-MM-DD HH:MM:SS` |
| `start_date` | Must precede `end_date` |
| `start_date` / `end_date` | Must be within the same calendar month (MVP guard) |
| `price_entry`, `price_scale`, `amount_scale`, `take_profit_distance_percent` | Decimal string > 0, ≤ 8 places |
| `amount_per_trade`, `account_balance` | Decimal string > 0, ≤ 8 places |
| `number_of_orders` | Integer ≥ 1 and ≤ 100 |
| `multiplier` | Integer ≥ 1 |
| `margin_type` | Exactly `"cross"` or `"isolated"` |
| `exit_on_last_order` | Boolean |
| `idempotency_key` | If present, valid UUID RFC 4122 |

---

## Entity 4: `MarketDataRef` (API internal)

Resolved server-side inside `MarketDataResolver.resolveCSVPath()`. Never exposed to clients.

```ts
interface MarketDataRef {
  symbol: string;        // "LTCUSDT" (normalized from "LTC/USDT")
  yearMonth: string;     // "2024-01"
  filePath: string;      // "/data/market/LTCUSDT-1m-2024-01.csv" (absolute)
  exists: boolean;       // fs.existsSync result
}
```

**Derivation algorithm**:

```ts
function resolveCSVPath(tradingPair: string, startDate: string, marketDataDir: string): MarketDataRef {
  const symbol = tradingPair.replace('/', '').toUpperCase();  // "LTC/USDT" → "LTCUSDT"
  const yearMonth = startDate.slice(0, 7).replace('-', '-');  // "2024-01-02 14:00:00" → "2024-01"
  const filename = `${symbol}-1m-${yearMonth}.csv`;
  const filePath = path.join(marketDataDir, filename);
  return { symbol, yearMonth, filePath, exists: fs.existsSync(filePath) };
}
```

---

## Entity 5: `BacktestFormState` (Frontend)

Replaces `FormState` in `ConfigurationForm.tsx` and `BacktestConfiguration` in `services/types.ts`.

```ts
interface BacktestFormState {
  // Identity
  tradingPair: string;              // e.g. "LTC/USDT"
  startDate: string;                // e.g. "2024-01-02 14:00:00"
  endDate: string;                  // e.g. "2024-01-05 14:00:00"
  // Price geometry
  priceEntry: string;               // displayed + validated as decimal
  priceScale: string;
  // Amount geometry
  amountScale: string;
  numberOfOrders: string;           // string in form, parsed to int on submit
  amountPerTrade: string;
  // Position config
  marginType: 'cross' | 'isolated';
  multiplier: string;               // string in form, parsed to int on submit
  takeProfitDistancePercent: string;
  accountBalance: string;
  exitOnLastOrder: boolean;
}
```

**Serialization to API payload** (`backtest-api.ts`):

```ts
const apiPayload: ApiBacktestRequest = {
  trading_pair:                   state.tradingPair,
  start_date:                     state.startDate,
  end_date:                       state.endDate,
  price_entry:                    toDecimalString(state.priceEntry),
  price_scale:                    toDecimalString(state.priceScale),
  amount_scale:                   toDecimalString(state.amountScale),
  number_of_orders:               parseInt(state.numberOfOrders, 10),
  amount_per_trade:               toDecimalString(state.amountPerTrade),
  margin_type:                    state.marginType,
  multiplier:                     parseInt(state.multiplier, 10),
  take_profit_distance_percent:   toDecimalString(state.takeProfitDistancePercent),
  account_balance:                toDecimalString(state.accountBalance),
  exit_on_last_order:             state.exitOnLastOrder,
};
```

Where `toDecimalString(v: string): string` pads to 8 decimal places (e.g., `"2.0"` → `"2.00000000"`).

---

## State Transitions

The `BacktestConfig` entity flows through these stages without mutation:

```
[BacktestFormState]    →    [ApiBacktestRequest]    →    [EngineRequest]    →    [Config (Go)]
  UI form state             API HTTP body               stdin JSON              domain struct
  (camelCase strings)       (snake_case strings)        (snake_case strings)    (Decimal values)
```

Each boundary conversion is a **pure, total function with no lossy defaults**. The invariant: for every field that is settable by the user, its value MUST survive all four stages unchanged (modulo formatting normalization like decimal padded to 8 places).

---

## Fields Removed from Existing Code

| Removed field | Location | Replacement |
|--------------|----------|-------------|
| `entry_price` | Go `BacktestRequest`, Node `BacktestRequest` | `price_entry` |
| `amounts[]` | Go, Node, React | Derived by engine from `amount_per_trade` + `amount_scale` |
| `sequences[]` | Go, Node, React | Derived by engine from `number_of_orders` |
| `leverage` | Go, Node, React | `multiplier` (integer) |
| `margin_ratio` | Go, Node, React | Not needed — engine uses `mmr=0.0067` constant |
| `market_data_csv_path` | Node (from client input), React form | Derived server-side by `MarketDataResolver` |
