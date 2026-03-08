# Data Model: DCA Frontend Web Application

**Date**: March 8, 2026  
**Version**: 1.0  
**Scope**: Frontend entity definitions, state schemas, type interfaces

---

## Core Entities

### 1. BacktestConfiguration (Form Input)

**Description**: User-submitted parameters for a single backtest run

**Fields**:

```typescript
interface BacktestConfiguration {
  entryPrice: number;          // Base entry price (e.g., 100.00)
  amounts: number[];           // Array of order amounts (e.g., [50, 100, 150])
  sequences: number;           // Number of safety order sequences (e.g., 3)
  leverage: number;            // Leverage multiplier (e.g., 2.0 for 2x)
  marginRatio: number;         // Maintenance margin ratio as decimal (e.g., 0.5 for 50%) [0-1 range]
}
```

**Validation Rules**:
- `entryPrice`: Must be > 0 (decimal allowed); display format: 2 decimals
- `amounts`: Non-empty array; all elements > 0; max 10 elements; display format: 2 decimals per element
- `sequences`: Must be integer; > 0; typically 1-10
- `leverage`: Must be > 0 and <= max leverage (e.g., 10x); display format: 1-2 decimals
- `marginRatio`: Must be in range [0, 1); display as percentage (e.g., 0.5 = "50%")

**Default/Example Values**:
```typescript
const exampleConfig: BacktestConfiguration = {
  entryPrice: 100.0,
  amounts: [50, 100, 150],
  sequences: 3,
  leverage: 2.0,
  marginRatio: 0.5,
};
```

**State During Form**: Form state mirrors this interface; each field has `value` and `error` sub-fields

---

### 2. Backtest (API Entities)

#### 2a. Backtest Submission Response

**Description**: API response after submitting configuration

```typescript
interface BacktestSubmissionResponse {
  backtestId: string;          // Unique identifier (e.g., "abc123xyz789")
  status: 'pending';           // Always 'pending' at submission
  timestamp?: string;          // ISO 8601 submission timestamp (optional)
}
```

#### 2b. Backtest Status

**Description**: Current status of running backtest

```typescript
interface BacktestStatus {
  backtestId: string;
  status: 'pending' | 'completed' | 'failed';
  progress?: number;           // 0-100%, optional
  failureReason?: string;      // If status='failed', reason message
  estimatedRemaining?: number; // Seconds, optional
}
```

**State Transitions**:
```
pending (initial)
  ├─→ completed (on success)
  └─→ failed (on error)
```

#### 2c. Backtest Results (Main Entity)

**Description**: Complete backtest results including metrics and event history

```typescript
interface BacktestResults {
  backtestId: string;
  completedAt: string;         // ISO 8601 timestamp
  pnlSummary: PnlSummary;
  safetyOrderUsage: SafetyOrderUsage;
  tradeEvents: TradeEvent[];
}
```

---

### 3. PnlSummary (Results Component)

**Description**: Key profitability metrics

```typescript
interface PnlSummary {
  roi: number;                 // Return on Investment as percentage (e.g., 12.34 or -5.67)
  maxDrawdown: number;         // Maximum drawdown as percentage (e.g., -8.90)
  totalFees: number;           // Total fees incurred in base currency (e.g., 45.67)
  initialBalance?: number;     // Optional: starting balance
  finalBalance?: number;       // Optional: ending balance
  totalPnl?: number;           // Optional: total P&L in base currency
}
```

**Display Format**:
- `roi`: "12.34%" (green if >0, red if <0)
- `maxDrawdown`: "-8.90%" (always red/negative styling)
- `totalFees`: "$45.67" (currency symbol, 2 decimals)
- Initial/Final Balance: "$1000.00"
- Total PnL: "$123.45" (green if >0, red if <0)

**Color Coding**:
- Green (#10b981): Positive ROI, positive PnL
- Red (#ef4444): Negative ROI, negative PnL, Max Drawdown
- Gray (#6b7280): Neutral/fee metrics

---

### 4. SafetyOrderUsage (Results Component)

**Description**: Count of activations for each safety order level

```typescript
interface SafetyOrderUsage {
  [key: string]: number;       // e.g., { "SO1": 5, "SO2": 3, "SO3": 1 }
}

// Flattened for chart rendering:
interface SafetyOrderChartData {
  soLevel: string;             // e.g., "SO1"
  count: number;               // e.g., 5
  percentage?: number;         // e.g., 55.5% of total activations
}
```

**Example**:
```typescript
const safetyOrderUsage: SafetyOrderUsage = {
  "SO1": 5,
  "SO2": 3,
  "SO3": 1,
};

// Converted for Recharts:
const chartData: SafetyOrderChartData[] = [
  { soLevel: "SO1", count: 5, percentage: 55.5 },
  { soLevel: "SO2", count: 3, percentage: 33.3 },
  { soLevel: "SO3", count: 1, percentage: 11.1 },
];
```

**Edge Cases**:
- All counts = 0: Display message "No safety orders triggered"
- Missing SO levels: Display gaps in X-axis (expected behavior)

---

### 5. TradeEvent (Results Component)

**Description**: Single trade action in chronological sequence

```typescript
interface TradeEvent {
  timestamp: string;           // ISO 8601, e.g., "2024-01-15T14:30:45.123Z"
  eventType: 'entry' | 'safety' | 'exit' | 'liquidation';
  price: number;               // Execution price (8 decimals for crypto)
  quantity: number;            // Amount traded (8 decimals for crypto)
  balance: number;             // Account balance after trade (2 decimals)
  orderId?: string;            // Optional: order identifier
  notes?: string;              // Optional: human-readable notes
  fee?: number;                // Optional: fee for this trade
  pnl?: number;                // Optional: cumulative P&L at this point
}
```

**Display Format**:
- `timestamp`: "Jan 15, 2024 14:30:45 UTC" or "2024-01-15 14:30:45"
- `eventType`: "Entry", "Safety Order", "Exit", "Liquidation" (user-friendly)
- `price`: "0.00015634 BTC" (8 decimals for crypto quantities)
- `quantity`: "0.00015634 BTC"
- `balance`: "$1234.56" (2 decimals)
- `fee`: "$2.34" (2 decimals, if included)
- `pnl`: "$45.67" (colored: green if >, red if <0)

**Example**:
```typescript
const tradeEvent: TradeEvent = {
  timestamp: "2024-01-15T14:30:45.123Z",
  eventType: "entry",
  price: 100.0,
  quantity: 0.5,
  balance: 950.0,
  orderId: "order_001",
  fee: 0.5,
  pnl: 0,
};
```

---

## Frontend Application State

### App-Level State (Root Container)

```typescript
interface AppState {
  // Current view
  currentView: 'configuration' | 'polling' | 'results' | 'error';

  // Submitted backtest data
  backtestId: string | null;
  submittedConfig: BacktestConfiguration | null;
  results: BacktestResults | null;

  // UI state
  isLoading: boolean;
  error: AppError | null;
}

interface AppError {
  code: string;                // e.g., 'NETWORK_ERROR', 'TIMEOUT', 'API_ERROR'
  message: string;             // User-friendly message
  recoveryAction?: 'retry' | 'reset' | 'check_status';
  originalError?: Error;       // For debugging
}
```

### Form Component State

```typescript
interface FormState {
  values: BacktestConfiguration;
  errors: {
    entryPrice?: string;
    amounts?: string;
    sequences?: string;
    leverage?: string;
    marginRatio?: string;
  };
  touched: {
    entryPrice?: boolean;
    amounts?: boolean;
    sequences?: boolean;
    leverage?: boolean;
    marginRatio?: boolean;
  };
  isSubmitting: boolean;
  isValid: boolean;
}
```

### Polling Component State (via useBacktestPolling)

```typescript
interface PollingState {
  backtestId: string;
  status: 'pending' | 'completed' | 'failed';
  statusMessage: string;       // e.g., "Processing backtest..."
  elapsedSeconds: number;      // Time elapsed since polling started
  totalSeconds: number;        // Total allowed time (300 for 5 minutes)
  isPolling: boolean;
  errorMessage?: string;
  retryAttempt: number;        // Retry count
  progress?: number;           // 0-100%
}
```

---

## State Transitions & Lifecycle

### User Journey: Configuration → Polling → Results

```
┌──────────────────────────────────────────────────────────────┐
│ 1. APP INITIAL STATE                                          │
│ - currentView: 'configuration'                               │
│ - backtestId: null, results: null, error: null              │
│ - Render: ConfigurationForm                                 │
└──────────────────────────────────────────────────────────────┘
              ↓
         User fills form
              ↓
┌──────────────────────────────────────────────────────────────┐
│ 2. FORM SUBMISSION (Action: SUBMIT_CONFIG)                  │
│ - isLoading: true (disable submit button)                   │
│ - Validate form locally                                      │
│ - POST /backtest with config                                 │
└──────────────────────────────────────────────────────────────┘
              ↓
         API returns backtestId
              ↓
┌──────────────────────────────────────────────────────────────┐
│ 3. POLLING STATE (Action: POLLING_START)                    │
│ - currentView: 'polling'                                     │
│ - backtestId: "abc123xyz"                                   │
│ - submittedConfig: {entryPrice: 100, ...}                   │
│ - useBacktestPolling starts polling loop                     │
│ - Render: PollingIndicator + spinner + status msg           │
└──────────────────────────────────────────────────────────────┘
              ↓
    Poll GET /backtest/{id}/status every 2 seconds
              ↓
    ┌─────────────────────────────────────────────────────────┐
    │ Status Response: status='pending'                       │
    │ → Continue polling, update elapsedSeconds UI            │
    └─────────────────────────────────────────────────────────┘
              ↓
    ┌─────────────────────────────────────────────────────────┐
    │ [After ~300 seconds if no completion]                  │
    │ Status Response: Timeout threshold reached             │
    │ (Action: POLLING_TIMEOUT)                              │
    │ → Display timeout message with "Retry" button           │
    │ → User clicks "Retry" → restart from current timestamp │
    └─────────────────────────────────────────────────────────┘
              ↓
    ┌─────────────────────────────────────────────────────────┐
    │ Status Response: status='completed'                     │
    │ (Action: POLLING_SUCCESS)                               │
    │ → Fetch GET /backtest/{id}/results                      │
    │ → Store BacktestResults in App state                    │
    └─────────────────────────────────────────────────────────┘
              ↓
┌──────────────────────────────────────────────────────────────┐
│ 4. RESULTS VIEW                                              │
│ - currentView: 'results'                                    │
│ - results: {backtestId, pnlSummary, safetyOrderUsage, ...} │
│ - Render: ResultsDashboard                                  │
│   - PnlSummary metrics                                      │
│   - SafetyOrderChart (bar chart)                            │
│   - TradeEventsTable (paginated)                            │
│ - Action buttons:                                            │
│   - "Run New Backtest" → clear form, goto config           │
│   - "Modify & Re-run" → pre-populate form, goto config     │
└──────────────────────────────────────────────────────────────┘
```

### Error Paths

```
┌──────────────────────────────────────────────────────────────┐
│ ERROR: Submission Failed (Action: SUBMIT_ERROR)              │
│ - currentView: 'configuration'                               │
│ - error: {code: 'API_ERROR', message: '...'}               │
│ - Render: Form + error message                               │
│ - User retry: modify form or submit again                    │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ ERROR: Polling Failed (Action: POLLING_ERROR)                │
│ - currentView: 'polling'                                     │
│ - error: {code: 'NETWORK_ERROR', recoveryAction: 'retry'}  │
│ - Render: PollingPage + error message + "Retry" button      │
│ - Auto-retry up to 3x or user clicks "Retry"                │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ ERROR: API Returns status='failed'                            │
│ - currentView: 'polling'                                     │
│ - error: {code: 'BACKTEST_FAILED', message: API reason}    │
│ - Render: Error message + "Run New Backtest" button          │
└──────────────────────────────────────────────────────────────┘
```

---

## Data Flow Diagrams

### Submit → Poll → Results Flow

```
ConfigurationForm
  │
  ├─ onSubmit(config: BacktestConfiguration)
  │
  ├─→ backtest-api.submitBacktest(config)
  │   POST /backtest
  │   Request: { entryPrice, amounts, sequences, leverage, marginRatio }
  │   Response: { backtestId, status: 'pending' }
  │
  ├─→ App.setState({ currentView: 'polling', backtestId })
  │
  └─→ Render PollingPage
      │
      ├─→ useBacktestPolling({ backtestId, onComplete, onError, onTimeout })
      │
      ├─→ setInterval(() => {
      │     GET /backtest/{backtestId}/status
      │     if (status === 'completed')
      │       GET /backtest/{backtestId}/results
      │       App.setState({ currentView: 'results', results })
      │     else if (status === 'failed')
      │       App.setState({ error })
      │     else if (elapsed >= 5 min)
      │       App.setState({ error: 'TIMEOUT' })
      │   }, 2000)
      │
      └─→ Render ResultsDashboard
          │
          ├─ PnlSummary (displays roi, maxDrawdown, totalFees)
          ├─ SafetyOrderChart (bar chart of SO activations)
          └─ TradeEventsTable (paginated events)
```

### Virtual Scrolling for Large Trade Events

```
TradeEventsTable receives events: TradeEvent[]

if (events.length > 1000)
  ├─→ Render with react-window VirtualList
  │   - Only render visible rows (e.g., 20 at a time)
  │   - Scroll triggers re-render of new visible set
  │   - Maintains smooth 60fps scrolling
  │
else if (events.length > 100)
  ├─→ Render with pagination
  │   - 25 rows per page
  │   - Previous/Next buttons
  │   - Page numbers
  │
else
  └─→ Render all rows (no pagination)
```

---

## Type Definitions (TypeScript)

### Core Types

```typescript
// Configuration
export type BacktestConfiguration = {
  entryPrice: number;
  amounts: number[];
  sequences: number;
  leverage: number;
  marginRatio: number;
};

// Results
export type PnlSummary = {
  roi: number;
  maxDrawdown: number;
  totalFees: number;
  initialBalance?: number;
  finalBalance?: number;
  totalPnl?: number;
};

export type SafetyOrderUsage = Record<string, number>;

export type TradeEvent = {
  timestamp: string;
  eventType: 'entry' | 'safety' | 'exit' | 'liquidation';
  price: number;
  quantity: number;
  balance: number;
  orderId?: string;
  notes?: string;
  fee?: number;
  pnl?: number;
};

export type BacktestResults = {
  backtestId: string;
  completedAt: string;
  pnlSummary: PnlSummary;
  safetyOrderUsage: SafetyOrderUsage;
  tradeEvents: TradeEvent[];
};

// API Responses
export type BacktestSubmissionResponse = {
  backtestId: string;
  status: 'pending';
  timestamp?: string;
};

export type BacktestStatusResponse = {
  backtestId: string;
  status: 'pending' | 'completed' | 'failed';
  progress?: number;
  failureReason?: string;
  estimatedRemaining?: number;
};

// State
export type AppView = 'configuration' | 'polling' | 'results' | 'error';

export type AppErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'API_ERROR'
  | 'VALIDATION_ERROR'
  | 'BACKTEST_FAILED'
  | 'UNKNOWN_ERROR';

export type AppState = {
  currentView: AppView;
  backtestId: string | null;
  submittedConfig: BacktestConfiguration | null;
  results: BacktestResults | null;
  isLoading: boolean;
  error: {
    code: AppErrorCode;
    message: string;
    recoveryAction?: 'retry' | 'reset' | 'check_status';
  } | null;
};
```

---

## Validation Schemas

### Form Validation Logic

```typescript
const validateEntryPrice = (value: string | number): string | null => {
  const num = parseFloat(String(value));
  if (isNaN(num)) return 'Must be a valid number';
  if (num <= 0) return 'Must be greater than 0';
  return null;
};

const validateAmounts = (values: string[] | number[]): string | null => {
  if (!values || values.length === 0) return 'At least one amount required';
  if (values.length > 10) return 'Maximum 10 amounts allowed';
  for (const v of values) {
    const num = parseFloat(String(v));
    if (isNaN(num) || num <= 0) return 'All amounts must be positive numbers';
  }
  return null;
};

const validateSequences = (value: string | number): string | null => {
  const num = parseInt(String(value), 10);
  if (isNaN(num)) return 'Must be a valid integer';
  if (num <= 0) return 'Must be greater than 0';
  if (num > 10) return 'Typically limited to 10 sequences';
  return null;
};

const validateLeverage = (value: string | number): string | null => {
  const num = parseFloat(String(value));
  if (isNaN(num)) return 'Must be a valid number';
  if (num <= 0) return 'Must be positive';
  if (num > 10) return 'Leverage typically limited to 10x';
  return null;
};

const validateMarginRatio = (value: string | number): string | null => {
  const num = parseFloat(String(value));
  if (isNaN(num)) return 'Must be a valid percentage';
  if (num < 0 || num > 100) return 'Must be between 0% and 100%';
  return null;
};
```

---

## Summary

**Entity Map**:
- **Input**: BacktestConfiguration (form)
- **Submission**: BacktestSubmissionResponse (backtestId + status)
- **Polling**: BacktestStatus (updated status every 2s)
- **Results**: BacktestResults (metrics + events)
  - Components: PnlSummary, SafetyOrderUsage, TradeEvent[]
- **App State**: AppState (view routing + error handling)

**Lifecycle**:
1. User → Form (BacktestConfiguration)
2. Submit → backtestId returned
3. Poll → status='pending'/'completed'/'failed'
4. Results → PnlSummary + Chart + Table
5. Reset → back to Form

**Validation**: Client-side only (MVP); server also validates

**Formatting**:
- Currency: 2 decimals with symbol
- Crypto: 8 decimals
- Percentages: 2 decimals with %
- Timestamps: ISO 8601 or human-readable
- Colors: Green (profit), Red (loss)
