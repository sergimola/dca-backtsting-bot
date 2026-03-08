# API Contract: DCA Frontend ↔ API Layer (Feature 004)

**Date**: March 8, 2026  
**Responsibility**: Feature 004 (API Layer) implements; Feature 005 (Frontend) consumes  
**Protocol**: HTTP REST with JSON payloads  
**Base URL**: Configurable via `VITE_API_BASE_URL` (default: http://localhost:3000)

---

## Endpoint 1: Submit Backtest Configuration

**Purpose**: Accept user-submitted backtest parameters and queue for processing

**HTTP Method**: `POST`  
**Path**: `/backtest`  
**Authentication**: None (MVP scope)

### Request

**Headers**:
```
Content-Type: application/json
```

**Body**:
```typescript
{
  "entryPrice": number,        // Required: > 0 (decimal allowed)
  "amounts": number[],         // Required: non-empty array, all elements > 0
  "sequences": number,         // Required: integer > 0
  "leverage": number,          // Required: > 0
  "marginRatio": number        // Required: 0 ≤ value < 1 (e.g., 0.5 for 50%)
}
```

**Example**:
```json
{
  "entryPrice": 100.00,
  "amounts": [50, 100, 150],
  "sequences": 3,
  "leverage": 2.0,
  "marginRatio": 0.5
}
```

### Response (Success)

**Status**: `201 Created`  
**Headers**:
```
Content-Type: application/json
```

**Body**:
```typescript
{
  "backtestId": string,        // Unique identifier for this backtest run
  "status": "pending",         // Always 'pending' on submission
  "timestamp"?: string         // Optional: ISO 8601 submission timestamp
}
```

**Example**:
```json
{
  "backtestId": "abc123xyz789",
  "status": "pending",
  "timestamp": "2024-03-08T14:30:45.123Z"
}
```

### Response (Validation Error)

**Status**: `400 Bad Request`  
**Body**:
```typescript
{
  "error": string,             // e.g., "Validation failed"
  "details": {
    "entryPrice"?: string,     // e.g., "Must be > 0"
    "amounts"?: string,        // e.g., "All amounts must be positive"
    "sequences"?: string,      // e.g., "Must be an integer"
    "leverage"?: string,       // e.g., "Must be > 0"
    "marginRatio"?: string     // e.g., "Must be between 0 and 1"
  }
}
```

**Example**:
```json
{
  "error": "Validation failed",
  "details": {
    "entryPrice": "Must be greater than 0"
  }
}
```

### Response (Server Error)

**Status**: `500 Internal Server Error`  
**Body**:
```typescript
{
  "error": string,             // e.g., "Internal server error"
  "message"?: string           // Optional: detailed error message
}
```

---

## Endpoint 2: Get Backtest Status

**Purpose**: Poll for current status of a submitted backtest (in-progress, completed, or failed)

**HTTP Method**: `GET`  
**Path**: `/backtest/{backtestId}/status`  
**Authentication**: None (MVP scope)

### Request

**Parameters**:
- `backtestId` (path): String identifier from submission response

**Example**:
```
GET /backtest/abc123xyz789/status
```

### Response (Success - Pending)

**Status**: `200 OK`  
**Body**:
```typescript
{
  "backtestId": string,        // Same as request parameter
  "status": "pending",
  "progress"?: number,         // Optional: 0-100% progress estimate
  "estimatedRemaining"?: number // Optional: estimated seconds remaining
}
```

**Example**:
```json
{
  "backtestId": "abc123xyz789",
  "status": "pending",
  "progress": 45,
  "estimatedRemaining": 30
}
```

### Response (Success - Completed)

**Status**: `200 OK`  
**Body**:
```typescript
{
  "backtestId": string,
  "status": "completed",
  "completedAt"?: string       // Optional: ISO 8601 completion timestamp
}
```

**Example**:
```json
{
  "backtestId": "abc123xyz789",
  "status": "completed",
  "completedAt": "2024-03-08T14:35:12.456Z"
}
```

### Response (Success - Failed)

**Status**: `200 OK`  
**Body**:
```typescript
{
  "backtestId": string,
  "status": "failed",
  "failureReason"?: string     // Optional: reason for failure
}
```

**Example**:
```json
{
  "backtestId": "abc123xyz789",
  "status": "failed",
  "failureReason": "Insufficient balance for entry order"
}
```

### Response (Not Found)

**Status**: `404 Not Found`  
**Body**:
```typescript
{
  "error": string              // e.g., "Backtest not found"
}
```

---

## Endpoint 3: Get Backtest Results

**Purpose**: Retrieve completed backtest results (metrics, chart data, event history)

**HTTP Method**: `GET`  
**Path**: `/backtest/{backtestId}/results`  
**Authentication**: None (MVP scope)

### Request

**Parameters**:
- `backtestId` (path): String identifier from submission response

**Example**:
```
GET /backtest/abc123xyz789/results
```

### Response (Success)

**Status**: `200 OK`  
**Headers**:
```
Content-Type: application/json
```

**Body**:
```typescript
{
  "backtestId": string,
  "completedAt": string,       // ISO 8601 completion timestamp
  
  "pnlSummary": {
    "roi": number,             // Return on Investment (percentage, e.g., 12.34 or -5.67)
    "maxDrawdown": number,     // Maximum drawdown (percentage, negative)
    "totalFees": number,       // Total fees in base currency
    "initialBalance"?: number, // Optional
    "finalBalance"?: number,   // Optional
    "totalPnl"?: number        // Optional: total P&L in base currency
  },
  
  "safetyOrderUsage": {
    [key: string]: number      // e.g., { "SO1": 5, "SO2": 3, "SO3": 1 }
  },
  
  "tradeEvents": [
    {
      "timestamp": string,     // ISO 8601, e.g., "2024-01-15T14:30:45.123Z"
      "eventType": string,     // 'entry' | 'safety' | 'exit' | 'liquidation'
      "price": number,         // Execution price (8 decimals for crypto)
      "quantity": number,      // Amount traded (8 decimals for crypto)
      "balance": number,       // Account balance after trade (2 decimals currency)
      "orderId"?: string,      // Optional: identifier
      "notes"?: string,        // Optional: human-readable notes
      "fee"?: number,          // Optional: fee for this trade
      "pnl"?: number           // Optional: cumulative P&L at this point
    },
    // ... more events
  ]
}
```

**Example**:
```json
{
  "backtestId": "abc123xyz789",
  "completedAt": "2024-03-08T14:35:12.456Z",
  
  "pnlSummary": {
    "roi": 12.34,
    "maxDrawdown": -8.90,
    "totalFees": 45.67,
    "initialBalance": 1000.00,
    "finalBalance": 1123.45,
    "totalPnl": 123.45
  },
  
  "safetyOrderUsage": {
    "SO1": 5,
    "SO2": 3,
    "SO3": 1
  },
  
  "tradeEvents": [
    {
      "timestamp": "2024-01-15T14:30:45.123Z",
      "eventType": "entry",
      "price": 100.0,
      "quantity": 0.5,
      "balance": 950.00,
      "orderId": "order_001",
      "fee": 0.50,
      "pnl": 0
    },
    {
      "timestamp": "2024-01-15T14:31:12.456Z",
      "eventType": "safety",
      "price": 99.0,
      "quantity": 1.0,
      "balance": 850.00,
      "orderId": "order_002",
      "fee": 0.85,
      "pnl": -1.00
    }
  ]
}
```

### Response (Not Ready)

**Status**: `202 Accepted` or `400 Bad Request`  
**Body**:
```typescript
{
  "error": string,             // e.g., "Backtest not yet completed"
  "status": string             // Current status (pending, failed, etc.)
}
```

### Response (Not Found)

**Status**: `404 Not Found`  
**Body**:
```typescript
{
  "error": string              // e.g., "Backtest not found"
}
```

---

## Error Handling Contract

### All Endpoints: Common Error Responses

**Network Timeout**: `Request timeout after 10 seconds`
- Frontend will retry with exponential backoff (max 3 attempts)
- User message: "Connection timeout. Retrying..."

**Connection Refused**: `Cannot connect to API`
- Frontend will display error
- User message: "Cannot connect to server. Please check your internet connection."

**CORS Error**: `No 'Access-Control-Allow-Origin' header`
- Backend must include CORS headers or frontend won't receive response
- User message: "API server misconfigured"

---

## Frontend Polling Flow (Using These Endpoints)

```
1. User submits form → POST /backtest
   Response: { backtestId: "abc123", status: "pending" }

2. Frontend stores backtestId and starts polling loop (every 2 seconds)

3. Loop: GET /backtest/{backtestId}/status
   Response 1-N: { status: "pending", progress: N% }
   → Continue polling

4. After 5 minutes without completion:
   → Trigger timeout (if still pending)

5. When status changes:
   If status = "completed":
     GET /backtest/{backtestId}/results
     → Display results dashboard
   
   If status = "failed":
     Display error message with failureReason
     → Offer "Run New Backtest" button

6. On error/network failure:
   → Auto-retry up to 3x
   → If all retries fail, display error with manual "Retry" button
```

---

## Backward Compatibility & Versioning

- **Current Version**: 1.0 (implicit)
- **Versioning Strategy**: Path-based versioning if needed (e.g., `/v2/backtest`)
- **Deprecation**: Breaking changes will be signaled 2 weeks in advance

---

## Security Considerations

- **HTTPS** (Production): All endpoints must use HTTPS in production
- **Rate Limiting**: Backend should implement rate limiting to prevent abuse
- **Input Validation**: Backend validates all input per above specifications
- **Authentication** (Future): OAuth2 or API key can be added when needed
- **CORS** (Development): Must allow http://localhost:5173 (or production domain)

---

## Testing

### Mock API (Development)

Use MSW (Mock Service Worker) to simulate API responses in tests:

```typescript
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const handlers = [
  http.post('*/backtest', () => {
    return HttpResponse.json({
      backtestId: 'mock-123',
      status: 'pending',
    });
  }),
  
  http.get('*/backtest/:backtestId/status', ({ params }) => {
    return HttpResponse.json({
      backtestId: params.backtestId,
      status: 'completed',
    });
  }),
  
  http.get('*/backtest/:backtestId/results', ({ params }) => {
    return HttpResponse.json({
      backtestId: params.backtestId,
      pnlSummary: { roi: 12.34, maxDrawdown: -8.90, totalFees: 45.67 },
      safetyOrderUsage: { SO1: 5, SO2: 3 },
      tradeEvents: [/* ... */],
    });
  }),
];

const server = setupServer(...handlers);
```

---

## Assumptions

1. Backend uses JSON for all request/response bodies
2. Backend validates all inputs before processing
3. Backend returns meaningful error messages (not generic "Error" messages)
4. Backend maintains backtest results for at least one session (until server restart)
5. Backtest processing completes within 5 minutes (typical case)
6. All numeric fields use standard JSON numbers (no BigInt for MVP)

---

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2024-03-08 | 1.0 | Initial API contract |
| TBD | 2.0 | Add pagination to tradeEvents if >1000 events expected |
| TBD | 2.1 | Add WebSocket support for real-time polling (future) |
