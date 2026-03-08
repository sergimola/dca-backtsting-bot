# Component Interface Contract: DCA Frontend React Components

**Date**: March 8, 2026  
**Scope**: Component prop types, render contracts, event handlers

---

## Component: ConfigurationForm

**Path**: `src/components/ConfigurationForm.tsx`  
**Purpose**: Render form for user input (Entry Price, Amounts, Sequences, Leverage, Margin Ratio)

### Props Interface

```typescript
interface ConfigurationFormProps {
  // Callbacks
  onSubmit: (config: BacktestConfiguration) => void;
  
  // Optional: pre-populate form (for "Modify & Re-run" flow)
  initialValues?: BacktestConfiguration;
  
  // Loading state
  isSubmitting?: boolean;
  
  // Error messages backend validation (optional)
  serverErrors?: Record<string, string>;
}
```

### Render Contract

```
┌─────────────────────────────────────────────────────┐
│         Configuration Form                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Entry Price: [          ]  Error msg (if invalid)  │
│                                                     │
│ Amounts: [50] [100] [150]  [+ Add]  [- Remove]    │
│          Error msg (if invalid)                    │
│                                                     │
│ Sequences: [    ]  Error msg (if invalid)         │
│                                                     │
│ Leverage: [    ]  Error msg (if invalid)          │
│                                                     │
│ Margin Ratio (%): [    ]  Error msg (if invalid)  │
│                                                     │
│ [Submit]  [Clear]                                  │
│ (Submit disabled if invalid or isSubmitting=true) │
│                                                    │
└─────────────────────────────────────────────────────┘
```

### Behavior

1. **Render**: Form fields with labels, input elements, error messages
2. **Validation**: On every keystroke, validate field (client-side, <100ms)
3. **Error Display**: Show error message below field if invalid
4. **Field Focus**: Show errors only for touched fields (or on blur)
5. **Submit Button**: 
   - Disabled if form invalid (`isSubmitting || !isValid`)
   - Shows loading state (spinner, "Submitting...") when `isSubmitting=true`
6. **Clear Button**: Reset all fields to defaults
7. **onSubmit**: Called with `BacktestConfiguration` object when user clicks "Submit"

### Initial Values

```typescript
const defaultValues: BacktestConfiguration = {
  entryPrice: 100,
  amounts: [50, 100, 150],
  sequences: 3,
  leverage: 2,
  marginRatio: 0.5,
};
```

### Validation Rules (Client-Side)

- `entryPrice`: Must be > 0 (decimal allowed, max 2 decimals display)
- `amounts`: Array with 1-10 elements, all > 0
- `sequences`: Integer 1-10
- `leverage`: Number > 0, typically 1-10
- `marginRatio`: 0 ≤ value < 100 (as percentage % displayed)

### Example Usage

```typescript
const handleFormSubmit = (config: BacktestConfiguration) => {
  // Send to API
  submitBacktest(config).then((response) => {
    setBacktestId(response.backtestId);
    setCurrentView('polling');
  });
};

<ConfigurationForm
  onSubmit={handleFormSubmit}
  isSubmitting={isLoading}
  serverErrors={apiErrors}
/>
```

---

## Component: PollingIndicator

**Path**: `src/components/PollingIndicator.tsx`  
**Purpose**: Display loading state during backtest polling with status message and elapsed time

### Props Interface

```typescript
interface PollingIndicatorProps {
  // Status info
  status: 'pending' | 'failed' | 'timeout';
  statusMessage: string;        // e.g., "Processing backtest..."
  elapsedSeconds: number;       // Seconds elapsed since polling started
  totalSeconds?: number;        // Total allowed (default 300 for 5 min)
  progress?: number;            // 0-100% (optional)
  
  // Error details (if status='failed' or 'timeout')
  errorMessage?: string;
  
  // Callbacks
  onRetry: () => void;
  onCancel: () => void;
  onCheckStatus?: () => void;   // For timeout state
}
```

### Render Contract

```
┌────────────────────────────────────────┐
│      Processing Backtest...            │
│                                        │
│      [Animated Spinner]                │
│                                        │
│  Elapsed: 45 seconds of 300 seconds   │
│  Progress: [████████░░░░░░░░░░] 45%   │
│                                        │
│  Status: Pending...                    │
│                                        │
│  [Retry]  [Cancel]                     │
│                                        │
└────────────────────────────────────────┘

(On Timeout: change message)
┌────────────────────────────────────────┐
│      Processing Taking Longer...       │
│                                        │
│  ⚠️ Backtest processing is taking     │
│     longer than expected (5+ minutes). │
│                                        │
│  [Retry]  [Check Status]  [Cancel]     │
│                                        │
└────────────────────────────────────────┘

(On Failed: show error)
┌────────────────────────────────────────┐
│      Backtest Failed                   │
│                                        │
│  ❌ Error: Insufficient balance       │
│                                        │
│  [Run New Backtest]  [Retry]           │
│                                        │
└────────────────────────────────────────┘
```

### Behavior

1. **Render Loading**: Spinner + status message + elapsed time counter
2. **Progress Bar**: Optional; updates in real-time
3. **Auto-update**: Every second, update elapsed time display
4. **Timeout Display**: After 5 minutes (300s), change message
5. **Error Display**: If `status='failed'`, show error message prominently
6. **Buttons**:
   - `onRetry()`: User clicks "Retry" → reset polling timer and restart
   - `onCancel()`: User clicks "Cancel" → return to configuration form
   - `onCheckStatus()`: For timeout state; manually check status once

### Colors

- **Normal**: Blue/neutral (loading)
- **Timeout**: Orange/warning (still waiting)
- **Failed**: Red/error (error message)

---

## Component: PnlSummary

**Path**: `src/components/PnlSummary.tsx`  
**Purpose**: Display profitability metrics (ROI, Max Drawdown, Total Fees)

### Props Interface

```typescript
interface PnlSummaryProps {
  pnlData: PnlSummary;         // { roi, maxDrawdown, totalFees, ... }
  showTooltips?: boolean;      // Default: true
}
```

### Render Contract

```
┌─────────────────────────────────────────────────────┐
│              Profit & Loss Summary                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ROI: 12.34% 📈        Max Drawdown: -8.90% 📉   │
│  (green if >0)         (always red/negative)      │
│                                                     │
│  Total Fees: $45.67                                │
│                                                     │
│  Initial Balance: $1,000.00                        │
│  Final Balance: $1,123.45                          │
│  Net P&L: +$123.45 (green)                        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Behavior

1. **Render Metrics**: Display ROI, Max Drawdown, Total Fees prominently
2. **Card Layout**: Each metric in separate card (TailwindCSS)
3. **Color Coding**:
   - ROI > 0: Green (#10b981) with upward arrow 📈
   - ROI < 0: Red (#ef4444) with downward arrow 📉
   - Max Drawdown: Always red (negative)
   - Fees: Gray/neutral
4. **Formatting**:
   - ROI: "12.34%"
   - Max Drawdown: "-8.90%"
   - Fees: "$45.67"
5. **Tooltips** (on hover):
   - ROI: "Return on Investment (percentage)"
   - Max Drawdown: "Maximum loss from peak to trough (%)"
   - Fees: "Total trading fees incurred"
6. **Optional Details**: Show initialBalance, finalBalance, totalPnL if provided

### Example Usage

```typescript
<PnlSummary
  pnlData={{
    roi: 12.34,
    maxDrawdown: -8.90,
    totalFees: 45.67,
    initialBalance: 1000,
    finalBalance: 1123.45,
  }}
  showTooltips={true}
/>
```

---

## Component: SafetyOrderChart

**Path**: `src/components/SafetyOrderChart.tsx`  
**Purpose**: Display Safety Order Usage as bar chart (with toggle to list view)

### Props Interface

```typescript
interface SafetyOrderChartProps {
  soUsageData: SafetyOrderUsage;  // { "SO1": 5, "SO2": 3, ... }
  initialViewMode?: 'chart' | 'list';  // Default: 'chart'
}
```

### Render Contract (Chart View)

```
┌──────────────────────────────────────────┐
│    Safety Order Usage                    │
│                                          │
│    Count                                 │
│      6 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁          │
│      5 ┃█████┃██████┃██████┃            │
│      4 ┃█████┃██████┃██████┃            │
│      3 ┃█████┃██████┃██████┃            │
│      2 ┃█████┃██████┃██████┃            │
│      1 ┃█████┃██████┃██████┃            │
│      0 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁              │
│        SO1   SO2   SO3   SO4             │
│                                          │
│  [📊 Chart] [📋 List]                   │
│                                          │
└──────────────────────────────────────────┘
```

### Render Contract (List View)

```
┌──────────────────────────────────────────┐
│    Safety Order Usage                    │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │ Safety Order Level │ Activations   │ │
│  ├────────────────────┼───────────────┤ │
│  │ SO1                │ 5             │ │
│  │ SO2                │ 3             │ │
│  │ SO3                │ 1             │ │
│  │ SO4                │ 0             │ │
│  └────────────────────────────────────┘ │
│                                          │
│  [📊 Chart] [📋 List]                   │
│                                          │
└──────────────────────────────────────────┘
```

### Behavior

1. **Default View**: Bar chart (via Recharts)
2. **Toggle Button**: Click to switch between chart and list view
3. **Chart Features**:
   - X-axis: Safety Order levels (SO1, SO2, SO3, ...)
   - Y-axis: Activation count
   - Hover tooltip: Show exact count
   - Color: Blue bars
4. **List View Features**:
   - Table with 2 columns: "Safety Order Level", "Activations"
   - Sorted by SO level
5. **Edge Cases**:
   - No data (all counts = 0): Display message "No safety orders triggered"
   - Single SO: Chart still renders correctly with one bar
   - Missing SO levels: Display gaps in chart (expected)

### Example Usage

```typescript
<SafetyOrderChart
  soUsageData={{ "SO1": 5, "SO2": 3, "SO3": 1 }}
  initialViewMode="chart"
/>
```

---

## Component: TradeEventsTable

**Path**: `src/components/TradeEventsTable.tsx`  
**Purpose**: Display chronological table of trade events (entries, exits, etc.)

### Props Interface

```typescript
interface TradeEventsTableProps {
  events: TradeEvent[];
  sortOrder?: 'asc' | 'desc';  // Default: 'asc' (oldest first)
  rowsPerPage?: number;         // Default: 25 (for pagination)
  enableVirtualScroll?: boolean; // Default: auto-detect based on event count
}
```

### Render Contract

```
┌──────────────────────────────────────────────────────────────────────┐
│ Trade Events Timeline                                                │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ Timestamp ▼ │ Event Type │ Price      │ Quantity   │ Balance      │
│─────────────┼────────────┼────────────┼────────────┼──────────────│
│ 2024-01-15  │ Entry      │ $100.00    │ 0.50 BTC   │ $950.00      │
│ 14:30:45    │            │            │            │              │
│─────────────┼────────────┼────────────┼────────────┼──────────────│
│ 2024-01-15  │ Safety     │ $99.00     │ 1.00 BTC   │ $850.00      │
│ 14:31:12    │ Order      │            │            │              │
│─────────────┼────────────┼────────────┼────────────┼──────────────│
│ 2024-01-15  │ Exit       │ $105.00    │ 1.50 BTC   │ $1,057.50    │
│ 14:45:22    │            │            │            │              │
│─────────────┼────────────┼────────────┼────────────┼──────────────│
│                                                                      │
│ [◄ Prev] [1] [2] [3] [Next ►]  Showing 1-25 of 523 rows            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Behavior

1. **Columns**: Timestamp, Event Type, Price, Quantity, Balance
2. **Sorting**: Click header to toggle sort order (▼ = descending, ▲ = ascending)
3. **Large Datasets**:
   - <100 rows: Render all
   - 100-1000 rows: Paginate (default 25 rows/page)
   - >1000 rows: Virtual scrolling (render only visible rows)
4. **Formatting**:
   - Timestamp: "2024-01-15 14:30:45" or "Jan 15, 2024 14:30 UTC"
   - Event Type: "Entry", "Safety Order", "Exit", "Liquidation"
   - Price: "$100.00" (2 decimals) OR "0.50 BTC" (8 decimals)
   - Quantity: "0.50 BTC" (8 decimals) OR "100 units"
   - Balance: "$1,000.00" (2 decimals, comma separators)
5. **Hover Tooltip** (optional): Show additional details (fee, order ID)
6. **Row Expansion** (optional): Click row to expand details pane

### Pagination

```
[◄ Prev] [1] [2] [3] ... [N] [Next ►]
```

- Prev/Next buttons enabled/disabled based on current page
- Show "Showing X-Y of Z rows" text

### Virtual Scrolling

For 1000+ rows, render only visible portion:
- Maintains 60fps scrolling
- Uses `react-window` library
- Rows re-render as you scroll

### Example Usage

```typescript
<TradeEventsTable
  events={tradeEvents}
  sortOrder="asc"
  rowsPerPage={25}
  enableVirtualScroll={true}
/>
```

---

## Component: ResultsDashboard

**Path**: `src/components/ResultsDashboard.tsx`  
**Purpose**: Container component that combines all results (metrics, chart, table)

### Props Interface

```typescript
interface ResultsDashboardProps {
  results: BacktestResults;
  onRunNew: () => void;        // Return to config form
  onModify: () => void;        // Pre-populate form with previous config
}
```

### Render Contract

```
┌─────────────────────────────────────────────────────────────────┐
│                     Backtest Results                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  PnlSummary (Metrics: ROI, Max Drawdown, Fees)          │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌────────────────────────┐  ┌─────────────────────────────┐ │
│  │ SafetyOrderChart       │  │ TradeEventsTable            │ │
│  │ (Bar Chart / List)     │  │ (Paginated or Virtual)      │ │
│  │                        │  │                             │ │
│  │                        │  │                             │ │
│  └────────────────────────┘  └─────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ [Run New Backtest]  [Modify & Re-run]                   │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Behavior

1. **Layout**: 
   - Top: PnlSummary (full width)
   - Middle: SafetyOrderChart (left) + TradeEventsTable (right) (2-column grid)
   - Bottom: Action buttons
2. **Responsive**: Stacks vertically on small screens
3. **Buttons**:
   - "Run New Backtest": Clears form and returns to configuration view
   - "Modify & Re-run": Pre-populates form with previous config, returns to config view

### Example Usage

```typescript
<ResultsDashboard
  results={backtestResults}
  onRunNew={() => {
    form.reset();
    setCurrentView('configuration');
  }}
  onModify={() => {
    form.setValues(previousConfig);
    setCurrentView('configuration');
  }}
/>
```

---

## Custom Hook: useBacktestPolling

**Path**: `src/hooks/useBacktestPolling.ts`  
**Purpose**: Encapsulate polling logic (2s intervals, 5m timeout, error handling)

### Hook Signature

```typescript
interface UseBacktestPollingProps {
  backtestId: string;
  onComplete: (results: BacktestResults) => void;
  onError: (error: AppError) => void;
  onTimeout: () => void;
  pollInterval?: number;       // Default: 2000 (ms)
  timeoutThreshold?: number;   // Default: 5*60*1000 (5 min, ms)
}

interface UseBacktestPollingReturn {
  isPolling: boolean;
  status: 'pending' | 'completed' | 'failed';
  elapsedSeconds: number;
  errorMessage?: string;
  retryAttempt: number;
  stop: () => void;            // Manually stop polling
  retry: () => void;           // Manually retry
}

function useBacktestPolling(props: UseBacktestPollingProps): UseBacktestPollingReturn
```

### Behavior

1. **Initialization**: On mount, start polling timer
2. **Polling Loop**:
   - Every `pollInterval` ms (default 2s), call GET `/backtest/{backtestId}/status`
   - Track elapsed time
3. **Success Path**:
   - When `status === 'completed'`, call `getResults()` then `onComplete(results)`
4. **Error Paths**:
   - Network error: Retry with exponential backoff (max 3 attempts)
   - If all retries fail: Call `onError(error)`
   - If API returns `status === 'failed'`: Call `onError(error)`
5. **Timeout Path**:
   - If `elapsedSeconds >= timeoutThreshold` (300s default): Call `onTimeout()`
6. **Cleanup**: On unmount or when polling completes, clear interval

### Return Values

- `isPolling`: true while polling active
- `status`: Current recognized status
- `elapsedSeconds`: Seconds since polling started
- `errorMessage`: Error message if any
- `retryAttempt`: Current retry count (0-3)
- `stop()`: Manually stop polling
- `retry()`: Manually restart polling

### Example Usage

```typescript
const polling = useBacktestPolling({
  backtestId,
  onComplete: (results) => {
    setResults(results);
    setCurrentView('results');
  },
  onError: (error) => {
    setError(error);
    setCurrentView('error');
  },
  onTimeout: () => {
    setError({ code: 'TIMEOUT', message: 'Backtest is taking longer than expected' });
  },
  pollInterval: 2000,
  timeoutThreshold: 5 * 60 * 1000,
});

// In JSX:
{polling.isPolling && (
  <PollingIndicator
    status={polling.status}
    elapsedSeconds={polling.elapsedSeconds}
    errorMessage={polling.errorMessage}
    onRetry={() => polling.retry()}
  />
)}
```

---

## Component Composition Example

```typescript
// App.tsx (Root component with state routing)
function App() {
  const [currentView, setCurrentView] = useState<'config' | 'polling' | 'results'>('config');
  const [backtestId, setBacktestId] = useState<string | null>(null);
  const [results, setResults] = useState<BacktestResults | null>(null);
  const [submittedConfig, setSubmittedConfig] = useState<BacktestConfiguration | null>(null);

  const handleFormSubmit = async (config: BacktestConfiguration) => {
    setSubmittedConfig(config);
    const response = await submitBacktest(config);
    setBacktestId(response.backtestId);
    setCurrentView('polling');
  };

  const handleNewBacktest = () => {
    setCurrentView('config');
    setResults(null);
    setBacktestId(null);
  };

  return (
    <main className="container mx-auto py-8">
      {currentView === 'config' && (
        <ConfigurationForm onSubmit={handleFormSubmit} initialValues={submittedConfig} />
      )}

      {currentView === 'polling' && backtestId && (
        <PollingPage
          backtestId={backtestId}
          onResults={(res) => {
            setResults(res);
            setCurrentView('results');
          }}
          onCancel={() => setCurrentView('config')}
        />
      )}

      {currentView === 'results' && results && (
        <ResultsDashboard
          results={results}
          onRunNew={handleNewBacktest}
          onModify={() => {
            setCurrentView('config');
            // Form will be pre-populated via initialValues
          }}
        />
      )}
    </main>
  );
}
```

---

## Testing Contract

Each component must be testable via React Testing Library:

```typescript
// Example: ConfigurationForm.test.tsx
test('renders form inputs', () => {
  render(<ConfigurationForm onSubmit={jest.fn()} />);
  expect(screen.getByLabelText(/Entry Price/i)).toBeInTheDocument();
});

test('calls onSubmit with valid config', () => {
  const handleSubmit = jest.fn();
  render(<ConfigurationForm onSubmit={handleSubmit} />);
  
  fireEvent.change(screen.getByLabelText(/Entry Price/i), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: /Submit/i }));
  
  expect(handleSubmit).toHaveBeenCalledWith(expect.objectContaining({ entryPrice: 100 }));
});
```

---

## Accessibility Requirements

All components MUST meet WCAG 2.1 AA:

- Form inputs: `<label htmlFor="id">` paired with `<input id="id" />`
- Buttons: Keyboard accessible (Tab, Enter)
- Color contrast: >=4.5:1 for text
- Semantic HTML: Use `<button>`, `<table>`, etc. (not all divs)
- ARIA attributes: `aria-label`, `aria-describedby`, `aria-live` where needed
- Tooltips: Dismiss on Escape, stay on hover

---

## Performance Requirements

- **Form Validation**: <100ms per keystroke
- **Component Render**: <500ms initial render
- **Chart Render**: <500ms (for 10 SO levels)
- **Table Render**: <2s for 1000 rows (with virtual scrolling)
- **Polling Updates**: No jank (non-blocking UI updates)
