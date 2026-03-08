# Implementation Plan: DCA Frontend Web Application (Feature 005)

**Branch**: `005-dca-frontend` | **Date**: March 8, 2026 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/005-dca-frontend/spec.md`

## Summary

The DCA Frontend is a React + Vite Single Page Application (SPA) that provides a user interface for configuring and executing DCA backtest runs against the API Layer (Feature 004). The application enables traders to submit backtest configurations (Entry Price, Amounts array, Sequences, Leverage, Margin Ratio), poll for completion results, and visualize results including PnlSummary metrics, Safety Order Usage charts, and Trade Events timelines. The feature must implement a custom `useBacktestPolling` hook to encapsulate API polling logic with 2-second intervals, 5-minute timeout management, and automatic view transitions. All user interactions and state transitions must be covered by automated tests (Green Light Protocol compliance).

## Technical Context

**Language/Version**: TypeScript 5.1+ (consistent with orchestrator/api package.json)  
**Primary Dependencies**: React 18+, Vite 5+, TailwindCSS 3+, React Router v6 (lightweight routing), Recharts or Chart.js (bar chart visualization), Axios or Fetch API (HTTP client)  
**Storage**: None persistent (session-only; results held in component state during browser session)  
**Testing**: Jest 30+, React Testing Library, Supertest (for API integration mocking)  
**Target Platform**: Modern browsers (ES2020+ support; Chrome, Firefox, Safari, Edge)  
**Project Type**: Web SPA / Frontend Application  
**Performance Goals**: Form interaction feedback <100ms; results page render <2 seconds post-API notification; 1000-row Trade Events table with smooth scrolling (60 fps)  
**Constraints**: <500ms client-side form validation; polling must not cause UI jank; properly format currency (2 decimals), crypto quantities (8 decimals)  
**Scale/Scope**: Single-user local development environment; forms with 5 input fields; results dashboard with 3 visualization components (metrics, chart, table)

## Constitution Check

✅ **GATE PASS** - Feature 005 complies with all Constitution requirements:

| Gate | Compliance Status | Evidence |
|------|---|---|
| **No Live Trading** | ✅ PASS | Frontend submits backtest configurations to API Layer; only reads results. No direct broker/exchange connections. Feature 004 (API Layer) is single-use stateless; Feature 003 (Orchestrator) handles all execution. |
| **Green Light Protocol** | ✅ PASS | All user interaction pathways (form submission, polling states, timeout handling, error recovery) are covered by BDD acceptance scenarios in spec.md User Stories 1-7. Unit tests and integration tests (TBD in Phase 2) must verify all UI state transitions. |
| **Fixed-Point Arithmetic** | ✅ PASS | Frontend DOES NOT perform trading calculations. All mathematical operations (PnL computation, order fills, liquidation checks) occur in core-engine (Feature 001/002) and API Layer (Feature 004). Frontend only displays values formatted to 2 decimals (currency) and 8 decimals (crypto). See [Fixed-Point Handling](#fixed-point-handling) below. |
| **Architecture (polyglot)** | ✅ PASS | Frontend belongs to `orchestrator/` domain (UI adapter layer per Clean Architecture). Core mathematical engine remains in `core-engine/` (Go/Rust). Feature 005 uses shallow component tree; no business logic in UI. |
| **Event-Driven Domain** | ✅ PASS (N/A) | Frontend does not define domain events; it consumes events produced by API Layer. Backtest status polling (pending → completed/failed) maps to domain state transitions driven by backend. |

### Fixed-Point Handling

Frontend receives monetary values from API Layer as strings or pre-formatted decimals:
- **Currency amounts** (fees, balances, limits): Display with 2 decimal places (e.g., "$1234.56")
- **Crypto quantities** (amounts per order, position size): Display with 8 decimal places (e.g., "0.12345678 BTC")
- **Percentages** (ROI, Max Drawdown, Margin Ratio): Display with 2 decimal places (e.g., "12.34%")

Frontend MUST NOT perform arithmetic; all arithmetic is backend-only. If API returns pre-calculated metrics, display as-is. If API returns raw numeric data, use string-to-number parsing without intermediate calculations.

### BDD Acceptance Scenarios & Coverage

Frontend must implement automated tests for each User Story (1-7 in spec.md):
- **Story 1** (Configure/Submit): Form validation, submission, loading states → Unit + Integration tests
- **Story 2** (PnlSummary Results): Metric display, formatting, color coding → Component tests  
- **Story 3** (Safety Order Usage): Chart rendering, empty state handling, view toggle → Component tests
- **Story 4** (Trade Events Timeline): Table rendering, sorting, pagination/virtual scrolling → Component + Performance tests
- **Story 5** (Polling): Status polling, auto-transitions, interval management → Integration tests (mocked API)
- **Story 6** (Timeout/Errors): Timeout handling, error messages, retry flows → Integration tests
- **Story 7** (Reset/New Backtest): Form reset, pre-population, navigation → E2E/Navigation tests

All tests must achieve Green Light status before merging to main branch.

## Project Structure

### Documentation (this feature)

```text
specs/005-dca-frontend/
├── plan.md              # This file (comprehensive implementation plan)
├── research.md          # Phase 0 research decisions and tech justifications
├── data-model.md        # Phase 1 entity definitions, state models, UI data schemas
├── quickstart.md        # Phase 1 developer quickstart and setup instructions
├── spec.md              # Original feature specification (7 user stories, acceptance criteria)
├── checklists/          # Task tracking and verification checklists
└── contracts/           # Phase 1 API contracts, component interfaces
    ├── backtest-api.md  # REST API contract (submission, polling, results retrieval)
    ├── react-components.md  # Component prop/interface contracts
    └── state-machine.md  # Form state and backtest lifecycle state machine
```

### Source Code (Frontend Application)

```text
frontend/                           # NEW: React + Vite SPA
├── index.html                      # Vite entry point
├── vite.config.ts                  # Vite configuration
├── tsconfig.json                   # TypeScript configuration
├── tailwind.config.ts              # TailwindCSS configuration
├── jest.config.js                  # Jest test configuration
├── .eslintrc.json                  # ESLint configuration
├── package.json                    # npm dependencies
│
├── src/
│   ├── main.tsx                   # React DOM render entrypoint
│   ├── App.tsx                    # Root component (view routing)
│   ├── index.css                  # Global TailwindCSS styles
│   │
│   ├── components/                # Reusable React components
│   │   ├── ConfigurationForm.tsx  # Form with 5 input fields + validation + submit
│   │   ├── ResultsDashboard.tsx   # Container for results display (metrics + chart + table)
│   │   ├── PnlSummary.tsx         # Metrics display (ROI, Max Drawdown, Total Fees)
│   │   ├── SafetyOrderChart.tsx   # Bar chart for Safety Order Usage + toggle to list view
│   │   ├── TradeEventsTable.tsx   # Chronological table with sortable columns, pagination
│   │   ├── PollingIndicator.tsx   # Loading spinner + status message during polling
│   │   └── ErrorBoundary.tsx      # Error fallback UI component
│   │
│   ├── hooks/                     # Custom React hooks
│   │   ├── useBacktestPolling.ts  # Main polling hook (2s intervals, 5m timeout)
│   │   ├── useFormValidation.ts   # Form input validation hook
│   │   └── useLocalStorage.ts     # Optional: persist session data (future enhancement)
│   │
│   ├── services/                  # API communication & business logic
│   │   ├── backtest-api.ts        # HTTP client methods (submitBacktest, getStatus, getResults)
│   │   ├── types.ts               # TypeScript interfaces for API responses
│   │   └── formatters.ts          # Formatting functions (currency, crypto, percentages)
│   │
│   ├── pages/                     # Page containers (if using React Router)
│   │   ├── ConfigurationPage.tsx  # Form submission page
│   │   ├── PollingPage.tsx        # Loading state page
│   │   └── ResultsPage.tsx        # Results display page
│   │
│   └── styles/                    # TailwindCSS component styles (optional)
│       └── components.css         # Utility classes and component variants
│
├── __tests__/                     # Test files (mirror src structure)
│   ├── components/
│   │   ├── ConfigurationForm.test.tsx
│   │   ├── ResultsDashboard.test.tsx
│   │   ├── SafetyOrderChart.test.tsx
│   │   └── TradeEventsTable.test.tsx
│   ├── hooks/
│   │   ├── useBacktestPolling.test.ts
│   │   └── useFormValidation.test.ts
│   ├── services/
│   │   └── backtest-api.test.ts
│   └── integration/
│       ├── form-submission.test.tsx  # E2E form → polling → results flow
│       └── error-handling.test.tsx   # Error scenarios and recovery
│
└── public/                        # Static assets (favicon, etc.)
```

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      React SPA (Frontend)                        │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ App.tsx (State: currentView, backtestId, results)      │   │
│  │                                                          │   │
│  │  Routing: ConfigurationPage → PollingPage → ResultsPage│   │
│  └─────────────────────────────────────────────────────────┘   │
│               ↓             ↓                ↓                    │
│  ┌──────────────────┐ ┌──────────────┐ ┌─────────────────────┐ │
│  │Configuration    │ │PollingPage   │ │ ResultsDashboard   │ │
│  │Form             │ │              │ │                     │ │
│  │- Entry Price    │ │ useBacktest  │ │ - PnlSummary       │ │
│  │- Amounts array  │ │ Polling()    │ │ - SafetyOrderChart │ │
│  │- Sequences      │ │              │ │ - TradeEventsTable │ │
│  │- Leverage       │ │ Loading      │ │                     │ │
│  │- Margin Ratio   │ │ Spinner      │ │ [Results View]     │ │
│  │                 │ │              │ │                     │ │
│  │[Submit Button]  │ │ Status: Pend │ │ [Reset/Modify]     │ │
│  └──────────────────┘ │ ing/Failed   │ └─────────────────────┘ │
│           ↓           │              │                           │
│           └───────────┤ Timeout: 5m  │                           │
│                       │ [Retry]      │                           │
│                       └──────────────┘                           │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│                      Services Layer                               │
│  backtest-api.ts: submitBacktest() → POST /backtest              │
│                   getStatus() → GET /backtest/{id}/status  (2s) │
│                   getResults() → GET /backtest/{id}/results     │
├─────────────────────────────────────────────────────────────────┤
│          API Layer (Feature 004) - Express/TypeScript            │
│  POST /backtest, GET /backtest/{id}/status, GET /backtest/{id}  │
└─────────────────────────────────────────────────────────────────┘
```

## Component Design & Data Flow

### Top-Level State Management (App.tsx)

```typescript
interface AppState {
  currentView: 'configuration' | 'polling' | 'results';
  backtestId: string | null;        // Set after successful submission
  results: BacktestResults | null;  // Set after polling completes
  error: string | null;              // Error message if any
  submittedConfig: Config | null;    // Preserve user's submission
}

enum AppAction {
  SUBMIT_CONFIG,        // → polling view
  POLLING_SUCCESS,      // → results view (with results)
  POLLING_TIMEOUT,      // → error state (in polling view)
  POLLING_ERROR,        // → error state (in polling view)
  RESET_FORM,           // → configuration view
  MODIFY_CONFIG,        // → configuration view (pre-populated)
}
```

### Component Hierarchy & Props

```
App.tsx (State root)
├── ConfigurationPage.tsx (Props: onSubmit, initialValues?)
│   └── ConfigurationForm (Props: onSubmit, onValidationChange, defaultValues)
│       ├── EntryPriceInput (Props: value, onChange, errors)
│       ├── AmountsArrayInput (Props: values, onAdd, onRemove, onChange, errors)
│       ├── SequencesInput (Props: value, onChange, errors)
│       ├── LeverageInput (Props: value, onChange, errors)
│       ├── MarginRatioInput (Props: value, onChange, errors)
│       └── SubmitButton (Props: isLoading, isDisabled, onClick)
│
├── PollingPage.tsx (Props: backtestId, onComplete, onTimeout, onError)
│   ├── PollingIndicator (Props: status, statusMessage, elapsedSeconds)
│   └── useBacktestPolling() Hook (Internal)
│       ├── Polls GET /backtest/{id}/status every 2 seconds
│       ├── Manages 5-minute timeout
│       ├── Triggers onComplete when status='completed'
│       ├── Triggers onError if status='failed' or network error
│       └── Triggers onTimeout if 5 minutes elapsed
│
└── ResultsDashboard.tsx (Props: results, onReset, onModify)
    ├── PnlSummary (Props: pnlData)
    │   ├── MetricCard (Props: label, value, unit, color)
    │   └── Tooltips on hover
    ├── SafetyOrderChart (Props: soUsageData, toggleView)
    │   ├── Bar Chart (via Recharts or Chart.js)
    │   └── List/Table View Toggle
    └── TradeEventsTable (Props: events, sortBy, paginate)
        ├── Column Headers: Timestamp, Event Type, Price, Quantity, Balance
        ├── Sorting: click header to toggle Asc/Desc
        ├── Pagination or Virtual Scrolling (for 1000+ rows)
        └── Row expansion for event details (optional)
```

### useBacktestPolling Hook (Core Custom Hook)

**Signature**:
```typescript
interface useBacktestPollingProps {
  backtestId: string;
  onComplete: (results: BacktestResults) => void;
  onError: (error: Error) => void;
  onTimeout: () => void;
  pollInterval?: number; // default 2000ms
  timeoutThreshold?: number; // default 5 * 60 * 1000ms (5 minutes)
}

const useBacktestPolling = (props: useBacktestPollingProps) => {
  // Manages setInterval, error handling, timeout detection
  // Returns: { isPolling, status, elapsedSeconds, progress }
}
```

**Internal Logic**:
1. Initialize interval timer on mount
2. Poll GET /backtest/{id}/status every `pollInterval` ms
3. Track elapsed time; if >= `timeoutThreshold`, call `onTimeout()`
4. If status === 'completed', fetch GET /backtest/{id}/results and call `onComplete()`
5. If status === 'failed', call `onError()` with failure reason
6. Handle network errors: log, retry automatically (exponential backoff up to 3 times), then `onError()`
7. Cleanup interval on unmount
8. Return status, elapsedSeconds for UI updates

### Data Flow: Configuration Submit → Results Display

```
User fills form
    ↓
[useFormValidation] validates inputs → {valid: true/false, errors: {}}
    ↓ (valid && submitted)
ConfigurationForm calls onSubmit(config)
    ↓
App.tsx receives config → setState({currentView: 'polling'})
    ↓
[backtest-api.submitBacktest(config)] → POST /backtest
    ↓ (success)
Response contains backtestId
    ↓
App.setState({backtestId, currentView: 'polling'})
    ↓ (render PollingPage)
[useBacktestPolling] starts polling loop
    ↓ (every 2 seconds)
GET /backtest/{backtestId}/status
    ↓ (status='pending')
Continue polling, show elapsed time
    ↓ (elapsed >= 5 minutes)
Trigger onTimeout → show timeout message with retry
    ↓ (status='completed')
Fetch GET /backtest/{backtestId}/results → BacktestResults
    ↓
App.setState({results, currentView: 'results'})
    ↓ (render ResultsDashboard)
Display PnlSummary, SafetyOrderChart, TradeEventsTable
```

## Implementation Phases

### Phase 1: Foundation & Project Setup
**Duration**: 1-2 days | **Deliverable**: Vite project with TailwindCSS, TypeScript configured, component folder structure

- [ ] Initialize Vite project: `npm create vite@latest frontend -- --template react-ts`
- [ ] Install dependencies: React, TailwindCSS, TailwindCSS config, axios, recharts (or chart.js)
- [ ] Configure TypeScript: strict mode, esModuleInterop, lib es2020+
- [ ] Configure ESLint + Prettier (align with orchestrator/api)
- [ ] Set up Jest + React Testing Library
- [ ] Create folder structure per [Source Code](#source-code-frontend-application) above
- [ ] Create .eslintrc.json, prettier.config.js, tsconfig.json
- [ ] Create tailwind.config.ts with DCA-specific color palette (profit=green, loss=red)
- [ ] Update package.json scripts: build, dev, test, test:coverage, lint, lint:fix

**Tests**: None yet (Phase 1 is infra setup)

### Phase 2: Configuration Form & API Integration
**Duration**: 2-3 days | **Deliverable**: Functional form, API submission, backtest ID retrieval, error handling

- [ ] Create ConfigurationForm.tsx with 5 input fields
- [ ] Implement useFormValidation hook:
  - Validate Entry Price > 0 (decimal/float)
  - Validate Amounts array: non-empty, all values > 0
  - Validate Sequences: integer > 0
  - Validate Leverage: decimal > 0
  - Validate Margin Ratio: 0-100 (as percentage)
  - Return errors in <100ms
- [ ] Create backtest-api.ts service with submitBacktest() function
- [ ] Handle API submission:
  - Show loading spinner on submit button
  - Disable submit button during request
  - Handle 400 (validation error) → display field errors
  - Handle 500 (server error) → display error message
  - Handle network timeout → retry logic
- [ ] Extract backtestId from API response
- [ ] Create PollingPage stub (placeholder during Phase 2)
- [ ] Add form reset/clear functionality

**Tests**:
- [ ] Form input validation: all 5 fields with valid/invalid values
- [ ] Submit button disabled during submission
- [ ] Error handling for failed API requests
- [ ] Successful submission extracts backtestId

### Phase 3: Polling Mechanism & State Transitions
**Duration**: 1-2 days | **Deliverable**: useBacktestPolling hook, polling UI, timeout handling

- [ ] Implement useBacktestPolling hook (core logic)
  - 2-second polling interval (configurable)
  - 5-minute timeout with countdown display
  - Auto-call onComplete when status='completed'
  - Auto-call onError when status='failed'
  - Auto-call onTimeout when 5 minutes elapsed
  - Exponential backoff retry on network errors (max 3 attempts)
- [ ] Create PollingIndicator component:
  - Animated spinner
  - Status message ("Processing backtest...", elapsed time, retry attempts)
  - Manual "Retry" button
  - Manual "Cancel" button (returns to form)
- [ ] Implement view transitions:
  - Submit → polling view (automatic)
  - Polling completes → results view (automatic via hook callback)
  - Polling timeout → error state within polling view
  - User clicks "Retry" → restart polling from current timestamp
  - User clicks "Cancel" → return to form

**Tests**:
- [ ] Polling fires at 2-second intervals
- [ ] Timeout triggers after 5 minutes
- [ ] View transitions on success/error/timeout
- [ ] Manual retry resets elapsed time and restarts polling
- [ ] Network error triggers retry logic

### Phase 4: Results Display Components (Part A - Metrics & Chart)
**Duration**: 2 days | **Deliverable**: PnlSummary metrics, Safety Order Usage chart, formatting functions

- [ ] Create backtest-api.ts::getResults() function
  - GET /backtest/{id}/results
  - Returns BacktestResults object
- [ ] Create types.ts with interfaces:
  - BacktestResults, PnlSummary, SafetyOrderUsage[], TradeEvent[]
  - Ensure types match API Layer contract (Feature 004)
- [ ] Create formatters.ts with functions:
  - formatCurrency(amount: number, decimals=2): string
  - formatCryptoQuantity(amount: number, decimals=8): string
  - formatPercentage(value: number, decimals=2): string
- [ ] Create PnlSummary component:
  - Display ROI as percentage with ± color coding (green/red)
  - Display Max Drawdown as percentage with ± color coding
  - Display Total Fees with currency symbol
  - Optional: tooltips on hover explaining each metric
  - Use TailwindCSS for layout and colors
- [ ] Create SafetyOrderChart component:
  - Bar chart via Recharts: X-axis = SO level (SO1, SO2, ...), Y-axis = count
  - Recharts dependency: `npm install recharts`
  - Add "Toggle List View" button
  - In list view: simple table with columns (Safety Order Level, Count)
  - Handle edge case: all counts=0 → show message "No safety orders triggered"
- [ ] Create MetricCard sub-component (reusable for PnlSummary metrics)

**Tests**:
- [ ] PnlSummary renders with correct values and formatting
- [ ] ROI > 0 displays green; ROI < 0 displays red
- [ ] SafetyOrderChart renders bars for each SO level
- [ ] Chart toggle switches between bar view and list view
- [ ] Empty SO data displays graceful message

### Phase 5: Results Display Components (Part B - Trade Events Table)
**Duration**: 2 days | **Deliverable**: Trade Events table with pagination/virtual scrolling, sorting

- [ ] Create TradeEventsTable component:
  - Columns: Timestamp (ISO 8601), Event Type (entry/safety/exit), Price, Quantity, Balance
  - Default sort: timestamp ascending (oldest first)
  - Click header to toggle sort order (Asc ↔ Desc)
  - Format values via formatters.ts (crypto quantities, currency, numbers)
- [ ] Implement large dataset handling:
  - For <100 rows: render all rows
  - For 100-1000 rows: paginate (10-25 rows per page)
  - For >1000 rows: virtual scrolling via React Window or TanStack Virtual
  - Install: `npm install react-window` (12KB gzip)
- [ ] Add optional row expansion for event details
  - Click row → expand details pane
  - Collapse pane on click again
- [ ] Responsive layout: ensure table scrolls horizontally on small screens (TailwindCSS)

**Tests**:
- [ ] Table renders all columns with correct data
- [ ] Sorting toggles on header click
- [ ] Pagination works (prev/next buttons, page numbers)
- [ ] Virtual scrolling maintains performance with 1000+ rows
- [ ] Row expansion/collapse works
- [ ] Values formatted correctly (crypto quantities, prices)

### Phase 6: Results Dashboard Container & View Management
**Duration**: 1 day | **Deliverable**: ResultsDashboard component, reset/modify buttons, view routing

- [ ] Create ResultsDashboard.tsx container:
  - Receives BacktestResults as prop
  - Layout: PnlSummary (top), SafetyOrderChart (middle-left), TradeEventsTable (middle-right/bottom)
  - Use CSS Grid or Flexbox (TailwindCSS) for responsive layout
- [ ] Add action buttons:
  - "Run New Backtest" → clears form, returns to ConfigurationPage
  - "Modify & Re-run" → pre-populates form with previous config, returns to ConfigurationPage
- [ ] Implement view state machine in App.tsx:
  - State: {currentView, backtestId, results, submittedConfig, error}
  - Actions: SUBMIT_CONFIG, POLLING_START, POLLING_SUCCESS, POLLING_TIMEOUT, POLLING_ERROR, RESET_FORM, MODIFY_CONFIG
  - Routing: configuration → polling → results (or back to configuration)
- [ ] Add optional: preserve results in session state (so user can toggle between results and form without losing results)

**Tests**:
- [ ] ResultsDashboard renders all 3 components
- [ ] "Run New Backtest" clears form and returns to config page
- [ ] "Modify & Re-run" pre-populates form with previous values
- [ ] Back navigation preserves results during session

### Phase 7: Error Handling & Edge Cases
**Duration**: 1-2 days | **Deliverable**: Error boundary, detailed error messages, recovery flows

- [ ] Create ErrorBoundary component:
  - Catches React errors during render
  - Displays error message + stack trace (dev mode only)
  - "Retry" button to reset error state
- [ ] Implement error handling scenarios from spec.md Story 6:
  - Network timeout during submission → retry with exponential backoff
  - Network timeout during polling → show retry message in PollingPage
  - API returns status 'failed' → display failure reason from API
  - Malformed API response → display "Data error" message
  - 5-minute polling timeout → display timeout message with "Retry" and "Check Status" buttons
  - Empty/missing results data → show placeholder messages
- [ ] Form validation errors:
  - Display error messages below each input field (red text)
  - Highlight invalid fields with red border
  - Clear errors when user modifies field (real-time validation)

**Tests**:
- [ ] Error boundary catches render errors
- [ ] Network errors display user-friendly messages
- [ ] Retry buttons work and reset error state
- [ ] Timeout message displays after 5 minutes
- [ ] Form field errors display and clear correctly

### Phase 8: Comprehensive Testing & Optimization
**Duration**: 2 days | **Deliverable**: Test suite (>80% coverage), performance tuning, accessibility

- [ ] Unit tests:
  - Each component: render, props handling, user interactions
  - useFormValidation: all validation rules
  - useBacktestPolling: polling intervals, timeout logic, error handling
  - formatters: currency, crypto, percentage formatting
- [ ] Integration tests:
  - Form submission → polling → results flow (mocked API)
  - Error scenarios: failed submission, timeout, API errors
  - View transitions: configuration → polling → results → new form
- [ ] Performance tests:
  - Trade Events table with 1000+ rows: render time <2s, smooth scroll (60fps)
  - Chart rendering: <500ms
  - Form validation: <100ms per keystroke
- [ ] Accessibility:
  - ARIA labels on form inputs
  - Keyboard navigation (Tab, Enter, Escape)
  - Color contrast ratios (WCAG AA minimum)
  - Screen reader support (semantic HTML, alt text)
- [ ] Bundle optimization:
  - Tree-shake unused code
  - Lazy load chart library if not immediately visible
  - Code split: ConfigurationPage, PollingPage, ResultsPage
- [ ] Update README.md with quickstart guide

**Tests**:
- [ ] Jest test coverage >80%
- [ ] All user stories covered by automated tests
- [ ] Performance benchmarks verified
- [ ] Accessibility audit passed

### Phase 9: Integration with API Layer & E2E Testing
**Duration**: 1 day | **Deliverable**: E2E tests against live/mock API, documentation

- [ ] Connect frontend to actual API Layer (Feature 004) endpoints
- [ ] E2E test (Cypress or Playwright):
  - Load frontend, fill form, submit, poll, view results
  - Compare results with known test data
- [ ] Mock API for local development:
  - Create mock handlers in src/services/mock-api.ts
  - Use MSW (Mock Service Worker) for intercepting HTTP requests
- [ ] Document API contracts in contracts/backtest-api.md
- [ ] Verify all backtest results match expected types from API Layer

**Tests**:
- [ ] E2E test: full user journey (form → submission → polling → results)
- [ ] Mock API: submitBacktest, getStatus, getResults endpoints
- [ ] Results data matches expected schema

### Phase 10: Documentation & Deployment Readiness
**Duration**: 1 day | **Deliverable**: README, ARCHITECTURE.md, deployment guide

- [ ] Update/create documentation:
  - README.md: setup, local development, npm scripts
  - ARCHITECTURE.md: component design, data flow, state management
  - TESTING.md: test strategy, how to run tests, mocking API
  - DEPLOYMENT.md: build process, environment variables, deployment steps
- [ ] Create .gitignore for frontend/ (node_modules, dist, coverage, etc.)
- [ ] Create .env.example with sample API_BASE_URL
- [ ] Verify build process: `npm run build` produces optimized dist/
- [ ] Verify dev server: `npm run dev` starts on http://localhost:5173
- [ ] Prepare for deployment: Docker (optional), CI/CD setup (GitHub Actions)

**Deliverables**:
- [ ] README.md with setup instructions
- [ ] ARCHITECTURE.md with component diagrams
- [ ] DEPLOYMENT.md with build/deployment steps
- [ ] .env.example with configuration
- [ ] Passing build: `npm run build` (no errors)
- [ ] Green test suite: `npm test` (all tests pass)

## Key Technical Decisions

### 1. **Vite over Create React App**
- **Decision**: Use Vite for build tooling
- **Rationale**: Fast HMR (hot module replacement), smaller build output, better DX
- **Alternative Considered**: Create React App (too heavy, slower build, less customization)

### 2. **Custom useBacktestPolling Hook vs. External Library**
- **Decision**: Implement custom polling hook
- **Rationale**: Simple polling logic (2s intervals, 5m timeout) doesn't require external libraries; custom hook is lightweight and gives full control over retry logic
- **Alternative Considered**: react-query/TanStack Query (overkill for single polling endpoint; would add 50KB)

### 3. **Recharts for Safety Order Bar Chart**
- **Decision**: Use Recharts (lightweight charting library)
- **Rationale**: ~60KB gzip, composable React components, responsive, accessible
- **Alternative Considered**: Chart.js (requires wrapper; larger), D3 (overkill), custom canvas (too complex)

### 4. **React Router v6 for View Management**
- **Decision**: Use React Router v6 for SPA routing (or simple state if <3 views)
- **Rationale**: Handles browser history, deep linking (optional feature)
- **Alternative Considered**: Simple conditional rendering based on App state (simpler for MVP; can add router later)

### 5. **Relative vs. Absolute Imports**
- **Decision**: Use absolute imports via tsconfig.json paths
- **Rationale**: Cleaner imports (`import { useBacktestPolling } from 'hooks/...'` vs. `../../../hooks/...`)
- **Configuration**: Add to tsconfig.json:
  ```json
  "compilerOptions": {
    "baseUrl": "src",
    "paths": {
      "@/*": ["./*"]
    }
  }
  ```

### 6. **Fixed-Point Display (No Calculation)**
- **Decision**: Frontend displays backend-calculated values as-is; no arithmetic
- **Rationale**: Avoids precision loss from floating-point math; maintains single source of truth (backend)
- **Implementation**: Formatter functions only for display (currency symbol, decimal places, percentage sign)

### 7. **Session State Only (No Persistence)**
- **Decision**: Keep backtest results in component state during session only
- **Rationale**: MVP scope; simplifies no localStorage/database setup
- **Future**: localStorage or IndexedDB can be added for recovery across browser closes

### 8. **Error Handling Strategy**
- **Decision**: Show user-friendly error messages + retry options
- **Rationale**: Users need to understand what went wrong and what to do next
- **Implementation**: Error boundary, specific error messages per scenario, retry loops

### 9. **Form Validation: Client-Side Only (MVP)**
- **Decision**: Validate on client side before submission
- **Rationale**: Fast feedback (<100ms), better UX; server also validates before processing
- **Future**: Real-time server validation (via debounced API calls) can be added later

### 10. **CSS: TailwindCSS Utility Classes**
- **Decision**: Use TailwindCSS utility classes (no custom CSS initially)
- **Rationale**: Fast styling, consistent design system, responsive helpers
- **Custom Components**: Define reusable Tailwind classes in global CSS if patterns emerge

## Dependencies & Libraries

### Core Dependencies
- `react` (18+): UI framework
- `react-dom` (18+): React DOM rendering
- `typescript` (5.1+): Type safety
- `vite` (5+): Build tool and dev server
- `tailwindcss` (3+): Styling
- `axios` (1+) or `fetch`: HTTP client (axios recommended for error handling)
- `recharts` (~60KB): Bar chart visualization

### Dev Dependencies
- `@types/react`, `@types/react-dom`: TypeScript definitions
- `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`: TypeScript linting
- `eslint` (10+): Code linting
- `prettier` (3+): Code formatting
- `jest` (30+): Unit testing framework
- `@testing-library/react`, `@testing-library/jest-dom`: Component testing
- `ts-jest`: Jest + TypeScript integration
- `@types/jest`: TypeScript definitions for Jest

### Optional (Phase 2+)
- `react-router-dom` (6+): Client-side routing (if SPA grows beyond 3 views)
- `react-window`: Virtual scrolling for large tables (if >1000 trade events common)
- `msw`: Mock Service Worker for API mocking in tests

### .npmrc Configuration
```ini
# Ensure consistent Node versions across team
engine-strict=true

# Lock lockfile version for consistency
lockfile-version=3
```

### package.json Scripts
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "lint": "eslint src --ext .ts,.tsx",
    "lint:fix": "eslint src --ext .ts,.tsx --fix",
    "format": "prettier --write \"src/**/*.{ts,tsx,json}\"",
    "clean": "rm -rf dist coverage .eslintcache"
  }
}
```

## Testing Strategy

### Unit Tests (TDD)
- **useFormValidation**: All 5 field validation rules + edge cases
- **useBacktestPolling**: Polling intervals, timeout logic, error retry, onComplete/onError callbacks
- **formatters.ts**: Currency, crypto, percentage formatting
- **backtest-api.ts**: HTTP request construction, response parsing, error handling

### Component Tests (React Testing Library)
- **ConfigurationForm**: Render, input changes, validation errors, submit, disabled state
- **PnlSummary**: Render metrics, color coding, formatting
- **SafetyOrderChart**: Render bar chart, list view toggle, empty state
- **TradeEventsTable**: Render table, sorting, pagination/virtual scrolling

### Integration Tests
- **Form → Submission Flow**: Fill form, submit, verify API call, handle response
- **Polling Flow**: Submit form → wait for polling → verify status updates
- **Error Handling**: Network errors, timeout, retry flow
- **View Transitions**: Verify correct view renders after each state change

### E2E Tests (Optional, Phase 9)
- **Full User Journey**: Load app → fill form → submit → wait → view results

### Test Coverage Goals
- Line coverage: >80%
- Branch coverage: >75%
- Function coverage: >85%
- All user stories (1-7) covered by automated tests

## Complexity Tracking

> No violations of Constitution gates identified. Feature 005 cleanly separates concerns: core domain logic remains in core-engine (Go/Rust) and API Layer (Feature 004); frontend is pure UI adapter with no arithmetic or state machine logic.

| Aspect | Status | Notes |
|--------|--------|-------|
| No live trading | ✅ PASS | Frontend only reads results; no broker connections |
| Green Light Protocol | ✅ PASS | All 7 user stories have BDD acceptance scenarios |
| Fixed-point arithmetic | ✅ PASS | Frontend displays only; no calculations |
| Architecture (polyglot) | ✅ PASS | Frontend in orchestrator/ui; core in core-engine |
| Test coverage | 🟡 IN PROGRESS | Target >80% by Phase 8 |

---

## Next Steps

1. **Phase 0 Complete**: Review constitution gates (✅ all pass)
2. **Phase 1 (Days 1-2)**: Initialize Vite project, configure TypeScript/ESLint/Jest
3. **Phase 2 (Days 3-5)**: Build ConfigurationForm, API submission, backtest ID retrieval
4. **Phase 3 (Days 6-7)**: Implement useBacktestPolling hook, polling UI, timeouts
5. **Phases 4-6 (Days 8-13)**: Results display components (metrics, chart, table, dashboard)
6. **Phase 7 (Days 14-15)**: Error handling, edge cases, error boundary
7. **Phase 8 (Days 16-17)**: Comprehensive testing, performance optimization
8. **Phase 9 (Day 18)**: E2E testing, API integration, mock API
9. **Phase 10 (Day 19)**: Documentation, deployment readiness

---

## Appendix: API Contract Summary

### POST /backtest
**Request**:
```typescript
{
  entryPrice: number;           // e.g., 100.00
  amounts: number[];            // [50, 100, 150]
  sequences: number;            // e.g., 3
  leverage: number;             // e.g., 2.0
  marginRatio: number;          // e.g., 0.5 (50%)
}
```

**Response** (201 Created):
```typescript
{
  backtestId: string;           // e.g., "abc123xyz"
  status: string;               // 'pending'
}
```

### GET /backtest/{id}/status
**Response**:
```typescript
{
  backtestId: string;
  status: 'pending' | 'completed' | 'failed';
  failureReason?: string;       // if status='failed'
  progress?: number;            // optional: 0-100%
}
```

### GET /backtest/{id}/results
**Response** (200 OK):
```typescript
{
  backtestId: string;
  pnlSummary: {
    roi: number;                // e.g., 12.34 (percentage)
    maxDrawdown: number;         // e.g., -5.67 (percentage)
    totalFees: number;           // e.g., 45.67 (currency)
  };
  safetyOrderUsage: {
    "SO1": number;              // count
    "SO2": number;
    "SO3": number;
    // ...
  };
  tradeEvents: [
    {
      timestamp: string;        // ISO 8601
      eventType: 'entry' | 'safety' | 'exit';
      price: number;
      quantity: number;
      balance: number;
    },
    // ... more events
  ];
}
```
