# Implementation Tasks: DCA Frontend Web Application (Feature 005)

**Feature Branch**: `005-dca-frontend`  
**Status**: Ready for Phase 1 Implementation  
**Estimated Duration**: 15-18 days (10 phases)  
**Last Updated**: March 8, 2026

---

## Phase 1: Project Setup & Foundation

**Goal**: Initialize Vite project with TypeScript, TailwindCSS, Jest testing framework, and folder structure

**Independent Test Criteria**:
- Vite dev server starts successfully on localhost:5173
- TypeScript compiles without errors (strict mode enabled)
- Jest test suite runs (no tests yet)
- TailwindCSS classes are available in component files

**Implementation Tasks**:

- [x] T001 Create new Vite + React + TypeScript project at `frontend/` directory with command `npm create vite@latest frontend -- --template react-ts`
- [x] T002 Navigate to `frontend/` directory and install core dependencies: `npm install react react-dom axios recharts`
- [x] T003 Install dev dependencies: `npm install -D @types/react @types/react-dom typescript @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint prettier jest @testing-library/react @testing-library/jest-dom ts-jest @types/jest`
- [x] T004 Install TailwindCSS: `npm install -D tailwindcss postcss autoprefixer`
- [x] T005 Configure TypeScript strict mode in `frontend/tsconfig.json`: enable `strict: true`, `esModuleInterop: true`, `module: es2020`, `target: es2020`, `lib: ["es2020", "dom", "dom.iterable"]`
- [x] T006 Create `frontend/tailwind.config.ts` with custom colors: `success: { 50: '#f0fdf4', 500: '#22c55e', 900: '#166534' }`, `danger: { 50: '#fef2f2', 500: '#ef4444', 900: '#7f1d1d' }`
- [x] T007 Create `frontend/postcss.config.js` with TailwindCSS and Autoprefixer plugins
- [x] T008 Create `frontend/src/index.css` with `@tailwind base; @tailwind components; @tailwind utilities;`
- [x] T009 Create `.eslintrc.json` in `frontend/` with rules for React, TypeScript, and code quality
- [x] T010 Create `frontend/jest.config.js` with Jest configuration for React + TypeScript (preset: `ts-jest`, testEnvironment: `jsdom`, setupFilesAfterEnv: `["@testing-library/jest-dom"]`)
- [x] T011 Update `frontend/package.json` scripts: `"dev": "vite"`, `"build": "tsc && vite build"`, `"test": "jest"`, `"test:watch": "jest --watch"`, `"test:coverage": "jest --coverage"`, `"lint": "eslint src --ext .ts,.tsx"`, `"lint:fix": "eslint src --ext .ts,.tsx --fix"`
- [x] T012 Create folder structure: `src/{components,hooks,services,pages,styles,__tests__/{components,hooks,services,integration}}`
- [x] T013 Create `frontend/src/main.tsx` entry point that renders App component into root div
- [x] T014 Create `frontend/src/App.tsx` stub with text "DCA Frontend Loading..." (placeholder)
- [x] T015 Update `frontend/index.html` entry point to load `main.tsx`
- [x] T016 Create `.gitignore` for `frontend/` with entries: `node_modules/`, `dist/`, `.env.local`, `coverage/`, `*.log`
- [x] T017 Create `frontend/.env.example` with sample API configuration: `VITE_API_BASE_URL=http://localhost:4000/api`
- [x] T018 Create `frontend/README.md` with setup instructions, npm scripts, and local development guide

**Visual Verification Task (End of Phase 1)**:

- [x] T019 [P] **VISUAL: Start Vite dev server and verify localhost:5173 loads**
  - Command: `cd frontend && npm run dev`
  - Verify in browser (localhost:5173):
    - Page loads without 404 errors
    - "DCA Frontend Loading..." text appears on screen
    - Browser console shows no errors (use Playwright to check console)
    - Page title matches project (check document.title)
  - Take screenshot confirming page renders
  - Verify file: `frontend/src/App.tsx` compiles successfully (check Vite terminal output for "ready in Xms")

---

## Phase 2: Form State Management & Validation Hook

**Goal**: Implement `useFormValidation` hook and create configuration types for reusable form handling

**Independent Test Criteria**:
- `useFormValidation` hook validates all 5 input fields correctly (<100ms)
- Validation returns correct error messages and touched field state
- Hook can be called multiple times with different values
- All validation tests pass (>90% coverage)

**Implementation Tasks**:

- [x] T020 Create `frontend/src/services/types.ts` with TypeScript interfaces:
  - `BacktestConfiguration { entryPrice: number; amounts: number[]; sequences: number; leverage: number; marginRatio: number; }`
  - `BacktestResults { backtestId: string; pnlSummary: PnlSummary; safetyOrderUsage: SafetyOrderUsage[]; tradeEvents: TradeEvent[]; }`
  - `PnlSummary { roi: number; maxDrawdown: number; totalFees: number; }`
  - `SafetyOrderUsage { level: string; count: number; }`
  - `TradeEvent { timestamp: string; eventType: string; price: number; quantity: number; balance: number; }`
- [x] T021 Create `frontend/src/hooks/useFormValidation.ts` hook with validation logic:
  - Input parameters: `values: Partial<BacktestConfiguration>`, `touched: Record<string, boolean>`
  - Validation rules (must return errors within 100ms):
    - `entryPrice > 0` (decimal allowed, max 2 decimals)
    - `amounts`: non-empty array, all values > 0
    - `sequences`: integer 1-10
    - `leverage > 0` (typically 1-10)
    - `marginRatio: 0 <= value < 100` (percentage)
  - Return: `{ isValid: boolean; errors: Record<string, string>; }`
- [x] T022 Create unit tests for `useFormValidation` in `frontend/src/__tests__/hooks/useFormValidation.test.ts`:
  - Test valid input (all fields correct) → `isValid: true`, `errors: {}`
  - Test invalid entry price (0 or negative) → error message "Entry Price must be greater than 0"
  - Test empty amounts array → error message "At least one amount is required"
  - Test invalid sequences (0, > 10, or non-integer) → error messages
  - Test invalid leverage (0 or negative) → error message
  - Test invalid margin ratio (-1 or > 100) → error messages
  - Test that validation completes in <100ms
- [x] T023 [P] Create `frontend/src/services/formatters.ts` with formatting utility functions:
  - `formatCurrency(amount: number, decimals?: number): string` → e.g., "$1234.56"
  - `formatCryptoQuantity(amount: number, decimals?: number): string` → e.g., "0.12345678"
  - `formatPercentage(value: number, decimals?: number): string` → e.g., "12.34%"
- [x] T024 [P] Create unit tests for formatters in `frontend/src/__tests__/services/formatters.test.ts`:
  - `formatCurrency(1234.5678) → "$1234.57"` (rounded to 2 decimals)
  - `formatCryptoQuantity(0.123456789) → "0.12345679"` (rounded to 8 decimals)
  - `formatPercentage(12.3456) → "12.35%"` (rounded to 2 decimals)
- [x] T025 [P] Run tests: `cd frontend && npm test` → verify all validation and formatter tests pass

---

## Phase 3: API Service Layer & HTTP Client

**Goal**: Implement API communication module for backtest submission, status polling, and results retrieval

**Independent Test Criteria**:
- `backtest-api.ts` exports 3 functions: `submitBacktest`, `getStatus`, `getResults`
- All functions use axios with correct endpoints (/backtest, status, results)
- Mocked API tests verify request/response handling
- Error handling returns descriptive error messages

**Implementation Tasks**:

- [ ] T026 Create `frontend/src/services/backtest-api.ts` with HTTP client:
  - Initialize axios instance with base URL from env: `process.env.VITE_API_BASE_URL || 'http://localhost:4000/api'`
  - Implement `submitBacktest(config: BacktestConfiguration): Promise<{ backtestId: string }>`
    - POST to `/backtest`
    - Send config as JSON body
    - Validate response has `backtestId` field
    - Throw error if status !== 201
  - Implement `getStatus(backtestId: string): Promise<{ status: string }>`
    - GET `/backtest/{backtestId}/status`
    - Return `{ status: 'pending' | 'completed' | 'failed' }`
    - Throw error if status !== 200
  - Implement `getResults(backtestId: string): Promise<BacktestResults>`
    - GET `/backtest/{backtestId}/results`
    - Return full BacktestResults object
    - Throw error if status !== 200 or malformed response
- [ ] T027 Create unit tests for backtest-api in `frontend/src/__tests__/services/backtest-api.test.ts`:
  - Mock axios responses using jest.mock()
  - Test submitBacktest success: POST called with correct URL and body, returns backtestId
  - Test submitBacktest error: handles 400 (validation error) → throw with message
  - Test submitBacktest error: handles 500 (server error) → throw with message
  - Test getStatus success: GET called with correct URL, returns status
  - Test getStatus error: handles 404 (backtest not found) → throw with message
  - Test getResults success: GET called with correct URL, returns BacktestResults
  - Test getResults error: handles malformed response → throw with error message
- [ ] T028 Create mock API handlers in `frontend/src/services/mock-api.ts`:
  - Mock submitBacktest: delay 500ms, return backtestId
  - Mock getStatus: simulate pending → completed progression (3 calls pending, 4th completed)
  - Mock getResults: return sample BacktestResults object with realistic data
  - Mock error scenarios (optional for manual testing)
- [ ] T029 [P] Run tests: `cd frontend && npm test` → verify all backtest-api tests pass

---

## Phase 4: Configuration Form Component

**Goal**: Implement ConfigurationForm component with 5 input fields, validation, and submission handler

**Independent Test Criteria**:
- Form renders all 5 input fields with correct labels
- Form validation triggers on input change (shows errors for invalid fields)
- Submit button disabled when form invalid or submitting
- onSubmit callback fires with correct BacktestConfiguration object
- Form can be reset via Clear button

**Implementation Tasks**:

- [X] T030 Create `frontend/src/components/ConfigurationForm.tsx` React component:
  - Props: `{ onSubmit: (config: BacktestConfiguration) => void; initialValues?: BacktestConfiguration; isSubmitting?: boolean; serverErrors?: Record<string, string>; }`
  - State: `{ values: BacktestConfiguration, touched: Record<string, boolean>, errors: Record<string, string>, isValid: boolean }`
  - Render form with 5 input fields:
    1. Entry Price: `<input type="number" step="0.01" placeholder="100" />`
    2. Amounts Array: Multiple `<input type="number" />` fields with [+Add] [- Remove] buttons
    3. Sequences: `<input type="number" step="1" min="1" max="10" />`
    4. Leverage: `<input type="number" step="0.1" />`
    5. Margin Ratio (%): `<input type="number" step="0.1" min="0" max="100" />`
  - Each field has: label, input, error message (if error), touched field styling
  - Submit button: `disabled={!isValid || isSubmitting}`
  - Clear button: reset form to initial values
  - Use TailwindCSS classes for styling: `m-4`, `p-4`, `border`, `rounded`, `bg-red-50` (for errors)
- [X] T031 Implement form validation integration: call `useFormValidation` on every field change
- [X] T032 [P] Implement Amounts array handling: allow users to add/remove amounts dynamically:
  - [+Add] button creates new input field
  - [- Remove] button for each amount (can't remove if only 1 amount)
  - Show validation errors if any amount is invalid
- [X] T033 [P] Create `frontend/src/components/FormInput.tsx` reusable input sub-component:
  - Props: `{ label: string; type: string; value: any; onChange: (value: any) => void; error?: string; touched?: boolean; placeholder?: string; ...inputProps }`
  - Render: label, input field, error message (in red if error & touched)
- [X] T034 Create component tests for ConfigurationForm in `frontend/src/__tests__/components/ConfigurationForm.test.tsx`:
  - Test render: form displays all 5 fields with labels
  - Test input change: typing in field updates value and triggers validation
  - Test validation error display: invalid field shows error message in red
  - Test submit disabled: form invalid → submit button disabled
  - Test submit enabled: form valid → submit button enabled
  - Test submit click: onSubmit callback fires with correct BacktestConfiguration
  - Test clear button: click clear → all fields reset to defaults
  - Test initialValues: form pre-populates when initialValues prop provided
  - Test isSubmitting: submit button shows spinner when isSubmitting=true
- [X] T035 [P] Run tests: `cd frontend && npm test -- components/ConfigurationForm` → verify all form tests pass

---

## Phase 5: App Root Component & View Router

**Goal**: Implement App.tsx as state root with conditional view rendering (Configuration → Polling → Results)

**Independent Test Criteria**:
- App renders ConfigurationPage initially
- App transitions to PollingPage after form submission
- App transitions to ResultsPage after polling completes
- App state persists backtestId and results during session

**Implementation Tasks**:

- [ ] T036 Create `frontend/src/App.tsx` root component with state machine:
  - State: `{ currentView: 'configuration' | 'polling' | 'results'; backtestId: string | null; results: BacktestResults | null; submittedConfig: BacktestConfiguration | null; error: string | null }`
  - Actions: `{ submitConfig, startPolling, pollingSuccess, pollingError, pollingTimeout, resetForm, modifyConfig }`
  - Conditional render:
    - currentView === 'configuration' → render ConfigurationPage
    - currentView === 'polling' → render PollingPage
    - currentView === 'results' → render ResultsPage
    - error → render error message overlay with retry/dismiss options
- [ ] T037 Create `frontend/src/pages/ConfigurationPage.tsx` container:
  - Props: `{ onSubmit: (config: BacktestConfiguration) => void; initialValues?: BacktestConfiguration; error?: string; }`
  - Render: ConfigurationForm component
  - On form submit: call onSubmit(config)
  - Display server errors if provided (from API response)
- [ ] T038 Create `frontend/src/pages/PollingPage.tsx` stub (placeholder for Phase 3):
  - Props: `{ backtestId: string; onComplete: (results: BacktestResults) => void; onError: (error: Error) => void; onTimeout: () => void; }`
  - Render: "Polling..." text placeholder
- [ ] T039 Create `frontend/src/pages/ResultsPage.tsx` stub (placeholder for Phase 4):
  - Props: `{ results: BacktestResults; onReset: () => void; onModify: (config: BacktestConfiguration) => void; }`
  - Render: "Results..." text placeholder
- [ ] T040 Create integration test for App state machine in `frontend/src/__tests__/integration/app-state.test.tsx`:
  - Test initial view: App renders ConfigurationPage
  - Test submit transition: ConfigurationPage → PollingPage
  - Test polling success transition: PollingPage → ResultsPage (with mock polling)
  - Test reset: ResultsPage → ConfigurationPage (form cleared)
  - Test modify: ResultsPage → ConfigurationPage (form pre-populated)
- [ ] T041 [P] Run tests: `cd frontend && npm test -- integration/app-state` → verify state transitions pass

---

## Phase 6: useBacktestPolling Custom Hook

**Goal**: Implement core polling hook with 2-second intervals, 5-minute timeout, and automatic status transitions

**Independent Test Criteria**:
- Hook starts polling on mount
- Hook polls at 2-second intervals
- Hook calls onComplete when status='completed'
- Hook calls onError when status='failed' or network error
- Hook calls onTimeout when 5 minutes elapsed
- Hook stops polling on unmount
- All polling tests pass with mocked API

**Implementation Tasks**:

- [ ] T042 Create `frontend/src/hooks/useBacktestPolling.ts` custom hook:
  - Props: `{ backtestId: string; onComplete: (results: BacktestResults) => void; onError: (error: Error) => void; onTimeout: () => void; pollInterval?: number = 2000; timeoutThreshold?: number = 5*60*1000; }`
  - Internal state: `{ isPolling: boolean; status: string; elapsedSeconds: number; retryAttempt: number }`
  - Return: `{ isPolling, status, elapsedSeconds, progress: number (0-100), retryAttempt }`
  - Initialize useEffect: start polling loop on mount
  - Polling logic:
    1. If elapsedSeconds >= timeoutThreshold → call onTimeout(), stop polling
    2. GET `/backtest/{backtestId}/status`
    3. If response.status === 'completed':
       - GET `/backtest/{backtestId}/results`
       - Call onComplete(results)
       - Stop polling
    4. If response.status === 'failed':
       - Extract error message from response
       - Call onError(new Error(message))
       - Stop polling
    5. If response.status === 'pending':
       - Continue polling
    6. If network error:
       - Retry up to 2 times with exponential backoff (2s, 4s, 8s)
       - If all retries fail: call onError(networkError), stop polling
  - Cleanup: clear interval on unmount
- [ ] T043 Create unit tests for useBacktestPolling in `frontend/src/__tests__/hooks/useBacktestPolling.test.ts`:
  - Test polling starts on mount: verify getStatus called after pollInterval
  - Test polling interval: 2 calls to getStatus should be ~2000ms apart
  - Test status pending: multiple pending responses continue polling
  - Test status completed: onComplete called with results
  - Test status failed: onError called with failure message
  - Test timeout triggers after 5 minutes: onTimeout called, polling stops
  - Test network error retry: network error → retry → success (or fail after 2 retries)
  - Test cleanup: polling stops on unmount
  - Mock API responses using jest.mock() or MSW
- [ ] T044 [P] Run tests: `cd frontend && npm test -- hooks/useBacktestPolling` → verify all polling tests pass

---

## Phase 7: PollingIndicator Component

**Goal**: Implement loading/status display component with progress, elapsed time, and action buttons

**Independent Test Criteria**:
- Component renders spinner and status message
- Component displays elapsed time and progress percentage
- Component displays error message when status='timeout' or 'failed'
- Action buttons (Retry, Cancel, Check Status) work correctly
- Component handles all status states (pending, timeout, failed)

**Implementation Tasks**:

- [ ] T045 Create `frontend/src/components/PollingIndicator.tsx` component:
  - Props: `{ status: 'pending' | 'timeout' | 'failed'; statusMessage: string; elapsedSeconds: number; totalSeconds?: number; errorMessage?: string; onRetry: () => void; onCancel: () => void; onCheckStatus?: () => void; }`
  - Render:
    - Animated spinner (CSS animation or SVG)
    - Status message: e.g., "Processing backtest..."
    - Progress display: "Elapsed: 45 seconds of 300 seconds"
    - Progress bar: TailwindCSS gradient (blue initially, red at 5 min)
    - Conditional buttons:
      - Always: [Cancel] button
      - status='pending': [Retry] button (optional, for manual retry)
      - status='timeout' or 'failed': [Retry] button (restart polling), [Check Status] button (optional)
    - If errorMessage: display error text in red
  - Use TailwindCSS for: flex layout, text sizes, colors, animations
  - Optional: add percentage progress indicator (45% of 300s = 15%)
- [ ] T046 [P] Create CSS animation for spinner in `frontend/src/styles/spinner.css`:
  - Keyframe animation: rotate 360° over 1s, repeat infinite
  - Or use inline TailwindCSS animate utilities
- [ ] T047 Create component tests for PollingIndicator in `frontend/src/__tests__/components/PollingIndicator.test.tsx`:
  - Test render: spinner and status message display
  - Test progress display: elapsed time shows correctly
  - Test pending state: shows "Processing..." message and Retry button
  - Test timeout state: shows timeout message and Retry + Check Status buttons
  - Test action buttons: onRetry, onCancel called when buttons clicked
  - Test error message: errorMessage prop displays in red
- [ ] T048 [P] Run tests: `cd frontend && npm test -- components/PollingIndicator` → verify all tests pass

---

## Phase 8: Update PollingPage with useBacktestPolling Hook

**Goal**: Wire PollingPage component with useBacktestPolling hook to create functional polling flow

**Independent Test Criteria**:
- PollingPage renders PollingIndicator with hook status
- PollingPage calls onComplete when polling succeeds
- PollingPage calls onError when polling fails
- PollingPage calls onTimeout when 5 minutes elapsed
- Manual Retry button restarts polling from current timestamp

**Implementation Tasks**:

- [ ] T049 Update `frontend/src/pages/PollingPage.tsx` to integrate useBacktestPolling:
  - Props: `{ backtestId: string; onComplete: (results: BacktestResults) => void; onError: (error: Error) => void; onTimeout: () => void; }`
  - Use `useBacktestPolling` hook: call hook with backtestId and callbacks
  - Destructure hook return: `{ isPolling, status, elapsedSeconds, progress, retryAttempt }`
  - Render PollingIndicator with hook state:
    - status, statusMessage (from hook or custom), elapsedSeconds, totalSeconds (300)
    - onRetry: call hook's restart function (or just let user navigate back and resubmit)
    - onCancel: call onCancel callback (transition back to ConfigurationPage)
  - Handle retry: user clicks [Retry] → reset polling (clear elapsed time, restart polling)
- [ ] T050 Create integration test for PollingPage in `frontend/src/__tests__/integration/polling-flow.test.tsx`:
  - Test polling success: PollingPage receives backtestId → polls → onComplete called with results
  - Test polling timeout: 5 minutes elapses → onTimeout called
  - Test user cancel: user clicks Cancel → component cleanup, stops polling
  - Test manual retry: user clicks Retry → polling restarts
  - Mock getStatus and getResults using jest.mock()
- [ ] T051 [P] Run tests: `cd frontend && npm test -- integration/polling-flow` → verify all polling integration tests pass

---

## Phase 9: PnlSummary Component

**Goal**: Implement metrics display component showing ROI, Max Drawdown, Total Fees with color-coded values

**Independent Test Criteria**:
- Component renders 3 metrics: ROI, Max Drawdown, Total Fees
- Component displays values with correct formatting (percentages, currency)
- Component color-codes positive values (green) and negative values (red)
- Component displays tooltips on hover explaining each metric

**Implementation Tasks**:

- [ ] T052 Create `frontend/src/components/MetricCard.tsx` reusable metric component:
  - Props: `{ label: string; value: number; unit: string; color?: 'success' | 'danger' | 'neutral'; tooltip?: string; }`
  - Render:
    - Label text (left-aligned)
    - Value with unit (e.g., "+12.34%") (right-aligned, bold)
    - Apply color: success → green (text-green-600), danger → red (text-red-600), neutral → gray
    - Tooltip on hover: show explanation (if tooltip prop provided)
  - Use TailwindCSS: flex, justify-between, text sizes, colors
- [ ] T053 Create `frontend/src/components/PnlSummary.tsx` component:
  - Props: `{ pnlData: PnlSummary }`
  - Render 3 MetricCards:
    1. ROI: value = pnlData.roi, unit = "%", color = roi >= 0 ? 'success' : 'danger', tooltip = "Return on Investment percentage"
    2. Max Drawdown: value = pnlData.maxDrawdown, unit = "%", color = 'danger', tooltip = "Maximum peak-to-trough decline during backtest"
    3. Total Fees: value = formatCurrency(pnlData.totalFees), unit = "", color = 'neutral', tooltip = "Total trading fees paid"
  - Layout: TailwindCSS grid or flex (3 columns, responsive)
  - Title: "Profit & Loss Summary" or similar
- [ ] T054 Create component tests for PnlSummary in `frontend/src/__tests__/components/PnlSummary.test.tsx`:
  - Test render: 3 metrics display
  - Test positive ROI: displays green color
  - Test negative ROI: displays red color
  - Test formatting: ROI displays as percentage, fees formatted as currency
  - Test tooltip: hover shows explanation (if using HTML title attribute or external tooltip library)
- [ ] T055 [P] Create component tests for MetricCard in `frontend/src/__tests__/components/MetricCard.test.tsx`:
  - Test success color: color='success' → text-green-600 class applied
  - Test danger color: color='danger' → text-red-600 class applied
- [ ] T056 [P] Run tests: `cd frontend && npm test -- components/Pnl` → verify all PnlSummary tests pass

---

## Phase 10: SafetyOrderChart Component

**Goal**: Implement bar chart for Safety Order Usage with optional list view toggle

**Independent Test Criteria**:
- Component renders bar chart with Recharts
- X-axis shows Safety Order levels (SO1, SO2, SO3, etc.)
- Y-axis shows count values
- Component displays toggle button to switch to list view
- Component handles edge case: all counts = 0 (shows message)
- Chart renders correctly with realistic data

**Implementation Tasks**:

- [ ] T057 Create `frontend/src/components/SafetyOrderChart.tsx` component:
  - Props: `{ soUsageData: SafetyOrderUsage[]; }`
  - State: `{ viewMode: 'chart' | 'list' }`
  - Render conditional based on viewMode:
    - **Chart View** (default):
      - Use Recharts `<BarChart />` component
      - X-axis: Safety Order levels (so.level: "SO1", "SO2", etc.)
      - Y-axis: counts (numeric)
      - Bar styling: TailwindCSS colors (blue or custom)
      - Tooltip on hover: show SO level and exact count
      - Title: "Safety Order Usage" or similar
    - **List View** (on toggle):
      - Simple HTML table with 2 columns: "Safety Order Level" | "Count"
      - Render one row per SO level
      - Same data as chart, different presentation
  - Toggle Button: [Switch to List] / [Switch to Chart]
  - Edge case: if soUsageData.length === 0 or all counts === 0:
    - Show message: "No safety orders were triggered during this backtest"
    - Don't render chart/list
- [ ] T058 Create component tests for SafetyOrderChart in `frontend/src/__tests__/components/SafetyOrderChart.test.tsx`:
  - Test render chart: BarChart component renders with correct data
  - Test chart X-axis: shows SO1, SO2, SO3 labels
  - Test chart bars: bar heights correspond to counts
  - Test toggle button: click button switches between chart and list view
  - Test list view: renders table with columns and rows
  - Test empty data: soUsageData.length === 0 → shows message
  - Test all zero counts: all counts === 0 → shows message
- [ ] T059 [P] Run tests: `cd frontend && npm test -- components/SafetyOrderChart` → verify all chart tests pass

---

## Phase 11: TradeEventsTable Component

**Goal**: Implement chronological table showing Trade Events with sorting, pagination, and virtual scrolling

**Independent Test Criteria**:
- Component renders table with 5 columns: Timestamp, Event Type, Price, Quantity, Balance
- Table displays events in chronological order (oldest first)
- Click column header toggles sort order (Asc ↔ Desc)
- Component handles large datasets (100+ rows) with pagination or virtual scrolling
- All test data formats correctly (dates, numbers, currency)

**Implementation Tasks**:

- [x] T060 Create `frontend/src/components/TradeEventsTable.tsx` component:
  - Props: `{ events: TradeEvent[]; }`
  - State: `{ sortBy: 'timestamp' | 'eventType' | ...; sortOrder: 'asc' | 'desc'; pageIndex: number; pageSize: number = 25 }`
  - Render table with columns:
    1. Timestamp (ISO 8601 format, e.g., "2024-03-08T14:30:45Z")
    2. Event Type (e.g., "entry", "safety order buy", "exit")
    3. Price (formatted as crypto quantity with 8 decimals)
    4. Quantity (formatted as crypto quantity with 8 decimals)
    5. Balance (formatted as currency with 2 decimals)
  - Sorting:
    - Click column header to toggle sort order (Asc ↔ Desc)
    - Default: sorted by timestamp ascending (oldest first)
    - Show sort indicator (↑ or ↓) on sorted column
  - Pagination/Virtual Scrolling:
    - <100 rows: render all (no pagination)
    - 100-1000 rows: paginate with 25 rows per page + prev/next buttons
    - >1000 rows: use react-window for virtual scrolling
    - Show page indicator: "Showing 1-25 of 150 events"
  - Responsive layout: horizontal scroll on mobile (TailwindCSS overflow-x-auto)
- [x] T061 [P] Create pagination component `frontend/src/components/Pagination.tsx`:
  - Props: `{ pageIndex: number; pageSize: number; totalItems: number; onPageChange: (index: number) => void; }`
  - Render: [Prev] [Page 1] [Page 2] ... [Next] with page numbers as buttons
  - Disable [Prev] on first page, [Next] on last page
- [x] T062 [P] Create component tests for TradeEventsTable in `frontend/src/__tests__/components/TradeEventsTable.test.tsx`:
  - Test render: table displays all columns with headers
  - Test data display: rows show correct event data
  - Test sorting: click Timestamp header → sorts by timestamp ascending (oldest first)
  - Test sort toggle: click again → sorts descending (newest first)
  - Test sort indicator: shows ↑ or ↓ on sorted column
  - Test formatting: prices/quantities formatted with 8 decimals, balance with 2 decimals
  - Test pagination: displays 25 rows per page + pagination controls
  - Test pagination buttons: prev/next navigate between pages
  - Test large dataset: 1000+ rows don't cause performance issues (optional; use performance test)
- [x] T063 [P] Create component tests for Pagination in `frontend/src/__tests__/components/Pagination.test.tsx`:
  - Test render: page buttons display
  - Test next navigation: click next → pageIndex increments
  - Test prev navigation: click prev → pageIndex decrements
  - Test first page: [Prev] disabled
  - Test last page: [Next] disabled
- [x] T064 [P] Run tests: `cd frontend && npm test -- components/Trade` → verify all table tests pass

---

## Phase 12: ResultsDashboard Container

**Goal**: Assemble PnlSummary, SafetyOrderChart, and TradeEventsTable into a cohesive Results view

**Independent Test Criteria**:
- ResultsDashboard renders all 3 components (metrics, chart, table)
- Components receive correct props from BacktestResults
- Layout is responsive and visually organized
- Action buttons (Run New, Modify & Re-run) render and are functional

**Implementation Tasks**:

- [x] T065 Create `frontend/src/components/ResultsDashboard.tsx` container component:
  - Props: `{ results: BacktestResults; onReset: () => void; onModify: () => void; }`
  - Render layout (TailwindCSS Grid):
    - Header: "Backtest Results" title + Backtest ID
    - Row 1: PnlSummary component (full width or 3 columns)
    - Row 2: SafetyOrderChart (left 50% or 2-column width) | TradeEventsTable (right 50% or 4-column width)
    - Footer: Action buttons [Run New Backtest] [Modify & Re-run]
  - Pass props correctly:
    - PnlSummary: pnlData={results.pnlSummary}
    - SafetyOrderChart: soUsageData={results.safetyOrderUsage}
    - TradeEventsTable: events={results.tradeEvents}
  - Button actions:
    - [Run New Backtest]: onReset() → clears form, displays ConfigurationPage
    - [Modify & Re-run]: onModify() → pre-populates form, displays ConfigurationPage
- [x] T066 Create component tests for ResultsDashboard in `frontend/src/__tests__/components/ResultsDashboard.test.tsx`:
  - Test render: all 3 sub-components render (metrics, chart, table)
  - Test props passing: PnlSummary receives correct pnlData, Chart receives soUsageData, Table receives events
  - Test action buttons: onReset called when [Run New] clicked, onModify called when [Modify & Re-run] clicked
  - Test responsive layout: layout adjusts on small screens (chart and table stack vertically)
- [x] T067 [P] Run tests: `cd frontend && npm test -- components/ResultsDashboard` → verify all tests pass

---

## Phase 13: Update ResultsPage with ResultsDashboard

**Goal**: Wire ResultsPage with ResultsDashboard and implement view transitions (Reset, Modify)

**Independent Test Criteria**:
- ResultsPage displays ResultsDashboard with results data
- ResultsPage calls onReset when user clicks Run New
- ResultsPage calls onModify when user clicks Modify & Re-run
- Results view correctly integrates with state machine

**Implementation Tasks**:

- [x] T068 Update `frontend/src/pages/ResultsPage.tsx`:
  - Props: `{ results: BacktestResults; onReset: () => void; onModify: (config: BacktestConfiguration) => void; }`
  - Render ResultsDashboard component with results prop
  - Pass onReset and onModify callbacks to ResultsDashboard
- [x] T069 Create integration test for ResultsPage in `frontend/src/__tests__/integration/results-flow.test.tsx`:
  - Test result display: results page shows metrics, chart, table
  - Test reset button: click [Run New] → onReset called
  - Test modify button: click [Modify & Re-run] → onModify called with previous config
- [x] T070 [P] Run tests: `cd frontend && npm test -- integration/results-flow` → verify tests pass

---

## Phase 14: Complete App.tsx State Machine

**Goal**: Implement full state machine in App.tsx connecting all views and state transitions

**Independent Test Criteria**:
- App manages state correctly across all views
- State transitions work for all flows (configuration → polling → results → reset/modify)
- State persists data (backtestId, results) during session
- All state transitions tested with integration tests

**Implementation Tasks**:

- [ ] T071 Complete `frontend/src/App.tsx` implementation:
  - State: `{ currentView: 'configuration' | 'polling' | 'results'; backtestId: string | null; results: BacktestResults | null; submittedConfig: BacktestConfiguration | null; error: string | null; }`
  - Action handlers:
    - `handleSubmitConfig(config)`: POST to API → if success, setState(backtestId, polling view) → if error, setState(error, show message)
    - `handlePollingComplete(results)`: setState(results, currentView='results')
    - `handlePollingError(error)`: setState(error, display error message, allow user to go back or retry)
    - `handlePollingTimeout()`: keep polling in background, show timeout message to user
    - `handleResetForm()`: setState(currentView='configuration', clear backtestId/results/submittedConfig)
    - `handleModifyConfig()`: setState(currentView='configuration', pre-populate form with submittedConfig)
  - Render:
    - Conditional routes: if currentView === 'configuration' → ConfigurationPage, elif 'polling' → PollingPage, elif 'results' → ResultsPage
    - Error overlay: if error state → show error message with actions (dismiss, retry)
- [ ] T072 Create integration test for full app flow in `frontend/src/__tests__/integration/full-app-flow.test.tsx`:
  - Test complete user journey: load app → fill form → submit → poll → view results → reset → run new backtest
  - Test modify flow: results → modify → form pre-populated → submit → poll → results
  - Test error handling: form validation error, API error, polling error, timeout
  - Use mock API and mock routing
- [ ] T073 [P] Run full test suite: `cd frontend && npm test` → verify all tests pass (>80% coverage)

---

## Phase 15: Error Boundary & Error Handling

**Goal**: Implement ErrorBoundary component and comprehensive error handling across the app

**Independent Test Criteria**:
- ErrorBoundary catches React render errors
- Error messages display user-friendly text
- Retry buttons work and recover from errors
- Error states tested for all error scenarios (network, validation, timeout, API)

**Implementation Tasks**:

- [ ] T074 Create `frontend/src/components/ErrorBoundary.tsx`:
  - Implement React error boundary using componentDidCatch
  - Render error UI: error message + stack trace (dev mode only) + [Retry] button
  - Retry action: reset error state, re-render component
- [ ] T075 Create component tests for ErrorBoundary in `frontend/src/__tests__/components/ErrorBoundary.test.tsx`:
  - Test catch error: component throws error → ErrorBoundary catches and displays
  - Test retry button: click retry → error state cleared, component re-renders
  - Test stack trace visibility: dev mode shows stack, prod mode hides
- [ ] T076 Update error handling in backtest-api service:
  - Network timeout (>10s): throw descriptive error → caught in App.tsx
  - 400 validation error: extract field errors from response → display field-level errors
  - 500 server error: show generic message → allow user to retry or go back
  - Malformed API response: show data error message → allow user to go back
- [ ] T077 Create integration tests for error scenarios in `frontend/src/__tests__/integration/error-handling.test.tsx`:
  - Test network timeout: submit form → no response within 10s → show timeout message + [Retry]
  - Test validation error: submit form → 400 response → show field errors
  - Test server error: submit form → 500 response → show error message
  - Test polling network error: polling → network error → retry + backoff → fail → show error
  - Test timeout error: polling → 5 minutes elapsed → show timeout message + [Retry]
  - Mock API to simulate all error scenarios
- [ ] T078 [P] Run tests: `cd frontend && npm test -- integration/error-handling` → verify all error tests pass

---

## Phase 16: Visual Verification - Phase 3 Checkpoint

**Goal**: Verify UI renders correctly at end of Phase 3 (Forms + Polling) before proceeding to Phase 4 (Results)

**CRITICAL MANUAL VERIFICATION TASK**:

- [ ] T079 **VISUAL: Start dev server and verify Configuration Form + Polling views render correctly at localhost:5173**
  - Ensure dev server is running: `cd frontend && npm run dev`
  - Verify localhost:5173 loads without errors
  - **Configuration View Verification**:
    - Form displays all 5 input fields: Entry Price, Amounts, Sequences, Leverage, Margin Ratio
    - Each field has a label, input box, and placeholder text
    - [Submit] and [Clear] buttons visible and clickable
    - Fill form with valid data, click Submit
    - Verify form submission works (watch network tab for POST /backtest)
  - **Polling View Verification** (after successful submission):
    - PollingIndicator component displays with:
      - Animated spinner
      - Status message "Processing backtest..."
      - Elapsed time counter updating every second
      - Progress bar filling from 0% to 100% (over 5 minutes, or mock completes in 10s for testing)
      - [Retry] and [Cancel] buttons visible
    - Click [Cancel] → returns to Configuration view
    - Let polling complete (or mock): should transition to Results view
  - **Browser Console Check**:
    - No errors or warnings in console
    - No `console.error` calls from components
    - Network requests show POST /backtest, then GET /backtest/{id}/status calls every 2s
  - **Screenshot Evidence**:
    - Take screenshots of:
      1. Configuration form with all fields visible
      2. Polling indicator with spinner and elapsed time
      3. Console showing no errors (use F12 DevTools)
      4. Network tab showing API calls
  - **Save screenshots to**: `frontend/VISUAL-VERIFICATION-PHASE3.md` with date/time stamps

---

## Phase 17: Visual Verification - Phase 4 Checkpoint

**Goal**: Verify Results Dashboard renders correctly with all 3 components before proceeding to integration

**CRITICAL MANUAL VERIFICATION TASK**:

- [X] T080 **VISUAL: Verify Results Dashboard components render correctly at localhost:5173**
  - Ensure dev server is still running or restart: `cd frontend && npm run dev`
  - Manually navigate to Results view (or mock API to return completed status immediately)
  - **PnlSummary Verification**:
    - Title "Profit & Loss Summary" visible
    - 3 metrics displayed: ROI, Max Drawdown, Total Fees
    - ROI shows as percentage (e.g., "+12.34%") with green color if positive, red if negative
    - Max Drawdown shows with red color
    - Total Fees shows with currency symbol (e.g., "$123.45")
    - Hover over each metric: tooltip explanation appears
  - **SafetyOrderChart Verification**:
    - Bar chart renders with X-axis (Safety Order levels: SO1, SO2, SO3, etc.)
    - Y-axis shows count values (0, 1, 2, 3, etc.)
    - Bars have correct heights corresponding to data
    - Hover tooltip shows SO level and exact count
    - [Switch to List] button visible and clickable
    - Click button: chart toggles to table view with columns "Safety Order Level" | "Count"
    - Click button again: table toggles back to chart view
  - **TradeEventsTable Verification**:
    - Table renders with 5 columns: Timestamp, Event Type, Price, Quantity, Balance
    - 10+ mock trade events visible in rows
    - Timestamp column formatted as ISO 8601 (e.g., "2024-03-08T14:30:45Z")
    - Event Type shows values like "entry", "safety order buy", "exit"
    - Price and Quantity formatted with 8 decimals
    - Balance formatted with 2 decimals + currency symbol
    - Click Timestamp header: table sorts by timestamp (show ↑ or ↓ indicator)
    - Click again: sort order reverses
    - Pagination controls visible (if >25 rows): [Prev] [Page 1] [Page 2] [Next]
    - Navigate to Page 2: table shows next 25 events
  - **Results Dashboard Layout**:
    - All 3 components visible on one page without excessive scrolling (on desktop)
    - Layout responsive: on mobile, components stack vertically
    - [Run New Backtest] and [Modify & Re-run] buttons visible at bottom
    - Buttons clickable (would navigate back to form with or without pre-populated values)
  - **Browser Console & Network**:
    - No console errors
    - No network errors (all GET requests return 200)
  - **Screenshot Evidence**:
    - Take screenshots of:
      1. Full Results Dashboard (scroll if needed to show all components)
      2. PnlSummary metrics with tooltips
      3. SafetyOrderChart bar chart
      4. TradeEventsTable with sorting
      5. Console showing no errors
  - **Save screenshots to**: `frontend/VISUAL-VERIFICATION-PHASE4.md` with date/time stamps

---

## Phase 18: Testing & Coverage

**Goal**: Achieve >80% code coverage, run full test suite, verify all user stories tested

**Independent Test Criteria**:
- Jest test coverage >80% (lines, branches, functions)
- All 7 user stories have BDD test scenarios
- Test suite runs without failures: `npm test -- --coverage`
- Performance tests verify Trade Events table <2s render time with 1000+ rows

**Implementation Tasks**:

- [ ] T081 Run test coverage: `cd frontend && npm test -- --coverage`
  - Verify coverage >80% for statements, branches, functions, lines
  - Generate coverage report: `npm test -- --coverage --reporter=text-summary`
  - If coverage <80%: identify gaps and add unit tests for uncovered lines
- [ ] T082 Create BDD acceptance test scenarios in `frontend/src/__tests__/integration/user-stories.test.tsx`:
  - **US1**: Configure and submit form → verify form data sent to API
  - **US2**: Display PnlSummary → verify metrics render with correct formatting and colors
  - **US3**: Display Safety Order chart → verify bar chart renders, toggle to list view works
  - **US4**: Display Trade Events table → verify table renders, sorting works, pagination works
  - **US5**: Polling → verify polling starts after submit, status updates, auto-transitions on complete
  - **US6**: Timeout & errors → verify timeout message shows after 5m, retry button works, error messages display
  - **US7**: Reset/modify → verify [Run New] goes to blank form, [Modify] pre-populates form
- [ ] T083 [P] Create performance test for Trade Events table in `frontend/src/__tests__/performance/trade-events.test.tsx`:
  - Test: render TradeEventsTable with 1000 mock events
  - Measure: render time should be <2 seconds
  - Measure: sorting should complete <500ms
  - Measure: pagination should be instant (<100ms)
  - Use Jest performance timing or Lighthouse
- [ ] T084 [P] Run full test suite and verify no failures: `cd frontend && npm test -- --passWithNoTests`
  - Should show "Tests:  N passed" in output
  - No timeout errors
  - No memory leaks
- [ ] T085 [P] Run linting: `cd frontend && npm run lint`
  - Verify no ESLint errors or warnings
  - Fix any violations
- [ ] T086 [P] Create test summary in `frontend/TEST-RESULTS.md`:
  - Coverage report (lines, branches, functions percentages)
  - Test counts (unit, component, integration, E2E)
  - Performance benchmarks
  - Known limitations or excluded tests

---

## Phase 19: Build Optimization & Documentation

**Goal**: Production-ready build, documentation complete, deployment ready

**Independent Test Criteria**:
- Production build completes successfully: `npm run build`
- Build output size <500KB (gzip)
- README and documentation complete
- Environment configuration documented

**Implementation Tasks**:

- [ ] T087 Build production bundle: `cd frontend && npm run build`
  - Verify dist/ folder created with index.html, js files, css files
  - Check build output size: should be <500KB gzip (typical React + Recharts app)
  - Verify no build errors or warnings
- [ ] T088 Create `frontend/README.md` with:
  - Project overview (1-2 paragraphs)
  - Prerequisites (Node.js, npm versions)
  - Setup / Installation steps
  - npm scripts reference (dev, build, test, lint, etc.)
  - Environment variables required (.env.example)
  - Project structure overview (src/, components/, hooks/, services/)
  - How to run locally + connect to API Layer
  - Testing instructions
  - Deployment instructions
  - Troubleshooting section
- [ ] T089 Create `frontend/ARCHITECTURE.md` with:
  - Component hierarchy diagram
  - Data flow diagram (form → submission → polling → results)
  - State machine diagram (from contracts/state-machine.md)
  - Hook usage overview (useBacktestPolling, useFormValidation)
  - API integration points
- [ ] T090 Create `frontend/TESTING.md` with:
  - Test strategy overview (unit, component, integration)
  - How to run tests locally
  - How to run coverage reports
  - Mocking API responses (jest.mock() or MSW)
  - How to add new tests
- [ ] T091 Create `frontend/DEPLOYMENT.md` with:
  - Build process: `npm run build`
  - Output: `dist/` folder
  - Serve options (local http-server, Docker, static hosting)
  - Environment variables required (VITE_API_BASE_URL)
  - Docker setup (optional)
  - CI/CD integration (GitHub Actions example)
- [ ] T092 [P] Create `.env.example` with sample values:
  ```
  VITE_API_BASE_URL=http://localhost:4000/api
  VITE_LOG_LEVEL=info
  ```
- [ ] T093 [P] Update main `frontend/package.json` with metadata:
  - name, version, description, author, license
  - repository URL (git+https://...)
  - bugs, homepage fields
  - See orchestrator/api/package.json for reference

---

## Phase 20: Final Integration & E2E Testing

**Goal**: Full end-to-end testing with real API Layer, all systems integrated and tested

**Independent Test Criteria**:
- E2E test: full user journey (form → submit → poll → results) with real API
- All backtest results match API Layer output
- App handles real network conditions gracefully

**Implementation Tasks**:

- [ ] T094 Create E2E test in `frontend/src/__tests__/e2e/full-journey.test.tsx`:
  - Scenario: Load app → fill form → submit → wait for results → view dashboard
  - Verify each step with real API endpoints (or mock API mimicking real behavior)
  - Assert result metrics, chart data, trade events match expected structure
  - Test happy path + error scenarios
- [ ] T095 Connect frontend to actual API Layer (Feature 004):
  - Set `VITE_API_BASE_URL=http://localhost:4000/api` in .env.local
  - Run orchestrator/api server
  - Run frontend dev server
  - Manually test: fill form → submit → see results from real API
- [ ] T096 Create integration test against real API in `frontend/src/__tests__/e2e/real-api.test.tsx`:
  - Similar to T094 but using actual API Layer endpoints
  - Required API endpoints to be running
  - Test timeout handling (if backtest takes >2 seconds to process)
- [ ] T097 [P] Document API integration assumptions in `frontend/DEPLOYMENT.md`:
  - API Layer must be running on `VITE_API_BASE_URL`
  - API endpoints required: POST /backtest, GET /backtest/{id}/status, GET /backtest/{id}/results
  - Expected response formats (from contracts/backtest-api.md)
- [ ] T098 [P] Verify all user stories work end-to-end:
  - **US1**: Form submission works, backtestId received
  - **US2**: Metrics display correctly with real data
  - **US3**: Chart displays correct SO usage counts
  - **US4**: Table shows all trade events with correct data
  - **US5**: Polling updates UI every 2 seconds until completion
  - **US6**: Timeout message shows if backtest takes >5 minutes (optional: requires long test)
  - **US7**: Reset/Modify buttons return to config form (cleared or pre-filled)
  - Document results in `frontend/E2E-TEST-RESULTS.md`

---

## Summary

**Total Tasks**: 98 implementation tasks + 2 visual verification checkpoints

**Phases**:
1. **Phase 1** (T001-T019): Project setup + visual verification
2. **Phase 2** (T020-T025): Form validation & formatters
3. **Phase 3** (T026-T029): API service layer
4. **Phase 4** (T030-T035): Configuration form component + visual verification
5. **Phase 5** (T036-T041): App root + view routing
6. **Phase 6** (T042-T044): useBacktestPolling hook
7. **Phase 7** (T045-T048): PollingIndicator component
8. **Phase 8** (T049-T051): PollingPage integration
9. **Phase 9** (T052-T056): PnlSummary component
10. **Phase 10** (T057-T059): SafetyOrderChart component
11. **Phase 11** (T060-T064): TradeEventsTable component
12. **Phase 12** (T065-T067): ResultsDashboard container
13. **Phase 13** (T068-T070): ResultsPage integration
14. **Phase 14** (T071-T073): Complete App state machine
15. **Phase 15** (T074-T078): Error boundary & error handling
16. **Phase 16** (T079): Visual verification checkpoint - Phase 3
17. **Phase 17** (T080): Visual verification checkpoint - Phase 4
18. **Phase 18** (T081-T086): Testing & coverage
19. **Phase 19** (T087-T093): Build optimization & documentation
20. **Phase 20** (T094-T098): Final integration & E2E testing

**Estimated Timeline**: 15-18 days with TDD approach, visual verification checkpoints, comprehensive testing, and full documentation.
