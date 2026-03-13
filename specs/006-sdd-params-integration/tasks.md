# Tasks: SDD 4.1 Parameters Integration — UI & Engine Config Refactor

**Input**: Design documents from `/specs/006-sdd-params-integration/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new infrastructure is required. The domain layer (`core-engine/domain/config`) already exposes all 14 `With*` options. All changes are in the adapter/integration layers.

**Checkpoint**: No blocking setup tasks — implementation tasks can proceed directly.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Go engine must correctly wire all 13 SDD §4.1 fields before the API or frontend changes are meaningful. The new API request type must be defined before the resolver and frontend can reference it.

**⚠️ CRITICAL**: Task 1 (engine mapping) and Task 3 (API types) are independent and must both be complete before Task 5 (integration tests) can go green.

---

## Phase 3: User Story 1, 2, 3, 4 — Full Delivery

All five tasks below collectively deliver US1 through US4. The recommended implementation order is:

**T001 → T003 → T002 → T004 → T005**

Rationale: fix the engine first (T001) so the binary is correct; define API types (T003) so TypeScript compiles; add MarketDataResolver (T002) which depends on the new types; rebuild frontend (T004) which depends on the new API shape; write integration tests (T005) last to validate the full stack.

---

### Task 1 — Go Engine Mapping Layer (Priority: P1) [core-engine]

**Goal**: Replace the partial `BacktestRequest` struct in `core-engine/cmd/engine/main.go` with a complete `EngineRequest` that maps all 13 SDD §4.1 fields to their corresponding `config.With*` options. This is the root cause of the entire feature: today only 4 of 13 fields are wired, causing sequence computation to silently use zero-value defaults.

**User Stories**: US1, US2, US3

**Independent Test**: `cd core-engine && go test ./domain/config/...` stays green. Manual smoke: `echo '{"trading_pair":"LTCUSDT","start_date":"2024-01-01","end_date":"2024-01-31","price_entry":"2.0","price_scale":"2","amount_scale":"2","number_of_orders":5,"amount_per_trade":"0.5","margin_type":"cross","multiplier":3,"take_profit_distance_percent":"2.0","account_balance":"2000.0","market_data_csv_path":"./dummy.csv","exit_on_last_order":false}' | ./bin/engine` returns non-empty JSON.

#### Implementation

- [ ] T001.1 [core-engine] [US1] Replace `BacktestRequest` struct in `core-engine/cmd/engine/main.go` with `EngineRequest` containing all 15 fields:
  - `trading_pair string`
  - `start_date string`
  - `end_date string`
  - `price_entry string`
  - `price_scale int` (native JSON integer)
  - `amount_scale int` (native JSON integer)
  - `number_of_orders int` (native JSON integer)
  - `amount_per_trade string`
  - `margin_type string`  (`"cross"` | `"isolated"`)
  - `multiplier int` (native JSON integer, `>= 1`)
  - `take_profit_distance_percent string`
  - `account_balance string`
  - `market_data_csv_path string`
  - `exit_on_last_order bool`
  - `idempotency_key string` (optional, passthrough)

- [ ] T001.2 [core-engine] [US1] Rewrite `buildConfigFromRequest` in `core-engine/cmd/engine/main.go` to wire all 13 parameters:
  ```go
  config.New(
    config.WithTradingPair(r.TradingPair),
    config.WithStartDate(r.StartDate),
    config.WithEndDate(r.EndDate),
    config.WithPriceEntry(decimal.RequireFromString(r.PriceEntry)),
    config.WithPriceScale(r.PriceScale),
    config.WithAmountScale(r.AmountScale),
    config.WithNumberOfOrders(r.NumberOfOrders),
    config.WithAmountPerTrade(decimal.RequireFromString(r.AmountPerTrade)),
    config.WithMarginType(r.MarginType),
    config.WithMultiplier(r.Multiplier),
    config.WithTakeProfitDistancePercent(decimal.RequireFromString(r.TakeProfitDistancePercent)),
    config.WithAccountBalance(decimal.RequireFromString(r.AccountBalance)),
    config.WithExitOnLastOrder(r.ExitOnLastOrder),
  )
  ```
  Remove the old comment block listing silently-defaulted fields.

- [ ] T001.3 [core-engine] [US1] Update `convertBacktestToOutput` in `core-engine/cmd/engine/main.go` to echo all 13 fields back in the `config` section of the JSON output (enables API round-trip verification).

- [ ] T001.4 [core-engine] [US1] Run `cd core-engine && go build ./cmd/engine/... && go test ./...` — all existing tests must pass. Rebuild the binary: `go build -o bin/engine ./cmd/engine/`.

**Checkpoint**: Go binary accepts all 13 parameters and routes them to `ComputePriceSequence` / `ComputeAmountSequence` correctly. Existing `go test ./...` green.

---

### Task 2 — API Market Data Resolver (Priority: P4) [orchestrator]

**Goal**: Create a `MarketDataResolver` service that derives the CSV file path from `trading_pair`, `start_date`, and `end_date`, replacing the user-supplied `market_data_csv_path` field. Add `MARKET_DATA_DIR` environment variable support. Wire the resolver into the backtest route before engine dispatch.

**User Stories**: US4
**Depends on**: T003 (needs `ApiBacktestRequest` with `trading_pair`, `start_date`, `end_date` fields)

**Independent Test**: Unit test `MarketDataResolver` directly. For manual smoke: place `./data/market/LTCUSDT-1m-2024-01.csv` and confirm `POST /backtest` with `trading_pair="LTC/USDT"`, `start_date="2024-01-02"`, `end_date="2024-01-05"` resolves to that file without the user supplying a path.

#### Implementation

- [X] T002.1 [orchestrator] [US4] Add `marketDataDir: string` to `AppConfig` interface in `orchestrator/api/src/config/AppConfig.ts` and load it from `MARKET_DATA_DIR` env var (default: `path.resolve('./data/market')`).

- [X] T002.2 [orchestrator] [US4] Create `orchestrator/api/src/services/MarketDataResolver.ts`:
  - Export class `MarketDataResolver` with constructor `(marketDataDir: string)`
  - Export errors: `MarketDataNotFoundError extends Error`, `SameMonthGuardError extends Error`
  - Implement `resolve(tradingPair: string, startDate: string, endDate: string): string`:
    1. Normalise symbol: `tradingPair.replace('/', '').toUpperCase()` → e.g. `LTCUSDT`
    2. Parse `startDate` and `endDate` as `YYYY-MM-DD` strings
    3. Throw `SameMonthGuardError` if `start YYYY-MM !== end YYYY-MM` (MVP: single-month only)
    4. Derive filename: `` `${symbol}-1m-${yyyy}-${mm}.csv` `` → e.g. `LTCUSDT-1m-2024-01.csv`
    5. Build full path: `path.join(marketDataDir, filename)`
    6. If file does not exist (`fs.existsSync`), throw `MarketDataNotFoundError` with message describing pair and month
    7. Return absolute resolved path

- [X] T002.3 [orchestrator] [US4] Inject `MarketDataResolver` into `orchestrator/api/src/routes/backtest.routes.ts`:
  - Instantiate resolver using `appConfig.marketDataDir`
  - Before calling `backtestService.execute(...)`, call `resolver.resolve(req.trading_pair, req.start_date, req.end_date)` to obtain `market_data_csv_path`
  - Catch `SameMonthGuardError` → return `400 { error: "date_range_error", message: "..." }`
  - Catch `MarketDataNotFoundError` → return `404 { error: "market_data_not_found", message: "..." }`
  - Append `market_data_csv_path` to the engine-bound request before dispatch

- [X] T002.4 [orchestrator] [US4] Write unit tests in `orchestrator/api/src/__tests__/MarketDataResolver.test.ts`:
  - Resolves correctly for `LTC/USDT`, `2024-01-02`, `2024-01-05` → `LTCUSDT-1m-2024-01.csv`
  - Throws `SameMonthGuardError` when start and end are different months
  - Throws `MarketDataNotFoundError` when file does not exist
  - Normalises slash in pair (`BTC/USDT` → `BTCUSDT`)

**Checkpoint**: `npm test -- --testPathPattern=MarketDataResolver` passes. `/backtest` returns `404` for missing data and `400` for cross-month ranges.

---

### Task 3 — API Request Refactor (Priority: P1) [orchestrator]

**Goal**: Replace the old 5-field `BacktestRequest` (entry_price, amounts[], sequences[], leverage, margin_ratio, market_data_csv_path) with the new 13-field `ApiBacktestRequest` that matches SDD §4.1. Update the validation function to enforce all 13 fields, drop the old array fields, and add the same-month guard.

**User Stories**: US1, US2, US3, US4

**Independent Test**: `npm test -- --testPathPattern=configuration` passes with new validation logic. Posting the old schema returns `400`.

#### Implementation

- [ ] T003.1 [orchestrator] [US1] Replace the `BacktestRequest` interface in `orchestrator/api/src/types/configuration.ts` with `ApiBacktestRequest`:
  ```ts
  export interface ApiBacktestRequest {
    trading_pair: string;
    start_date: string;         // ISO 8601 date: YYYY-MM-DD
    end_date: string;           // ISO 8601 date: YYYY-MM-DD
    price_entry: string;        // decimal string > 0
    price_scale: number;        // integer >= 1
    amount_scale: number;       // integer >= 1
    number_of_orders: number;   // integer >= 1
    amount_per_trade: string;   // decimal string in (0, 1]
    margin_type: 'cross' | 'isolated';
    multiplier: number;         // integer >= 1
    take_profit_distance_percent: string;  // decimal string > 0
    account_balance: string;    // decimal string > 0
    exit_on_last_order: boolean;
    idempotency_key?: string;   // optional, UUID v4
  }
  ```

- [ ] T003.2 [orchestrator] [US1] Rewrite `validateBacktestRequest` in `orchestrator/api/src/types/configuration.ts` to validate all 13 new fields. Remove all validation logic for `amounts`, `sequences`, `leverage`, `margin_ratio`, `market_data_csv_path`. Key boundary rules per `research.md`:
  - `price_entry`, `amount_per_trade`, `take_profit_distance_percent`, `account_balance` → `validateDecimal()` + `> 0`
  - `amount_per_trade` → also validate `<= 1`
  - `price_scale`, `amount_scale`, `number_of_orders` → `Number.isInteger(v) && v >= 1`
  - `multiplier` → `Number.isInteger(v) && v >= 1`
  - `margin_type` → must be `'cross'` or `'isolated'`
  - `start_date`, `end_date` → ISO 8601 date format (`/^\d{4}-\d{2}-\d{2}$/`); end must be >= start
  - `trading_pair` → non-empty string
  - `exit_on_last_order` → boolean (no coercion)
  - `idempotency_key` → optional UUID v4 (existing regex, unchanged)

- [ ] T003.3 [orchestrator] [US1] Update `orchestrator/api/src/types/index.ts` to re-export `ApiBacktestRequest` (rename the export from `BacktestRequest` to `ApiBacktestRequest`). Update all import sites within `orchestrator/api/src/` that referenced the old `BacktestRequest` type.

- [ ] T003.4 [orchestrator] [US1] Update `orchestrator/api/src/services/BacktestService.ts` method signature from `execute(request: BacktestRequest, ...)` to `execute(request: ApiBacktestRequest & { market_data_csv_path: string }, ...)` — the resolver in T002.3 appends `market_data_csv_path` before engine dispatch. The `JSON.stringify(request)` mechanics remain unchanged.

- [ ] T003.5 [orchestrator] [US1] Run `npm run build` in `orchestrator/api/` — zero TypeScript errors required.

**Checkpoint**: All existing API unit tests pass. Posting the old schema with `amounts[]` returns `400 { error: "validation_error" }`. Posting the new 13-field schema with valid values passes validation.

---

### Task 4 — Frontend Form Rebuild (Priority: P1) [orchestrator]

**Goal**: Replace the old form state (dynamic `amounts[]` list, `sequences`, `leverage`, `marginRatio`) with a flat 13-field `BacktestFormState` matching all SDD §4.1 parameters. Rebuild `ConfigurationForm.tsx` with individual controlled inputs for each field. Update the API translation layer.

**User Stories**: US1, US2, US3, US4

**Independent Test**: `npm test -- --testPathPattern=ConfigurationForm` passes. Visual: form shows 13 labelled fields, no arrays, and submits a valid payload to the API.

#### Implementation

- [ ] T004.1 [orchestrator] [US1] Replace `BacktestConfiguration` in `frontend/src/services/types.ts` with `BacktestFormState`:
  ```ts
  export interface BacktestFormState {
    tradingPair: string;
    startDate: string;
    endDate: string;
    priceEntry: string;
    priceScale: string;
    amountScale: string;
    numberOfOrders: string;
    amountPerTrade: string;
    marginType: 'cross' | 'isolated';
    multiplier: string;
    takeProfitDistancePercent: string;
    accountBalance: string;
    exitOnLastOrder: boolean;
  }
  ```
  All numeric fields are `string` to allow partial input without coercion. `marginType` and `exitOnLastOrder` are their natural types.

- [ ] T004.2 [orchestrator] [US1] Update `frontend/src/services/backtest-api.ts` — replace the old payload construction with the new mapping:
  ```ts
  const payload: ApiBacktestRequest = {
    trading_pair:                  formState.tradingPair,
    start_date:                    formState.startDate,
    end_date:                      formState.endDate,
    price_entry:                   formState.priceEntry,
    price_scale:                   parseInt(formState.priceScale, 10),
    amount_scale:                  parseInt(formState.amountScale, 10),
    number_of_orders:              parseInt(formState.numberOfOrders, 10),
    amount_per_trade:              formState.amountPerTrade,
    margin_type:                   formState.marginType,
    multiplier:                    parseInt(formState.multiplier, 10),
    take_profit_distance_percent:  formState.takeProfitDistancePercent,
    account_balance:               formState.accountBalance,
    exit_on_last_order:            formState.exitOnLastOrder,
  };
  ```
  Remove all references to `amounts`, `sequences`, `leverage`, `marginRatio`, `market_data_csv_path`.

- [ ] T004.3 [orchestrator] [US1] Rewrite `frontend/src/components/ConfigurationForm.tsx`:
  - Replace `FormState` with `BacktestFormState` (import from `../services/types`)
  - Remove the dynamic `amounts` array section (add/remove buttons)
  - Remove `sequences` field
  - Remove `leverage` and `margin_ratio` fields
  - Remove `market_data_csv_path` input
  - Add individual `<input type="text">` for each string-typed numeric field: `tradingPair`, `startDate`, `endDate`, `priceEntry`, `priceScale`, `amountScale`, `numberOfOrders`, `amountPerTrade`, `multiplier`, `takeProfitDistancePercent`, `accountBalance`
  - Add `<select>` for `marginType` with options `cross` / `isolated`
  - Add `<input type="checkbox">` for `exitOnLastOrder`
  - Default values: `marginType: 'cross'`, `exitOnLastOrder: false`, all others `''`
  - Preserve existing submit handler and `useFormValidation` hook invocations (update hook inputs to new field names)

- [ ] T004.4 [orchestrator] [US2, US3] Add frontend validation rules in `useFormValidation` (or inline) matching API contract boundary rules:
  - `multiplier` >= 1 (integer)
  - `priceScale`, `amountScale`, `numberOfOrders` >= 1 (integer)
  - `amountPerTrade` in (0, 1]
  - `priceEntry`, `takeProfitDistancePercent`, `accountBalance` > 0
  - `endDate` >= `startDate`
  - Show field-level error messages before API submission

- [ ] T004.5 [orchestrator] [US1] Run `npm test` in `frontend/` — all existing component tests must pass. Update any snapshot tests that reference the old `amounts` array or `leverage` field names.

**Checkpoint**: Form renders 13 fields, no dynamic arrays visible. `npm test` green. Submitting valid values calls `POST /backtest` with the correct 13-field payload.

---

### Task 5 — Canonical Integration Tests (Priority: P1) [orchestrator, tests]

**Goal**: Create a suite of 6 canonical integration tests (IT-001 through IT-006) that exercise the full stack from API request to Go engine output. These tests encode the SDD §2.1 and §2.2 recurrence invariants and serve as the Green Light gate for this feature branch.

**User Stories**: US1, US2, US3, US4
**Depends on**: T001 (engine binary), T002 (resolver), T003 (types)

**Write tests first (TDD)**: Create the test file now. The tests will fail until T001–T003 are complete. Start them before implementing the engine changes to get immediate feedback.

#### Implementation

- [X] T005.1 [orchestrator] [US1] Create `orchestrator/api/src/__tests__/engine-mapping.integration.test.ts`. The test suite must use the real Go binary (`core-engine/bin/engine` copied as `orchestrator/api/core-engine.exe`) and the test fixture at `orchestrator/api/testdata/LTCUSDT-1m-2024-01.csv` (generated from `dummy.csv`). Seed file setup: copy `orchestrator/api/dummy.csv` to `orchestrator/api/testdata/LTCUSDT-1m-2024-01.csv` in the `beforeAll` hook.

- [X] T005.2 [orchestrator] [US1] Implement **IT-001: Price sequence first order** — Assert `result.orders[0].price === "98.00"` given `price_entry="100.0"`, `price_scale=2`, `number_of_orders=5`, `multiplier=1`. Validates SDD §2.1: $P_1 = P_0 \cdot (1 - D/100)$ where $D = price\_scale / 10$.

- [X] T005.3 [orchestrator] [US2] Implement **IT-002: Price sequence growth** — Assert `result.orders[1].price === "95.844"` (2 decimal places) for the same config as IT-001. Validates second step of $P_n = P_0 \cdot r^n$ recurrence.

- [X] T005.4 [orchestrator] [US2] Implement **IT-003: Amount multiplier scaling** — Given `amount_per_trade="0.5"`, `account_balance="2000"`, `multiplier=3`, `amount_scale=2`, assert `result.orders[0].amount ≈ "428.57"` (within 0.01 tolerance). Validates SDD §2.2: $A_0 = C \cdot m \cdot s_a^0 \cdot s / R$ where $s = amount\_per\_trade$, $C = account\_balance$, $R = \sum s_a^n$.

- [X] T005.5 [orchestrator] [US2] Implement **IT-004: Spot liquidation clamp** — Given `multiplier=1` (spot), assert `result.summary.liquidation_price === "0"` or absent. Validates SDD §2.5: no liquidation risk for spot positions.

- [X] T005.6 [orchestrator] [US3] Implement **IT-005: exit_on_last_order ends early** — Given `exit_on_last_order=true` and a market drop that triggers all N orders before `end_date`, assert the last event timestamp in the result is strictly before `end_date`. Validates SDD §3.1 execution semantics.

- [X] T005.7 [orchestrator] [US2] Implement **IT-006: margin_type round-trip** — Send `margin_type="cross"`, assert the echoed config in the response contains `margin_type: "cross"`. Validates the API-to-engine-to-response pipeline preserves the field.

- [X] T005.8 [orchestrator] [US4] Implement **IT-007: Missing market data returns 404** — POST with `trading_pair="XRPUSDT"` (no file exists), assert HTTP `404` and body `{ "error": "market_data_not_found" }`. Validates T002 resolver error path.

- [X] T005.9 [orchestrator] [US4] Implement **IT-008: Cross-month range returns 400** — POST with `start_date="2024-01-15"`, `end_date="2024-02-10"`, assert HTTP `400` and body `{ "error": "date_range_error" }`. Validates SameMonthGuardError propagation.

- [X] T005.10 [orchestrator] [US1] Run `npm test -- --testPathPattern=engine-mapping.integration` after all tasks complete — all 8 tests must be green before merging.

**Checkpoint**: All 8 integration tests pass. This is the Green Light gate for the feature branch.

---

## Completion Checklist

- [ ] `cd core-engine && go build ./cmd/engine/... && go test ./...` — all green
- [ ] `cd orchestrator/api && npm run build` — zero TypeScript errors
- [ ] `cd orchestrator/api && npm test` — all unit + integration tests green
- [ ] `cd frontend && npm test` — all component tests green
- [ ] Existing API integration tests in `orchestrator/api/tests/` continue to pass
- [ ] `POST /backtest` with old schema (`amounts[]`) returns `400`
- [ ] `POST /backtest` with new 13-field schema + valid market data file returns `200` with trade history
- [ ] Form renders 13 fields, no array management UI visible
- [ ] Engine binary at `orchestrator/api/core-engine.exe` reflects T001 changes (copy after build)
