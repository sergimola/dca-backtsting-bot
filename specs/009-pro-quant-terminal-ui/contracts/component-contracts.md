# Component Interface Contracts: Pro Quant Terminal UI

**Feature**: `009-pro-quant-terminal-ui`
**Type**: Internal component contracts (props interfaces & callback signatures)

This feature exposes no external HTTP APIs. Its "contracts" are the TypeScript props interfaces
that define the boundary between each component and its parent. These are authoritative — any
deviation during implementation must be reviewed against the tasks.md constitution gates.

---

## `App.tsx` — Root State & Callbacks

```ts
// State shape (internal to App.tsx — not a props interface)
interface AppState {
  runs: Run[]                  // append-only; ordered newest-first for sidebar display
  selectedRunId: string | null
  activeView: 'history' | 'config'
  submitError: string | null   // cleared on next successful submit
  isSubmitting: boolean
}

// Callbacks passed down to children
handleNewBacktest():   void          // activeView → 'config'; selectedRunId → null
handleSubmit(config: BacktestFormState): Promise<void>
  // On resolve: append Run(status:'running', progress:0), selectedRunId → run.backtestId, activeView → 'history'
  // On reject:  submitError → error.message; no Run appended
handleRunComplete(backtestId: string, results: BacktestResults): void
  // Update matching Run: status → 'completed', results → results, progress → 100
handleRunFail(backtestId: string, errorMsg: string): void
  // Update matching Run: status → 'failed', append errorMsg to logs
handleLogsUpdate(backtestId: string, log: string): void
  // Append log to matching Run.logs[]
handleProgressUpdate(backtestId: string, progress: number): void
  // Update matching Run: progress → progress (0–100 integer)
  // Called exclusively by RunPollingController; never by LiveTerminalView
handleSelectRun(backtestId: string): void
  // selectedRunId → backtestId; activeView → 'history'
handleViewDashboard(backtestId: string): void
  // selectedRunId → backtestId; activeView → 'history'
```

---

## `LeftSidebar` Props

```ts
interface LeftSidebarProps {
  runs: Run[]
  selectedRunId: string | null
  onNewBacktest: () => void
  onSelectRun: (backtestId: string) => void
  onViewDashboard: (backtestId: string) => void
}
```

**Invariants**:
- Renders runs newest-first.
- Manages `expandedRunId: string | null` locally (not lifted to `App`).
- `onSelectRun` fires on card body click; `onViewDashboard` fires on "View Full Dashboard" button click.

---

## `RunCard` Props

```ts
interface RunCardProps {
  run: Run
  isSelected: boolean
  isExpanded: boolean           // controlled by LeftSidebar's local expandedRunId state
  onSelect: () => void          // called on card body click
  onViewDashboard: () => void   // called on "View Full Dashboard" button
  onToggleExpand: () => void    // called on card body click (same gesture as onSelect)
}
```

**Invariants**:
- Only `completed` runs are expandable. `isExpanded=true` + `status !== 'completed'` → render collapsed.
- "View Full Dashboard" button only renders when `isExpanded && status === 'completed'`.

---

## `ConfigFormView` Props

```ts
interface ConfigFormViewProps {
  onSubmit: (config: BacktestFormState) => Promise<void>
  isSubmitting: boolean
  error: string | null
}
```

**Invariants**:
- Submit button disabled when `isSubmitting === true`.
- Submit button disabled when any required field fails NaN-validation.
- `onSubmit` receives a `BacktestFormState` with all 13 fields populated; numeric fields are
  validated as parseable before `onSubmit` is called.
- `error` prop renders an inline error banner; cleared externally by `App.tsx` on next submit.

---

## `LiveTerminalView` Props

```ts
interface LiveTerminalViewProps {
  run: Run   // run.status must be 'running' or 'failed'
}
```

**Invariants**:
- **Dumb display component — zero HTTP timers.** `LiveTerminalView` MUST NOT call `useRunPolling`,
  `useBacktestPolling`, `getStatus`, `getResults`, `setInterval`, or `setTimeout`. All polling is
  owned exclusively by the invisible `RunPollingController` components in `App.tsx`.
- Renders `run.logs[]` as-is (owned by `App.tsx`; never duplicated locally).
- Renders `run.progress` as the progress bar fill width (e.g., `style={{ width: run.progress + '%' }}`).
- When `run.status === 'failed'`, renders the last entry of `run.logs[]` as the error message and
  shows a retry note. Retry is initiated by the user returning to `ConfigFormView` (clicking `+`);
  the `LiveTerminalView` has no retry callback.

---

## `RunPollingController` Props (invisible component)

```ts
interface RunPollingControllerProps {
  backtestId: string
  onComplete: (backtestId: string, results: BacktestResults) => void
  onFail: (backtestId: string, error: string) => void
  onLogsUpdate: (backtestId: string, log: string) => void
  onProgressUpdate: (backtestId: string, progress: number) => void
}
```

**Invariants**:
- Returns `null` from render (invisible).
- **Sole owner of all polling.** This is the ONLY component that calls `useRunPolling` or
  `useBacktestPolling`. No other component in the tree may initiate HTTP polling.
- One instance per running run, keyed by `backtestId`.
- Unmounted when the run's status changes away from `'running'`.
- Calls `onProgressUpdate(backtestId, progress)` whenever `useRunPolling` advances the progress
  value, pushing progress into global `App.tsx` state so it survives any view switch.

---

## `useRunPolling` Hook Signature

```ts
interface UseRunPollingProps {
  backtestId: string
  onComplete: (results: BacktestResults) => void
  onFail: (errorMsg: string) => void
  onLogUpdate: (backtestId: string, log: string) => void
  onProgressUpdate: (backtestId: string, progress: number) => void
}

// No return value needed — all output flows through callbacks
function useRunPolling(props: UseRunPollingProps): void
```

**Invariants** (Constitution Gate — No Fake Timers):
- MUST call `useBacktestPolling` with `pollInterval: 2000` and `timeoutThreshold: 300_000`.
- MUST NOT contain any `setTimeout`, `setInterval`, or fabricated progress arrays.
- Calls `onProgressUpdate(backtestId, progress)` on each poll cycle using the heuristic:
  `Math.min(Math.floor(elapsedSeconds / 300 * 100), 95)` — caps at 95 until `completed`;
  then fires once more with `100` before calling `onComplete`.
- Progress flows: `useRunPolling` → `onProgressUpdate` → `RunPollingController.onProgressUpdate`
  → `App.handleProgressUpdate` → `runs[]` state → `run.progress` prop → `LiveTerminalView`.
  `LiveTerminalView` is never in this chain as an initiator.

---

## `DashboardView` Props

```ts
interface DashboardViewProps {
  run: Run   // run.status must be 'completed'; run.results must be defined
}
```

**Invariants**:
- Calls `useResultsMetrics(run.results!, run.config)` to get `DashboardMetrics`.
- All child components receive slices of `DashboardMetrics`; none access `run.results` directly.

---

## `useResultsMetrics` Hook Signature

```ts
function useResultsMetrics(
  results: BacktestResults,
  config: BacktestFormState
): DashboardMetrics
```

**Invariants**:
- Wrapped in `useMemo` keyed on `results.backtestId`.
- Uses `decimal.js` for all intermediate summations.
- Returns plain `number` values (`.toNumber()`); no `Decimal` objects in return value.
- `maxDrawdown` and `totalFees` are pass-throughs from `pnlSummary` — no re-computation.

---

## `KpiGrid` Props

```ts
interface KpiGridProps {
  metrics: DashboardMetrics
}
```

---

## `SafetyOrderUsagePanel` Props

```ts
interface SafetyOrderUsagePanelProps {
  safetyOrderUsage: SafetyOrderUsage[]
  totalTrades: number
}
```

---

## `ConfigSummaryPanel` Props

```ts
interface ConfigSummaryPanelProps {
  config: BacktestFormState
}
```

---

## `DashboardHeader` Props

```ts
interface DashboardHeaderProps {
  run: Run
  executionMs?: number   // optional; rendered if provided; omitted if not in results payload
}
```

---

## `TradeAccordion` Props

```ts
interface TradeAccordionProps {
  metrics: TradeGroupMetrics
}
```

**Invariants**: Manages `open: boolean` locally. No callback to parent.

---

## `TradeAccordionHeader` Props

```ts
interface TradeAccordionHeaderProps {
  metrics: TradeGroupMetrics
  isOpen: boolean
  onToggle: () => void
}
```

**Invariants** (Constitution Gate — group-hover CSS):
- Root element MUST have `className` containing `"group"`.
- MAE tooltip wrapper MUST have `data-testid="mae-tooltip"` and class `hidden group-hover/mae:block`.
- Capital tooltip wrapper MUST have `data-testid="capital-tooltip"` and class `hidden group-hover/capital:block`.

---

## `TradeOrdersTable` Props

```ts
interface TradeOrdersTableProps {
  events: TradeEvent[]
}
```
