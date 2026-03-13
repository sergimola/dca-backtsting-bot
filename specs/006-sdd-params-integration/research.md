# Research: SDD 4.1 Parameters Integration

**Branch**: `006-sdd-params-integration` | **Phase**: 0 | **Date**: 2026-03-12

All NEEDS CLARIFICATION items and open questions are resolved below through direct codebase inspection.

---

## 1. JSON Contract Gap Analysis (Go Engine)

### Current state

The Go engine (`cmd/engine/main.go`) reads this JSON schema from stdin:

```json
{
  "entry_price": "string (decimal)",
  "amounts": ["string[] (decimal)"],
  "sequences": [0, 1, 2],
  "leverage": "string (decimal)",
  "margin_ratio": "string (decimal)",
  "market_data_csv_path": "string",
  "idempotency_key": "string (optional)"
}
```

`buildConfigFromRequest` only wires **4 of 13 fields** to `config.Config`:
- `entry_price` → `WithPriceEntry`
- `amounts[0]` → `WithAmountPerTrade`
- `leverage` → `WithMultiplier`
- `len(sequences)` → `WithNumberOfOrders`

**Silently defaulted** (not user-controllable): `price_scale` (1.1), `amount_scale` (2.0), `margin_type` ("cross"), `take_profit_distance_percent` (0.5), `account_balance` (1000), `exit_on_last_order` (false), `trading_pair`, `start_date`, `end_date`.

**Decision**: Replace the entire current schema with the 13 SDD 4.1 parameter names. The old `amounts[]`, `sequences[]`, `margin_ratio` fields are eliminated. The new schema directly mirrors the `config.Config` struct.

**Rationale**: All 14 functional Go option functions (`WithTradingPair`, `WithPriceScale`, `WithAmountScale`, `WithMarginType`, `WithTakeProfitDistancePercent`, `WithAccountBalance`, `WithExitOnLastOrder`, etc.) already exist in `domain/config/config.go` — nothing needs to be added to the domain. The gap is exclusively in the `cmd/engine/main.go` mapping layer.

**Alternatives considered**:
- _Keep old schema, add new fields alongside_: Rejected — two parallel schemas for the same data is a maintenance trap and confuses the contract boundary.
- _Accept both `amounts[]` and `amount_per_trade` with fallback_: Rejected — adding a fallback codifies the old broken behaviour.

---

## 2. Market Data File Naming Convention

### Current state

Integration tests and routes hardcode paths like `/data/BTCUSDT_1m.csv`. The `dummy.csv` file in the API root has the header:

```
symbol,timestamp,open,high,low,close,volume
BTCUSDC,2024-01-01T00:00:00Z,50000.0,...
```

`AppConfig` exposes no `MARKET_DATA_DIR` env var. No `MarketDataResolver` service exists.

### Chosen naming convention

After examining the Binance bulk data download convention used widely in crypto tooling:

```
{SYMBOL_NO_SLASH}-1m-{YYYY}-{MM}.csv
```

Examples:
- `LTC/USDT` + 2024-01-02 → `LTCUSDT-1m-2024-01.csv`
- `BTC/USDC` + 2024-01-05 → `BTCUSDC-1m-2024-01.csv`
- `LTC/USDT` spanning 2023-12 to 2024-02 → three files: `LTCUSDT-1m-2023-12.csv`, `LTCUSDT-1m-2024-01.csv`, `LTCUSDT-1m-2024-02.csv`

**Symbol normalization**: Strip `/`, uppercase. `LTC/USDT` → `LTCUSDT`.

**Multi-month runs**: When `start_date` and `end_date` span multiple calendar months, the resolver returns an ordered list of per-month file paths. The Go engine CSV loader already supports concatenated streaming (it reads row-by-row, agnostic to file boundaries) — the API concatenates the files in memory in chronological order before passing a single stream, **or** uses the first file for single-month runs and pipes them in sequence. After closer inspection, the Go engine's `RunBacktest` accepts an `io.Reader` — multi-file handling means the simplest solution is to open and concatenate file handles server-side and pass the merged reader. For the MVP scope of this feature: **single-month only** (assert `start_date` and `end_date` are within the same calendar month). Multi-month concatenation is a follow-on task.

**Base directory**: New `MARKET_DATA_DIR` env var on the API (default: `./data/market`). Path = `{MARKET_DATA_DIR}/{SYMBOL}-1m-{YYYY}-{MM}.csv`.

**Rationale**: Binance convention is the existing one the downloader was assumed to use (matching `BTCUSDT_1m.csv` patterns in tests, adjusted to the hyphenated monthly format common in Binance bulk datasets). The Go engine already validates `market_data_csv_path` by simply trying `os.Open(path)` — the error maps cleanly to `CSV_FILE_NOT_FOUND`.

**Decision**: Implement a `MarketDataResolver` service in `orchestrator/api/src/services/` that:
1. Normalizes `trading_pair` (strip `/`, uppercase)
2. Extracts YYYY-MM from `start_date`
3. Asserts same-month (MVP guard)
4. Resolves `{MARKET_DATA_DIR}/{SYMBOL}-1m-{YYYY}-{MM}.csv`
5. Checks `fs.existsSync` and throws `CSV_FILE_NOT_FOUND` with pair + date context before invoking the engine

**Alternatives considered**:
- _Keep `market_data_csv_path` user-provided in the form_: Rejected per spec FR-002/FR-009 — the field is now derived.
- _Query a database for available date ranges_: Out of scope; file-system check is sufficient for the MVP.
- _Accept multi-month runs immediately_: Deferred — unnecessary complexity for MVP; single-month guard with a clear error message is correct.

---

## 3. Frontend State Management for 13 Fields + Re-run

### Current state

`ConfigurationForm.tsx` uses a `FormState` object (`entryPrice`, `amounts[]`, `sequences`, `leverage`, `marginRatio`, `market_data_csv_path`). The `amounts[]` is a dynamically growing array managed with add/remove buttons. `backtest-api.ts` translates camelCase form state to the old snake_case API schema.

### Decision

Replace `FormState` with a flat object of all 13 SDD field names (camelCase in React, snake_case at the API boundary):

```ts
interface BacktestFormState {
  tradingPair: string          // "LTC/USDT"
  startDate: string            // "2024-01-02 14:00:00"
  endDate: string              // "2024-01-05 14:00:00"
  priceEntry: string           // decimal string for precision
  priceScale: string
  amountScale: string
  numberOfOrders: string       // parsed to int on submit
  amountPerTrade: string
  marginType: 'cross' | 'isolated'
  multiplier: string           // parsed to int on submit
  takeProfitDistancePercent: string
  accountBalance: string
  exitOnLastOrder: boolean
}
```

All numeric fields are kept as **strings** in form state so that React controlled inputs don't coerce precision (avoids `0.10000000001` float issues in display). Conversion to the API shape happens only at submit time in `backtest-api.ts`.

**Re-run ("Modify & Re-run")**: The existing pattern already supports this — `ConfigurationPage` passes `initialValues` prop to `ConfigurationForm`. After a run completes, the result page provides a "Modify & Re-run" button that navigates back to `ConfigurationPage` with the last config as `initialValues`. The 13 flat fields make this trivially serializable to `localStorage` for persistence across page refreshes.

**Remove**: `amounts[]` dynamic list, `sequences` count field, `leverage` alias (replaced by `multiplier`), `marginRatio` (replaced by `margin_type`), `market_data_csv_path` field.

**Validation**: `useFormValidation.ts` receives a corresponding update to validate all 13 fields per FR-005.

**Rationale**: Flat state > nested state for forms of this size. String-typed form values is React best practice for decimal inputs to avoid IEEE-754 display corruption. The existing `useFormValidation` hook pattern is already established and simply needs new rules.

**Alternatives considered**:
- _Keep `amounts[]` and compute `amount_per_trade` from the sum_: Rejected — it is the inverse of the engine's logic and forces users to do math the engine is designed to do.
- _Use a form library (React Hook Form, Formik)_: Deferred — out of scope; existing hook pattern is sufficient.

---

## 4. Integration Test Points for Go Binary Mapping

### Decision

The following 6 canonical scenarios from the spec's test table are designated as the **binding integration tests** that verify the Go JSON mapping is correct. They must pass before merge.

Each test sends a full 13-field JSON to the Go engine binary via stdin and verifies the engine output (stdout JSON) reflects the parameter correctly.

| Test ID | Parameter Under Test | Input | Expected Signal in Output |
|---------|---------------------|-------|--------------------------|
| IT-001 | `price_entry` + `price_scale` | `P0=100, price_entry=2.0, price_scale=1.1, N=3` | First order event price = 100, second = 98.00 |
| IT-002 | `price_scale` geometric growth | Same as IT-001 | Third order event price = 95.844 |
| IT-003 | `amount_per_trade` + `amount_scale` + `multiplier` | `amount_per_trade=1000, amount_scale=2.0, multiplier=3, N=3` | Order A0 amount ≈ 428.57, A1 ≈ 857.14 |
| IT-004 | `multiplier=1` liquidation clamp | `multiplier=1, account_balance=1000, N=3` | No liquidation event in result |
| IT-005 | `exit_on_last_order=true` | All orders fill before end_date | Result ends before end_date |
| IT-006 | `margin_type` round-trip | `margin_type=cross` | Response `final_position.margin_type = "cross"` |

**What these catch**: Tests IT-001 and IT-002 catch `price_scale` being silently ignored (it was defaulted to 1.1 before; if it's still hardcoded, a non-1.1 value in the JSON would diverge). IT-003 catches `multiplier` and `amount_scale` both being wired (previously only `multiplier` via `leverage` was partially wired, but `amount_scale` was always default). IT-004 and IT-005 catch boolean/string fields that were previously unreachable.

**Existing test infrastructure**: `BacktestService.integration.test.ts` already spawns the binary with a mock. The canonical tests should be added as a new file `engine-mapping.integration.test.ts` using the real binary (with a real CSV test fixture like `dummy.csv`). This follows the established test file naming pattern.

---

## 5. Decimal Precision at API Boundary

### Decision

**Node.js → Go**: All 13 numeric fields are serialized as **decimal strings** in the JSON payload (not JavaScript `number`). The API `validateBacktestRequest` enforces this at the boundary. String decimal format: up to 8 decimal places (same as existing `entry_price` validation contract).

**Exception**: `number_of_orders` (int) and `exit_on_last_order` (bool) are their native JSON types, not strings.

**Go parsing**: The `BacktestRequest` struct in `main.go` uses `string` for all decimal fields and calls `decimal.NewFromString()` — same pattern already used for `entry_price`. This ensures zero precision loss crossing the boundary.

**Rationale**: The existing `DecimalValidator.ts` utility already enforces this pattern. The constitution forbids float arithmetic; using string serialization at the boundary is the only conforming approach.

---

## Summary of Resolved Unknowns

| Unknown | Resolution |
|---------|-----------|
| What JSON fields does the Go engine currently accept? | 7 fields, 4 actually wired — see §1 |
| Which Go `With*` options exist? | All 14 exist — gap is only in `main.go` mapping |
| What CSV naming convention does the data store use? | `{SYMBOL}-1m-{YYYY}-{MM}.csv` in `MARKET_DATA_DIR` |
| How does multi-month date range work? | MVP: single-month only, guard + clear error |
| How does frontend manage form state? | Flat 13-field string state, persist to localStorage |
| What existing tests are affected? | All tests referencing old `BacktestRequest` schema need updating |
| How are decimals passed across the boundary? | String-typed for monetary, native int/bool for counts/flags |
