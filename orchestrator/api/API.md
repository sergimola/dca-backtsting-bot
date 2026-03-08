# API Documentation

## Overview

The DCA Backtesting Bot API provides RESTful endpoints for submitting backtest configurations, retrieving results, and monitoring system health. The API is designed for high concurrency with support for idempotent requests.

**Base URL**: `http://localhost:3000`

**Version**: 0.1.0

---

## Endpoints

### POST /backtest

Submit a backtest configuration and execute it.

**Request**:
```json
{
  "entry_price": "100.50000000",
  "amounts": ["10.25000000", "15.50000000"],
  "sequences": [0, 1],
  "leverage": "2.00000000",
  "margin_ratio": "0.75000000",
  "market_data_csv_path": "/data/BTCUSDT_1m.csv",
  "idempotency_key": "optional-unique-key"
}
```

**Response** (HTTP 200):
```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "success",
  "events": [
    {
      "timestamp": 1000,
      "event_type": "ENTRY",
      "price": "100.50000000",
      "quantity": "10.25000000",
      "position_state": {
        "quantity": "10.25000000",
        "average_cost": "100.50000000",
        "total_invested": "1030.1250000000",
        "leverage_level": "2.00000000",
        "status": "OPEN",
        "last_update_timestamp": 1000
      }
    }
  ],
  "final_position": {
    "quantity": "25.75000000",
    "average_cost": "101.85714286",
    "total_invested": "2622.5357143000",
    "leverage_level": "2.00000000",
    "status": "CLOSED",
    "last_update_timestamp": 2000
  },
  "pnl_summary": {
    "total_pnl": "125.50000000",
    "entry_fee": "15.45375000",
    "trading_fees": "5.15625000",
    "total_fees": "20.61000000",
    "roi_percent": "4.78",
    "total_fills": 2,
    "realized_pnl": "105.49000000",
    "safety_order_usage_counts": {
      "sequence_0": 1,
      "sequence_1": 1
    }
  },
  "execution_time_ms": 245,
  "timestamp": "2025-12-31T14:30:45.123Z"
}
```

**Query Parameters**:
- None

**Request Headers**:
- `Content-Type: application/json` (required)

**Status Codes**:
- `200 OK` - Backtest completed successfully
- `202 Accepted` - Backtest queued for processing (polling required)
- `400 Bad Request` - Invalid input parameters
- `422 Unprocessable Entity` - Validation failed (out-of-bounds values)
- `504 Gateway Timeout` - Execution timeout

**Error Response**:
```json
{
  "error": {
    "code": "VALIDATION_FLOAT_PRECISION",
    "http_status": 400,
    "message": "Field 'entry_price' must be a decimal string, not a float",
    "field": "entry_price",
    "timestamp": "2025-12-31T14:30:45.123Z"
  }
}
```

---

### GET /backtest/:request_id

Retrieve a previously executed backtest result by its request ID.

**Response** (HTTP 200):
```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "success",
  "events": [...],
  "final_position": {...},
  "pnl_summary": {...},
  "execution_time_ms": 245,
  "timestamp": "2025-12-31T14:30:45.123Z"
}
```

**Status Codes**:
- `200 OK` - Result retrieved successfully
- `400 Bad Request` - Invalid request_id format
- `404 Not Found` - Result not found (expired or invalid ID)

---

### GET /backtest

Query backtest results by date range with pagination and filtering.

**Query Parameters**:
- `from` (required): ISO-8601 date string (start of range)
- `to` (required): ISO-8601 date string (end of range)
- `status` (optional): Filter by status - `success`, `failed`, or `all` (default: `all`)
- `page` (optional): Page number, 0-indexed (default: `0`)
- `limit` (optional): Results per page, 1-100 (default: `50`)

**Example**:
```
GET /backtest?from=2025-12-30T00:00:00Z&to=2025-12-31T23:59:59Z&status=success&page=0&limit=50
```

**Response** (HTTP 200):
```json
{
  "results": [
    {
      "request_id": "550e8400-e29b-41d4-a716-446655440000",
      "status": "success",
      "timestamp": "2025-12-31T14:30:45.123Z",
      "total_pnl": "125.50000000",
      "roi_percent": "4.78",
      "total_fills": 2
    }
  ],
  "pagination": {
    "page": 0,
    "limit": 50,
    "total": 145,
    "page_count": 3
  }
}
```

**Status Codes**:
- `200 OK` - Results retrieved (may be empty array if no matches)
- `400 Bad Request` - Missing or invalid parameters
- `404 Not Found` - No results for date range

---

### GET /health

Check API health and dependencies status.

**Response** (HTTP 200):
```json
{
  "status": "healthy",
  "timestamp": "2025-12-31T14:30:45.123Z",
  "queue": {
    "depth": 0,
    "processed": 156,
    "failed": 2
  },
  "dependencies": {
    "core_engine": "available",
    "storage": "available",
    "cache": "available"
  },
  "uptime_seconds": 3600,
  "version": "0.1.0"
}
```

**Status Codes**:
- `200 OK` - Service is healthy or degraded but operational
- `503 Service Unavailable` - Service is unhealthy

---

## Data Types

### Decimal Values

All numeric values representing prices, quantities, and financial metrics are represented as **decimal strings** (not floats) to preserve precision. Strings must:
- Match the pattern: `/^[0-9]+\.[0-9]{8}$/`
- Represent a maximum of 8 decimal places
- Use period (`.`) as decimal separator

**Valid examples**:
- `"100.50000000"` ✓
- `"0.00000001"` ✓
- `"1000.12345678"` ✓

**Invalid examples**:
- `100.50` ✗ (float, not decimal string)
- `"100.5"` ✗ (fewer than 8 decimal places)
- `"100.500000000"` ✗ (more than 8 decimal places)

### BacktestRequest

```typescript
{
  entry_price: string;              // Initial entry price (decimal)
  amounts: string[];                // List of amounts to add at each sequence (decimals)
  sequences: number[];              // DCA sequence indices (0-based integers)
  leverage: string;                 // Leverage multiplier (decimal, typically 1-10)
  margin_ratio: string;             // Margin ratio (decimal, must be 0 <= x < 1)
  market_data_csv_path: string;     // Path to market data CSV file
  idempotency_key?: string;         // Optional idempotency key for deduplication
}
```

### BacktestResult

```typescript
{
  request_id: string;               // Unique UUID for this backtest
  status: "success" | "failed";     // Execution result
  events: BacktestEvent[];          // List of position-changing events
  final_position: PositionState;    // Final position after all operations
  pnl_summary: PnlSummary;          // Profit/loss summary
  execution_time_ms: number;        // Time to execute in milliseconds
  timestamp: string;                // ISO-8601 timestamp of execution
  error?: ErrorDetail;              // Error details if status is "failed"
}
```

### PnlSummary

```typescript
{
  total_pnl: string;                // Total profit/loss (decimal)
  entry_fee: string;                // Total entry fees (decimal)
  trading_fees: string;             // Total trading fees (decimal)
  total_fees: string;               // Combined fees (decimal)
  roi_percent: string;              // Return on investment percentage
  total_fills: number;              // Total number of fills executed
  realized_pnl: string;             // Realized profit/loss (decimal)
  safety_order_usage_counts: Record<string, number>;  // Usage count per sequence
}
```

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_MISSING_FIELD` | 400 | Required field is missing |
| `VALIDATION_FLOAT_PRECISION` | 400 | Decimal precision violation |
| `VALIDATION_OUT_OF_BOUNDS` | 422 | Value outside allowed range |
| `VALIDATION_TYPE_ERROR` | 400 | Wrong data type |
| `EXECUTION_TIMEOUT` | 504 | Execution exceeded time limit |
| `EXECUTION_BINARY_CRASH` | 500 | Core Engine crashed |
| `EXECUTION_OUT_OF_MEMORY` | 503 | Out of memory |
| `BINARY_FILE_NOT_FOUND` | 500 | Core Engine binary missing |
| `BINARY_PERMISSION_DENIED` | 500 | Cannot execute binary |
| `CSV_FILE_NOT_FOUND` | 400 | Market data file not found |
| `CSV_PARSE_ERROR` | 422 | Market data parsing failed |
| `STORAGE_WRITE_ERROR` | 500 | Failed to save result |
| `STORAGE_RETRIEVE_ERROR` | 500 | Failed to retrieve result |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected error |

---

## Rate Limiting

Currently, no rate limiting is enforced. However, the API:
- Processes requests in FIFO order
- Queues requests when worker threads are busy
- Returns queue depth in health endpoint

Future versions may implement:
- Per-client rate limiting
- Backpressure mechanisms
- Adaptive timeout

---

## Concurrency & Idempotency

### Concurrency

The API is designed for high concurrency:
- Multiple simultaneous requests are queued and processed in parallel
- Queue depth is reported in the health endpoint
- Each request maintains isolation (no data mixing)

### Idempotency

Requests can include an optional `idempotency_key` field:
- If provided, the API deduplicates requests with the same key
- Results are cached for 7 days by default
- Prevents duplicate backtest executions

**Example**:
```bash
curl -X POST http://localhost:3000/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "entry_price": "100.50000000",
    "amounts": ["10.25000000"],
    "sequences": [0],
    "leverage": "2.00000000",
    "margin_ratio": "0.75000000",
    "market_data_csv_path": "/data/BTCUSDT_1m.csv",
    "idempotency_key": "my-unique-key-12345"
  }'
```

---

## Examples

### Submit a Backtest

```bash
curl -X POST http://localhost:3000/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "entry_price": "50000.00000000",
    "amounts": ["1000.00000000", "1500.00000000"],
    "sequences": [0, 1],
    "leverage": "2.00000000",
    "margin_ratio": "0.50000000",
    "market_data_csv_path": "/data/BTCUSDT_1h.csv"
  }'
```

### Retrieve a Result

```bash
curl http://localhost:3000/backtest/550e8400-e29b-41d4-a716-446655440000
```

### Query Results

```bash
curl "http://localhost:3000/backtest?from=2025-12-01T00:00:00Z&to=2025-12-31T23:59:59Z&status=success&page=0&limit=25"
```

### Check Health

```bash
curl http://localhost:3000/health
```

---

## Notes

- All timestamps are in UTC (ISO-8601 format)
- Request IDs are UUIDs (RFC 4122 v4)
- Decimal values use period (`.`) as separator, not comma
- Results are stored for 7 days by default (configurable)
- The API requires the Core Engine binary to be available at the path specified by `CORE_ENGINE_BINARY_PATH` environment variable
