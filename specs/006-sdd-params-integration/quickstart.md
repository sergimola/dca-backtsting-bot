# Quickstart: SDD 4.1 Parameters Integration

**Branch**: `006-sdd-params-integration`

How to build, test, and verify this feature end-to-end from scratch.

---

## Prerequisites

- Go 1.21+ in PATH
- Node.js 20+ in PATH
- A market data CSV file for at least one month (see "Seed Market Data" below)

---

## 1. Rebuild the Go Engine

After modifying `cmd/engine/main.go`:

```powershell
cd core-engine
go build -o bin/engine ./cmd/engine
# Copy binary to API
cp .\bin\engine "..\orchestrator\api\core-engine.exe"
```

Verify the new JSON schema is accepted:

```powershell
$req = @{
  trading_pair = "LTC/USDT"
  start_date = "2024-01-02 14:00:00"
  end_date = "2024-01-05 14:00:00"
  price_entry = "2.00000000"
  price_scale = "1.10000000"
  amount_scale = "2.00000000"
  number_of_orders = 10
  amount_per_trade = "17500.00000000"
  margin_type = "cross"
  multiplier = 1
  take_profit_distance_percent = "0.50000000"
  account_balance = "1000.00000000"
  exit_on_last_order = $false
  market_data_csv_path = "..\orchestrator\api\dummy.csv"
} | ConvertTo-Json -Compress

$req | .\bin\engine
# Expect: JSON with events array on stdout, exit code 0
```

---

## 2. Run Go Engine Tests

```powershell
cd core-engine
go test ./...
# All tests must be Green before proceeding (Green Light Protocol)
```

---

## 3. Seed Market Data

Place a real or synthetic OHLCV CSV in the API's market data directory using the naming convention
`{SYMBOL}-1m-{YYYY}-{MM}.csv`:

```powershell
# Create the directory
New-Item -ItemType Directory -Force ".\orchestrator\api\data\market"

# Copy or create a test file
cp ".\orchestrator\api\dummy.csv" ".\orchestrator\api\data\market\LTCUSDT-1m-2024-01.csv"
```

CSV format (matching `dummy.csv`):

```
symbol,timestamp,open,high,low,close,volume
LTCUSDT,2024-01-02T14:00:00Z,75.50,76.00,75.00,75.75,1234.5
...
```

---

## 4. Start the API Server

```powershell
cd orchestrator\api
# Set required env vars
$env:CORE_ENGINE_BINARY_PATH = ".\core-engine.exe"
$env:MARKET_DATA_DIR = ".\data\market"
$env:PORT = "4000"

npm start
# Server should start on port 4000
```

---

## 5. Run a Backtest via curl

```powershell
$body = @{
  trading_pair = "LTC/USDT"
  start_date = "2024-01-02 14:00:00"
  end_date = "2024-01-05 14:00:00"
  price_entry = "2.00000000"
  price_scale = "1.10000000"
  amount_scale = "2.00000000"
  number_of_orders = 10
  amount_per_trade = "17500.00000000"
  margin_type = "cross"
  multiplier = 1
  take_profit_distance_percent = "0.50000000"
  account_balance = "1000.00000000"
  exit_on_last_order = $false
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/backtest" -Method POST -Body $body -ContentType "application/json"
# Expect: { "status": "success", "events": [...], ... }
```

---

## 6. Run Node.js API Tests

```powershell
cd orchestrator\api
npm test
# All tests must be Green before proceeding
```

---

## 7. Run the Frontend

```powershell
cd frontend
npm run dev
# Opens on http://localhost:5173
```

Verify:
- The form shows all 13 fields with no "Amounts" or "Sequences" list
- submitting the form with valid values produces results on the Results page
- The "Modify & Re-run" button repopulates the form with previous values

---

## 8. Run Canonical Integration Tests

These tests validate the Go binary mapping end-to-end:

```powershell
cd orchestrator\api
npm test -- --testPathPattern=engine-mapping.integration
```

All 6 canonical test scenarios (IT-001 through IT-006) must pass. See
`src/__tests__/engine-mapping.integration.test.ts`.

---

## 9. Verify the Multiplier Effect (SC-003)

Quick manual check to confirm `multiplier` is wired correctly:

```powershell
# Run with multiplier=1
$body1 = '{ "trading_pair":"LTC/USDT", ..., "multiplier":1, "amount_per_trade":"1000.00000000", "amount_scale":"2.00000000", "number_of_orders":3, ... }'
# Run with multiplier=3 — per-order amounts should be exactly 3x
$body3 = '{ "trading_pair":"LTC/USDT", ..., "multiplier":3, "amount_per_trade":"1000.00000000", "amount_scale":"2.00000000", "number_of_orders":3, ... }'
```

Expected: `OrderFilled` events in the `multiplier=3` run show amounts at `"428.57142857"`, `"857.14285714"`, `"1714.28571429"` — exactly 3× the `multiplier=1` values.

---

## 10. Verify Missing Data Error (FR-010)

```powershell
# Use a trading pair with no CSV file
$badPair = @{ ...; trading_pair = "XRP/USDT"; ... } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:4000/backtest" -Method POST -Body $badPair -ContentType "application/json"
# Expect HTTP 400 with error_code: "CSV_FILE_NOT_FOUND" and message naming XRPUSDT
```
