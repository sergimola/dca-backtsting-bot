# Quickstart: API Layer Development

**Feature**: 004-api-layer | **Phase**: Development Setup & Local Testing

---

## Overview

This guide gets you started developing and testing the API Layer locally. By the end, you'll have:
- ✅ Project initialized with TypeScript/Express
- ✅ Mocked Core Engine binary for development
- ✅ API running on `http://localhost:3000`
- ✅ Example requests/responses working
- ✅ Test suite passing

---

## Prerequisites

- **Node.js 18+** (LTS recommended)
- **npm** or **yarn** package manager
- **Git** (for version control)
- **curl** or **Postman** (for manual API testing)
- **Go 1.21+** (optional, for building Core Engine binary locally)

---

## 1. Project Setup

### 1.1 Create Project Structure

```bash
# From workspace root: d:/personal/bot-dca/dca-bot/DCA Backtesting bot
cd orchestrator

# Create api directory with npm project
mkdir -p api
cd api
npm init -y
```

### 1.2 Install Dependencies

```bash
npm install express decimal.js pino stream split2 --save
npm install --save-dev typescript ts-node @types/express @types/node jest ts-jest supertest @types/jest --save-dev
```

**Key Packages**:
- `express`: HTTP framework
- `decimal.js`: Fixed-point decimal arithmetic
- `pino`: Structured logging
- `split2`: Newline-delimited JSON parsing (ndjson)
- `jest`: Testing framework
- `supertest`: HTTP assertion library

### 1.3 Configure TypeScript

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### 1.4 Configure Jest

Create `jest.config.js`:

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  }
};
```

### 1.5 Update package.json

```json
{
  "scripts": {
    "start": "ts-node src/app.ts",
    "build": "tsc",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "dev": "ts-node --watch src/app.ts"
  }
}
```

---

## 2. Mock Core Engine Binary

For local development, create a mock binary that simulates Core Engine output without compiling Go:

Create `tests/fixtures/mock-core-engine.sh`:

```bash
#!/bin/bash
# Mock Core Engine - reads JSON from stdin, outputs ndjson events

set -e

# Read input config from stdin
input=$(cat)

# Output sample Event Bus events (ndjson) based on config
echo '{"type":"PositionOpened","timestamp":1704067200000,"entry_price":"100.50000000","initial_quantity":"10.00000000","position_id":"pos-001","position_state":{"status":"OPEN","quantity":"10.00000000","average_cost":"100.50000000","margin_ratio":"0.50000000","max_margin_ratio":"0.50000000","leverage":"2.00000000","total_fees":"1.00000000","last_update_time":1704067200000}}'

echo '{"type":"OrderFilled","timestamp":1704067260000,"order_id":"ord-001","price":"99.50000000","quantity":"10.25000000","fee":"0.25000000","position_state":{"status":"OPEN","quantity":"20.25000000","average_cost":"100.00000000","margin_ratio":"0.48000000","max_margin_ratio":"0.50000000","leverage":"2.00000000","total_fees":"1.25000000","last_update_time":1704067260000}}'

echo '{"type":"PositionClosed","timestamp":1704067320000,"close_price":"101.00000000","pnl":"15.50000000","close_reason":"take_profit","position_state":{"status":"CLOSED","quantity":"0.00000000","average_cost":"0.00000000","margin_ratio":"0.00000000","max_margin_ratio":"0.50000000","leverage":"2.00000000","total_fees":"1.25000000","last_update_time":1704067320000}}'
```

Make executable:

```bash
chmod +x tests/fixtures/mock-core-engine.sh
```

Set environment variable to use mock:

```bash
export CORE_BINARY_PATH=./tests/fixtures/mock-core-engine.sh
```

---

## 3. Create Core Application Files

### 3.1 Configuration (src/config/constants.ts)

```typescript
export const CONSTANTS = {
  EXECUTION_TIMEOUT_MS: 30000,     // 30 seconds
  RESULT_RETENTION_DAYS: 7,         // 7 days
  CONCURRENCY_AUTO_DETECT: true,
  MAX_CONCURRENCY: Math.max(2, require('os').cpus().length),
  DECIMAL_PLACES_PRICE: 8,
  DECIMAL_PLACES_CURRENCY: 2,
  API_PORT: process.env.PORT || 3000,
};
```

### 3.2 Type Definitions (src/types/index.ts)

Import contracts from `specs/004-api-layer/contracts/`:

```typescript
export * from '../../../specs/004-api-layer/contracts/backtest-request';
export * from '../../../specs/004-api-layer/contracts/trade-event';
export * from '../../../specs/004-api-layer/contracts/backtest-result';
export * from '../../../specs/004-api-layer/contracts/error-mapping';
export * from '../../../specs/004-api-layer/contracts/health-metrics';
```

### 3.3 Decimal Validator (src/utils/DecimalValidator.ts)

```typescript
import Decimal from 'decimal.js';

export class DecimalValidator {
  static isValidDecimal(value: unknown, maxPlaces: number = 8): value is string {
    if (typeof value !== 'string') return false;
    const regex = new RegExp(`^\\d+(\\.\\d{1,${maxPlaces}})?$`);
    return regex.test(value);
  }

  static validate(value: string, label: string): Decimal {
    if (!this.isValidDecimal(value)) {
      throw new Error(`${label} must be a decimal string, got: ${value}`);
    }
    return new Decimal(value);
  }
}
```

### 3.4 Express App (src/app.ts)

```typescript
import express from 'express';
import pino from 'pino';
import { CONSTANTS } from './config/constants';

const app = express();
const logger = pino();

app.use(express.json());

// POST /backtest
app.post('/backtest', async (req, res) => {
  const requestId = crypto.randomUUID();
  logger.info({ requestId }, 'POST /backtest received');

  // TODO: Validate request body
  // TODO: Queue backtest execution
  // TODO: Return result

  res.json({ request_id: requestId, status: 'received' });
});

// GET /backtest/:request_id
app.get('/backtest/:request_id', (req, res) => {
  // TODO: Fetch result from storage
  res.status(404).json({ error: { code: 'NOT_FOUND', http_status: 404 } });
});

// GET /health
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
  });
});

// Error handler middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', http_status: 500, message: err.message } });
});

const port = CONSTANTS.API_PORT;
app.listen(port, () => {
  logger.info(`API listening on port ${port}`);
});
```

---

## 4. Run Local Development

### 4.1 Start API Server

```bash
# From orchestrator/api directory
npm run dev

# Output:
# [12:00:00.123] INFO: API listening on port 3000
```

### 4.2 Test Basic Endpoint (curl)

```bash
# Health check
curl http://localhost:3000/health
# Response: {"status":"healthy","timestamp":"2024-01-01T12:00:00.000Z","uptime_seconds":5}

# Submit backtest (mock)
curl -X POST http://localhost:3000/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "entry_price": "100.50",
    "amounts": ["10.25", "10.25", "10.25"],
    "sequences": [0, 1, 2],
    "leverage": "2.0",
    "margin_ratio": "0.50",
    "market_data_csv_path": "data/BTCUSDT_1m.csv"
  }'
```

---

## 5. Run Tests

### 5.1 Unit Tests

```bash
npm run test

# Sample output:
# PASS  tests/unit/services/DecimalValidator.test.ts
# PASS  tests/integration/backtest.integration.test.ts
# Test Suites: 2 passed, 2 total
# Tests: 15 passed, 15 total
# Snapshots: 0 total
# Time: 0.845s
```

### 5.2 Write Your First Test

Create `tests/unit/services/DecimalValidator.test.ts`:

```typescript
import { DecimalValidator } from '../../../src/utils/DecimalValidator';

describe('DecimalValidator', () => {
  describe('isValidDecimal', () => {
    it('should accept stringified decimals', () => {
      expect(DecimalValidator.isValidDecimal('100.50', 8)).toBe(true);
      expect(DecimalValidator.isValidDecimal('0.00000001', 8)).toBe(true);
      expect(DecimalValidator.isValidDecimal('100', 8)).toBe(true);
    });

    it('should reject floats', () => {
      expect(DecimalValidator.isValidDecimal(100.50, 8)).toBe(false);
      expect(DecimalValidator.isValidDecimal(0.5, 8)).toBe(false);
    });

    it('should reject strings with too many decimal places', () => {
      expect(DecimalValidator.isValidDecimal('100.500000001', 8)).toBe(false);
    });

    it('should reject negative numbers', () => {
      expect(DecimalValidator.isValidDecimal('-100.50', 8)).toBe(false);
    });
  });

  describe('validate', () => {
    it('should throw on invalid input', () => {
      expect(() => DecimalValidator.validate(100.50 as any, 'price')).toThrow();
    });
  });
});
```

---

## 6. Example Requests/Responses

### 6.1 Successful Backtest

**Request**:
```bash
curl -X POST http://localhost:3000/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "entry_price": "100.50000000",
    "amounts": ["10.25000000", "10.25000000"],
    "sequences": [0, 1],
    "leverage": "2.00000000",
    "margin_ratio": "0.50000000",
    "market_data_csv_path": "/data/BTCUSDT_1m.csv"
  }'
```

**Response** (HTTP 200):
```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "success",
  "events": [
    {
      "type": "PositionOpened",
      "timestamp": 1704067200000,
      "entry_price": "100.50000000",
      "position_state": { /* ... */ }
    },
    {
      "type": "OrderFilled",
      "timestamp": 1704067260000,
      "price": "99.50000000",
      "quantity": "10.25000000"
    },
    {
      "type": "PositionClosed",
      "timestamp": 1704067320000,
      "close_price": "101.00000000",
      "pnl": "15.50000000"
    }
  ],
  "final_position": { /* ... */ },
  "pnl_summary": {
    "total_pnl": "15.50000000",
    "roi_percent": "5.50",
    "total_fees": "1.25000000"
  },
  "execution_time_ms": 250,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### 6.2 Validation Error

**Request** (float instead of string):
```bash
curl -X POST http://localhost:3000/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "entry_price": 100.50,  # ❌ FLOAT (should be string)
    "amounts": ["10.25"],
    ":sequences": [0],
    "leverage": "2.0",
    "margin_ratio": "0.50",
    "market_data_csv_path": "/data/..."
  }'
```

**Response** (HTTP 400):
```json
{
  "error": {
    "code": "VALIDATION_FLOAT_PRECISION",
    "http_status": 400,
    "message": "Field \"entry_price\" must be a decimal string, not a float. Example: \"100.50\"",
    "field": "entry_price"
  }
}
```

### 6.3 Missing Field Error

**Response** (HTTP 400):
```json
{
  "error": {
    "code": "VALIDATION_MISSING_FIELD",
    "http_status": 400,
    "message": "Missing required field: margin_ratio. Expected type: string",
    "field": "margin_ratio"
  }
}
```

### 6.4 Core Engine Timeout

**Response** (HTTP 504):
```json
{
  "error": {
    "code": "EXECUTION_TIMEOUT",
    "http_status": 504,
    "message": "Backtest execution exceeded 30-second timeout. Backtest too complex or data too large."
  }
}
```

---

## 7. Next Steps

- [ ] Implement POST /backtest endpoint with subprocess execution
- [ ] Implement EventBusParser for ndjson parsing
- [ ] Implement ProcessManager for concurrent request handling
- [ ] Implement ResultStore (file + SQLite persistence)
- [ ] Implement ErrorMapper for stderr → HTTP status mapping
- [ ] Implement GET /backtest/:id endpoint
- [ ] Implement GET /health endpoint
- [ ] Add BDD acceptance tests (User Story 1-5)
- [ ] Add load testing (User Story 2 - concurrency)
- [ ] Add integration tests with mocked binary
- [ ] Document API with OpenAPI/Swagger

---

## References

- **Contracts**: [contracts/](../contracts/)
- **Data Model**: [data-model.md](../data-model.md)
- **Specification**: [spec.md](../spec.md)
- **Implementation Plan**: [plan.md](../plan.md)
