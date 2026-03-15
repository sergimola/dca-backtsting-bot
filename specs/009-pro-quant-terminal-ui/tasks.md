---
description: "Task list for 009-pro-quant-terminal-ui — Pro Quant Terminal UI overhaul"
---

# Tasks: Pro Quant Terminal UI

**Feature Branch**: `009-pro-quant-terminal-ui`
**Input**: [spec.md](spec.md), [plan.md](plan.md), [data-model.md](data-model.md)
**Layer**: `[frontend]` — All tasks in this feature live exclusively in `frontend/src/`. This is a
pure UI layer with zero changes to `core-engine/` or `orchestrator/api/`.

**Constitution Gates Active**:
1. **Green Light Protocol** — Run `npm test` in `frontend/` before every commit. No commit is
   permitted while any test is failing.
2. **No Fake Timers** — `useRunPolling` (called exclusively from `RunPollingController`) MUST wire
   into the real `useBacktestPolling` hook. `LiveTerminalView` is a dumb display component and
   MUST NOT call any polling hook or API function. No `setTimeout` mock progression, no fabricated
   log arrays, no simulated progress counters.
2a. **Centralized Polling** — The ONLY component permitted to initiate HTTP polling is
   `RunPollingController`. `LiveTerminalView`, `DashboardView`, `RunCard`, and every other
   component are strictly receive-only. Violations block merge.
2b. **Progress in Global State** — `run.progress` lives in `App.tsx`'s `runs[]` array and is
   updated exclusively via `handleProgressUpdate`. This ensures the progress bar value survives
   any `LiveTerminalView` unmount/remount caused by the user switching views.
3. **Type-Casting Guardrail** — Every numeric string field from `BacktestFormState` (`priceEntry`,
   `priceScale`, `amountScale`, `numberOfOrders`, `amountPerTrade`, `multiplier`,
   `takeProfitDistancePercent`, `accountBalance`) MUST be cast with `parseFloat()` / `parseInt()`
   before the payload leaves `ConfigFormView`. Passing raw strings to `submitBacktest` is a
   blocking defect.
4. **Display-Only Arithmetic** — No re-computation of PnL or ROI in UI components. All derived
   values (MAE, Max Capital Deployed, Profit Factor, Win Rate) MUST be computed once in the
   `useResultsMetrics` hook and passed down as pre-computed props. No inline math in JSX.
5. **group-hover CSS** — The MAE and Max Capital Deployed tooltips on trade accordion headers MUST
   be implemented using Tailwind's `group` / `group-hover:block` pattern. This MUST be explicitly
   verified in T031's test before implementation.

**Format legend**:
- `[P]` = can run in parallel with other `[P]` tasks in the same phase (different files, no deps)
- `[US1]`…`[US4]` = which user story this task directly delivers
- `[frontend]` = `frontend/src/` layer only

---

## Phase 0: Foundation — Type Definitions & App Shell

**Purpose**: Establish the `Run` state shape, the top-level `App.tsx` shell, and the global CSS
custom scrollbar before any view or hook can reference them. All downstream tasks in Phases 1–4
depend on at least T001 and T002.

**⚠️ BLOCKING**: No Phase 1–4 task may begin until T001 and T003 are complete.

- [X] **T001** [frontend] [US1] **Define `Run` type in `frontend/src/services/types.ts`**
  Add the `Run` interface alongside existing `BacktestFormState` and `BacktestResults` types:
  ```ts
  export type RunStatus = 'running' | 'completed' | 'failed'

  export interface Run {
    backtestId: string          // backend-assigned, used as stable React key
    shortId: string             // first 8 chars of backtestId for display
    status: RunStatus
    config: BacktestFormState   // original 13-field parameter set
    results?: BacktestResults   // populated on completion; undefined while running/failed
    logs: string[]              // status messages accumulated during polling; append-only
    progress: number            // 0–100; owned by App.tsx, updated by RunPollingController
    createdAt: string           // ISO timestamp, set at run creation
  }
  ```
  _No test file required — this is a pure type definition. Correctness is enforced by downstream
  TypeScript compilation._

- [X] **T002** [P] [frontend] [US1] **Write tests for App shell state machine** (TEST-FIRST)
  Create `frontend/src/__tests__/App.test.tsx`. Tests MUST cover:
  - Initial render shows `ConfigFormView` (no runs, no selectedRunId).
  - Clicking `+` when a run is running does NOT call `clearInterval` on any existing polling.
  - `selectedRunId` switches to new run on submit; existing runs remain in `runs[]` array unchanged.
  - Selecting a completed run from the sidebar sets `selectedRunId` to that run's `backtestId`.
  Mock `submitBacktest` at the module boundary (vi.mock / jest.mock). Do NOT mock polling
  internals; use mock API responses. Confirm tests FAIL before T003 is written.

- [X] **T003** [frontend] [US1] **Rewrite `frontend/src/App.tsx` as the split-view shell** (depends on T001, T002)
  Replace the existing single-column wizard `App.tsx` entirely with:
  - State: `runs: Run[]`, `selectedRunId: string | null`, `activeView: 'history' | 'config'`.
  - Method `handleNewBacktest()`: sets `activeView = 'config'`, sets `selectedRunId = null`.
  - Method `handleSubmit(config: BacktestFormState)`: calls `submitBacktest(config)`, then on
    resolve adds a new `Run` to `runs[]` (status: `'running'`), sets `selectedRunId`, sets
    `activeView = 'history'`. On rejection: sets an `error` string in local state; does NOT create
    a `Run` entry.
  - Method `handleRunComplete(backtestId, results)`: finds the run in `runs[]` by `backtestId`,
    sets `status = 'completed'`, `results = results`, and `progress = 100`.
  - Method `handleRunFail(backtestId, errorMsg)`: updates matching run to `status = 'failed'`,
    appends error to `logs[]`.
  - Method `handleLogsUpdate(backtestId, newLog)`: appends to the matching run's `logs[]`.
  - Method `handleProgressUpdate(backtestId, progress)`: updates the matching run's `progress`
    field to the given 0–100 integer. Called exclusively by `RunPollingController`; no other
    component may call this.
  - Layout: `h-screen overflow-hidden bg-[#050810] text-slate-200 font-sans flex`.
  - Left: `<LeftSidebar>` (w-80). Right: `flex-1 overflow-y-auto custom-scrollbar`. Render exactly
    one of `<ConfigFormView>`, `<LiveTerminalView>`, or `<DashboardView>` in the right pane based
    on `activeView` and the selected run's `status`.
  - Inject a `<style>` block for `.custom-scrollbar::-webkit-scrollbar` (6px), transparent track,
    `#1e293b` thumb. This is the single source of truth for scrollbar style; do not duplicate it.
  - Ensure `ErrorBoundary` wraps the entire layout.
  Green Light: run `npm test` — T002 tests must now pass.

---

## Phase 1: Left Sidebar (User Stories 1, 2, 3)

**Purpose**: Deliver the persistent left sidebar with the run history list and all run card states.
This phase is the backbone of concurrent-run UX (US2) and historical navigation (US3).

- [X] **T004** [P] [frontend] [US1] **Write tests for `RunCard` component** (TEST-FIRST)
  Create `frontend/src/__tests__/components/RunCard.test.tsx`. Tests MUST cover:
  - `running` status: renders `Loader2` spin icon, "Processing..." text, no ROI/PnL values.
  - `failed` status: renders red indicator icon, "Failed" text.
  - `completed` status (collapsed): renders ROI (green for positive, red for negative) and Net PnL.
  - `completed` status (expanded): renders total orders, price scale, Max Drawdown, "View Full
    Dashboard" button, and—when `unusedSafetyOrders > 0`—renders `AlertCircle` and amber warning.
  - Selected card has `shadow-[0_0_15px_rgba(59,130,246,0.05)]` in className.
  - Clicking "View Full Dashboard" fires `onViewDashboard` callback.
  Confirm tests FAIL before T005 is written.

- [X] **T005** [frontend] [US1] **Implement `frontend/src/components/RunCard.tsx`** (depends on T004)
  A single run card component, accordion-style:
  - Props: `run: Run`, `isSelected: boolean`, `isExpanded: boolean`, `onSelect: () => void`,
    `onViewDashboard: () => void`.
  - Collapsed state (always visible): short ID pill, trading pair, "START → END" date range,
    creation timestamp. Conditional status area per `run.status`.
  - Expanded state (only when `completed` and `isExpanded`): total order count (from
    `run.results.tradeEvents` length), price scale from `run.config.priceScale`, Max Drawdown from
    `run.results.pnlSummary.maxDrawdown`. Unused SO warning: compare
    `run.results.safetyOrderUsage.length` with `parseInt(run.config.numberOfOrders)` — if fewer
    levels triggered than configured, show amber `AlertCircle` + "X unused safety orders" message.
  - Selected card styles: `bg-blue-500/5 border border-blue-500/30
    shadow-[0_0_15px_rgba(59,130,246,0.05)]`.
  - Import only: `Loader2`, `AlertCircle`, `TrendingDown` from `lucide-react`.
  Green Light: run `npm test` — T004 tests must pass.

- [X] **T006** [P] [frontend] [US1] **Write tests for `LeftSidebar` component** (TEST-FIRST)
  Create `frontend/src/__tests__/components/LeftSidebar.test.tsx`. Tests MUST verify:
  - Renders "QuantDCA" header text and `+` button.
  - Clicking `+` fires `onNewBacktest` callback.
  - Renders one `RunCard` per entry in `runs[]`.
  - The correct `RunCard` has `isSelected=true` for the `selectedRunId`.
  Confirm tests FAIL before T007 is written.

- [X] **T007** [frontend] [US1] **Implement `frontend/src/components/LeftSidebar.tsx`** (depends on T005, T006)
  - Props: `runs: Run[]`, `selectedRunId: string | null`, `onNewBacktest: () => void`,
    `onSelectRun: (backtestId: string) => void`, `onViewDashboard: (backtestId: string) => void`.
  - Header area: logo placeholder + "QuantDCA" text + primary blue `+` button (icon: `Plus` from
    lucide-react) in top right — calls `onNewBacktest`.
  - Scrollable list: `overflow-y-auto custom-scrollbar flex-1`. Maps `runs[]` (newest first) to
    `<RunCard>` components. Manages a local `expandedRunId` string state — clicking a completed
    card toggles expansion independently of `selectedRunId`.
  - Width: fixed `w-80`, full height `h-full`, vertical flex column, dark border-right divider.
  Green Light: run `npm test` — T006 tests must pass.

---

## Phase 2: ConfigFormView (User Story 1)

**Purpose**: The 13-field configuration form that initiates a run. Must strictly cast numeric
strings before submission.

- [X] **T008** [P] [frontend] [US1] **Write tests for `ConfigFormView`** (TEST-FIRST)
  Create `frontend/src/__tests__/components/ConfigFormView.test.tsx`. Critical assertions:
  - All 13 input fields render with correct labels.
  - `startDate` and `endDate` inputs have `type="datetime-local"`.
  - `priceScale` wrapper contains a `%` suffix element.
  - `amountScale` wrapper contains an `x` suffix element.
  - `takeProfitDistancePercent` wrapper contains a green `%` suffix.
  - `accountBalance` wrapper contains a `$` prefix.
  - `exitOnLastOrder` renders a div-based toggle switch (no `<input type="checkbox">`).
  - `marginType` renders `<select>` with "isolated" and "cross" options.
  - Submit button is disabled when any required field is empty.
  - **Constitution Gate Test**: When submit fires, `onSubmit` MUST be called with the numeric
    fields cast to their correct JS primitives: `amountPerTrade` as `number` between 0–1,
    `numberOfOrders` as an integer, `priceScale` and `amountScale` as floats. Test MUST assert
    `typeof payload.amountPerTrade === 'string'` is FALSE — i.e., the form does not pass raw
    strings through.
  - Inline error message renders when `error` prop is non-null.
  - Submit button shows loading spinner and is disabled during `isSubmitting=true`.
  Confirm tests FAIL before T009 is written.

- [X] **T009** [frontend] [US1] **Implement `frontend/src/components/ConfigFormView.tsx`** (depends on T008)
  - Props: `onSubmit: (config: BacktestFormState) => Promise<void>`, `isSubmitting: boolean`,
    `error: string | null`.
  - Layout: two-column — left 1/3 (icon, title "New Backtest", description text), right 2/3
    (2-column grid of inputs).
  - All 13 fields wired to local `useState` string values, mirroring `BacktestFormState`.
  - **CONSTITUTION GATE — Type-Casting Guardrail**: The submit handler MUST cast ALL numeric
    string fields before building the `BacktestFormState` object:
    ```ts
    const config: BacktestFormState = {
      tradingPair: form.tradingPair.trim(),
      startDate:   form.startDate,
      endDate:     form.endDate,
      priceEntry:  form.priceEntry,            // kept as string per BacktestFormState type
      priceScale:  form.priceScale,            // kept as string per BacktestFormState type
      amountScale: form.amountScale,           // kept as string per BacktestFormState type
      numberOfOrders: form.numberOfOrders,     // kept as string per BacktestFormState type
      amountPerTrade: form.amountPerTrade,     // kept as string per BacktestFormState type
      marginType:  form.marginType as 'cross' | 'isolated',
      multiplier:  form.multiplier,            // kept as string per BacktestFormState type
      takeProfitDistancePercent: form.takeProfitDistancePercent,
      accountBalance: form.accountBalance,     // kept as string per BacktestFormState type
      exitOnLastOrder: form.exitOnLastOrder,
    }
    ```
    Note: `BacktestFormState` keeps all numeric fields as strings (see `frontend/src/services/types.ts`).
    The casting gate here means: validate they are parseable numbers (parseFloat/parseInt returns
    non-NaN) before allowing submit, and pass through as strings to match the existing interface.
    `submitBacktest` in `backtest-api.ts` performs the final parseInt/parseFloat inside its payload
    builder — do not duplicate that conversion.
  - `exitOnLastOrder`: hidden `<input type="checkbox">` driven by a purely CSS toggle div
    (`peer` pattern or equivalent). Must visually animate on/off.
  - Validation: submit button disabled unless `tradingPair`, `startDate`, `endDate` are non-empty
    AND all numeric string fields parse to a non-NaN value.
  - On submit: call `onSubmit(config)`, display caught errors in the inline error area.
  - Lucide icons used: `Settings2` for header, `Loader2` for submitting spinner.
  Green Light: run `npm test` — T008 tests must pass.

---

## Phase 3: LiveTerminalView & Real Polling Hook (User Stories 1 & 2)

**Purpose**: The live processing view. The most constitution-sensitive phase — real polling only.

- [X] **T010** [P] [frontend] [US1] **Write tests for `useRunPolling` hook** (TEST-FIRST)
  Create `frontend/src/__tests__/hooks/useRunPolling.test.ts`. This hook is called exclusively
  from `RunPollingController` and pushes all state changes up via callbacks. Critical test
  assertions:
  - Hook accepts `backtestId`, `onComplete`, `onFail`, `onLogUpdate`, `onProgressUpdate`.
  - **Constitution Gate Test (No Fake Timers)**: test MUST mock `useBacktestPolling` at the module
    boundary (not mock `setInterval` directly). Verify the hook passes `backtestId` unchanged to
    `useBacktestPolling`. The real interval/timeout values (2000ms, 300s) must not be overridden.
  - When `useBacktestPolling` reports `status === 'completed'`, the hook fires `onProgressUpdate`
    with `100` and then calls `onComplete` with the `BacktestResults` payload.
  - When `useBacktestPolling` reports `status === 'failed'` or `status === 'timeout'`, the hook
    calls `onFail` with an error string.
  - When `useBacktestPolling` reports status change to `'downloading'`, `onLogUpdate` is called
    with a timestamped "Downloading market data…" log message.
  - When `useBacktestPolling` reports status change to `'pending'`, `onProgressUpdate` is called
    with the heuristic value `Math.min(Math.floor(elapsedSeconds / 300 * 100), 95)`.
  - **Architecture Gate Test**: assert the hook returns `void` (or `undefined`). It MUST NOT
    return a `progress` value — progress flows through `onProgressUpdate`, not the return value.
  Confirm tests FAIL before T011 is written.

- [X] **T011** [frontend] [US1] **Implement `frontend/src/hooks/useRunPolling.ts`** (depends on T010)
  A thin orchestration hook that wraps `useBacktestPolling` and pushes all output upward via
  callbacks. Called only from `RunPollingController`.
  - Signature: `useRunPolling({ backtestId, onComplete, onFail, onLogUpdate, onProgressUpdate }): void`.
  - **CONSTITUTION GATE — No Fake Timers**: Internally calls `useBacktestPolling` with:
    - `backtestId` passed through unchanged.
    - `pollInterval: 2000` (hardcoded — do NOT expose as prop).
    - `timeoutThreshold: 5 * 60 * 1000` (5 minutes — hardcoded).
    - `onComplete`: fires `onProgressUpdate(backtestId, 100)`, then calls `getResults(backtestId)`,
      then fires `onComplete(results)`. Order matters — progress reaches 100 before view switches.
    - `onError`: fires `onFail(error.message)`.
    - `onTimeout`: fires `onFail('Polling timeout: backtest exceeded 5 minutes')`.
  - On each poll cycle: calls `onLogUpdate(backtestId, message)` with a timestamped message
    matching the backend status string (e.g., `[10:42:01] DOWNLOADING_DATA`).
  - On each poll cycle: calls `onProgressUpdate(backtestId, Math.min(Math.floor(elapsedSeconds / 300 * 100), 95))`.
  - Returns `void`. No return value. All output is via callbacks.
  Green Light: run `npm test` — T010 tests must pass.

- [X] **T012** [P] [frontend] [US1] **Write tests for `LiveTerminalView`** (TEST-FIRST)
  Create `frontend/src/__tests__/components/LiveTerminalView.test.tsx`. Tests MUST verify:
  - Renders `run.shortId` and `run.config.tradingPair`.
  - Progress bar fill width equals `run.progress + '%'` (inline style or equivalent).
  - Progress bar inner div has an `animate-` class (shimmer/pulse — exact class TBD in T013).
  - Renders all strings in `run.logs[]` as individual lines in the console output area.
  - A dummy `ref` div exists at the bottom of the log list (for `scrollIntoView` auto-scroll).
  - A blinking cursor element is present (`animate-pulse` class).
  - **Architecture Gate Test (Centralized Polling)**: assert that the rendered component does NOT
    call `useRunPolling`, `useBacktestPolling`, or any function from `backtest-api.ts`. Accomplish
    this by verifying none of those modules are imported by `LiveTerminalView.tsx`:
    `grep -n "useRunPolling\|useBacktestPolling\|backtest-api" frontend/src/components/LiveTerminalView.tsx`
    MUST return no matches. Do NOT use `jest.useFakeTimers()` anywhere in this test file.
  - When `run.status === 'failed'`, a user-facing message is displayed and a suggestion to click
    `+` to start a new run is shown (no retry callback prop needed).
  Confirm tests FAIL before T013 is written.

- [X] **T013** [frontend] [US1] **Implement `frontend/src/components/LiveTerminalView.tsx`** (depends on T012)
  **This is a dumb display component. It contains zero API calls, zero polling hooks.**
  - Props: `run: Run` only.
  - **ARCHITECTURE GATE — No Polling Here**: `LiveTerminalView.tsx` MUST NOT import `useRunPolling`,
    `useBacktestPolling`, `getStatus`, `getResults`, or `backtest-api`. All those live in
    `RunPollingController`. This component only reads `run.progress`, `run.logs`, `run.status`.
  - Layout: centered column. Header: `TerminalSquare` icon + `run.shortId` + `run.config.tradingPair`.
  - Mac terminal chrome: fake red/yellow/green dots div above the console area.
  - Progress bar: full-width, blue fill driven by `run.progress` (e.g.,
    `style={{ width: run.progress + '%' }}`). Inner `absolute` div with
    `bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_1.5s_infinite]`.
  - Console area: `bg-[#0a0d14]` div, `overflow-y-auto custom-scrollbar`, maps `run.logs[]`.
    Uses a `bottomRef = useRef<HTMLDivElement>(null)` and a `useEffect` keyed on `run.logs.length`
    to call `bottomRef.current?.scrollIntoView({ behavior: 'smooth' })` as new logs arrive.
  - Blinking cursor: `<span className="inline-block w-2 h-4 bg-slate-400 animate-pulse ml-1" />`.
  - Failed state: when `run.status === 'failed'`, show the last entry in `run.logs[]` as the
    error message and a note: "Click + to configure and start a new run."
  - Note: depends on T012 only (not T011) — this component has no hook dependencies at all.
  Green Light: run `npm test` — T012 tests must pass.

---

## Phase 4: DashboardView — Data Mapping Hook (User Stories 3 & 4)

**Purpose**: Transform raw `BacktestResults` into display-ready metrics. Separate from rendering
per Constitution Gate 4 (display-only arithmetic).

- [X] **T014** [P] [frontend] [US3] **Write tests for `useResultsMetrics` hook** (TEST-FIRST)
  Create `frontend/src/__tests__/hooks/useResultsMetrics.test.ts`. Test using the fixture data
  already established in `frontend/src/__tests__/services/backtest-api.test.ts` where available.
  Assertions MUST cover:
  - `netProfit`: equals sum of all EXIT-type `TradeEvent.balance` values.
  - `totalFees`: equals sum of all `TradeEvent.fee` values across all events.
  - `roi`: equals `(netProfit / parseFloat(config.accountBalance)) * 100`.
  - `winRate`: `(winCount / totalTrades) * 100` where a win is a trade whose EXIT `balance > 0`.
  - `profitFactor`: `grossWins / grossLosses` where grossWins/grossLosses sum EXIT balances.
  - `capitalUtilized`: sum of all buy-side (ENTRY + SAFETY_ORDER) `balance` values divided by
    `parseFloat(config.accountBalance) * 100` expressed as percentage.
  - `maxDrawdown`: taken directly from `results.pnlSummary.maxDrawdown` (no re-computation).
  - Per-trade `mae` (Max Adverse Excursion): minimum of `(fill.price - entryPrice) / entryPrice`
    across all buy fills in the trade group.
  - Per-trade `maxCapitalDeployed`: sum of all ENTRY + SAFETY_ORDER `balance` values in the group.
  - Per-trade `durationHours`: difference between first and last event timestamps in hours.
  Confirm tests FAIL before T015 is written.

- [X] **T015** [frontend] [US3] **Implement `frontend/src/hooks/useResultsMetrics.ts`** (depends on T014)
  - Signature: `useResultsMetrics(results: BacktestResults, config: BacktestFormState): DashboardMetrics`.
  - Return type `DashboardMetrics` defined in `frontend/src/services/types.ts` (add alongside `Run`
    type from T001):
    ```ts
    export interface TradeGroupMetrics {
      tradeId: string
      events: TradeEvent[]
      status: 'CLOSED' | 'OPEN'
      grossProfit: number
      totalFees: number
      netProfit: number
      durationHours: number
      mae: number                  // Max Adverse Excursion (negative = loss)
      maxCapitalDeployed: number
    }
    export interface DashboardMetrics {
      netProfit: number
      totalFees: number
      roi: number
      winRate: number
      profitFactor: number
      capitalUtilized: number
      maxDrawdown: number          // pass-through from pnlSummary
      accountEquity: number        // accountBalance + netProfit
      tradeGroups: TradeGroupMetrics[]
      safetyOrderUsage: SafetyOrderUsage[]
    }
    ```
  - Use `decimal.js` (already installed — see `ResultsDashboard.tsx`) for all intermediate
    summations to prevent float drift. Return plain `number` from `.toNumber()` for rendering.
  - Wrap in `useMemo` keyed on `results.backtestId` to prevent re-computation on parent re-renders.
  Green Light: run `npm test` — T014 tests must pass.

---

## Phase 5: DashboardView — Scaffold & KPI Grid (User Story 3)

- [X] **T016** [P] [frontend] [US3] **Write tests for `DashboardHeader`** (TEST-FIRST)
  Create `frontend/src/__tests__/components/DashboardHeader.test.tsx`. Verify:
  - Renders run short ID.
  - Renders start date and end date formatted as "YYYY-MM-DD".
  - Renders computed duration string (e.g., "42 days").
  - Renders execution ms if provided (non-null).
  Confirm tests FAIL before T017 is written.

- [X] **T017** [P] [frontend] [US3] **Implement `frontend/src/components/DashboardHeader.tsx`** (depends on T016)
  - Props: `run: Run`, `executionMs?: number`.
  - Derives duration from `new Date(run.config.endDate).getTime() - new Date(run.config.startDate).getTime()`.
  - Lucide icons: `Calendar`, `Clock`, `Hash`.

- [X] **T018** [P] [frontend] [US3] **Write tests for `KpiGrid`** (TEST-FIRST)
  Create `frontend/src/__tests__/components/KpiGrid.test.tsx`. Verify:
  - All 8 KPI cards render: Account Equity, Net Profit, ROI, Profit Factor, Total Fees, Capital
    Utilized, Max Drawdown, Win Rate.
  - Each card contains an appropriate Lucide icon element.
  - Each value container has `tabular-nums` in its className.
  - ROI card applies green text class when ROI > 0, red when ROI < 0.
  Confirm tests FAIL before T019 is written.

- [X] **T019** [P] [frontend] [US3] **Implement `frontend/src/components/KpiGrid.tsx`** (depends on T018)
  - Props: `metrics: DashboardMetrics`.
  - 4-column, 2-row CSS grid. Each `KpiCard` has: uppercase slate label (`text-[10px]
    tracking-widest text-slate-500`), Lucide icon, large bold value (`text-2xl font-bold
    tabular-nums`), small subtitle.
  - KPI → Lucide icon mapping: Equity→`Wallet`, Net Profit→`TrendingUp`, ROI→`Percent`,
    Profit Factor→`BarChart2`, Fees→`Receipt`, Capital Utilized→`PieChart`, Max
    Drawdown→`TrendingDown`, Win Rate→`Target`.
  - Format values using existing `formatCurrency` and `formatPercentage` from
    `frontend/src/services/formatters.ts`. Do not add inline math here.

---

## Phase 6: DashboardView — Right Column Panels (User Story 3)

- [X] **T020** [P] [frontend] [US3] **Write tests for `SafetyOrderUsagePanel`** (TEST-FIRST)
  Create `frontend/src/__tests__/components/SafetyOrderUsagePanel.test.tsx`. Verify:
  - Renders one row per entry in `safetyOrderUsage[]`.
  - Each row contains a horizontal `<div>` whose inline `width` style equals the fill percentage.
  - Fill percentage is `count / totalTrades * 100`, clamped to 0–100.
  Confirm tests FAIL before T021 is written.

- [X] **T021** [P] [frontend] [US3] **Implement `frontend/src/components/SafetyOrderUsagePanel.tsx`** (depends on T020)
  - Props: `safetyOrderUsage: SafetyOrderUsage[]`, `totalTrades: number`.
  - Title: "Safety Order Usage" with `text-[10px] tracking-widest uppercase text-slate-500`.
  - Each row: level label ("SO 1", "SO 2", …), percentage fill bar, count/total fraction.

- [X] **T022** [P] [frontend] [US3] **Implement `frontend/src/components/ConfigSummaryPanel.tsx`**
  - Props: `config: BacktestFormState`.
  - A `<dl>` style key-value list of all 13 parameters with human-readable labels.
  - No test file required — this is a pure display component with no conditional logic.

---

## Phase 7: DashboardView — Trade History Accordions (User Story 4)

**This phase enforces Constitution Gate 5 (group-hover tooltips). Tests MUST be written first.**

- [X] **T023** [P] [frontend] [US4] **Write tests for `TradeAccordionHeader`** (TEST-FIRST)
  Create `frontend/src/__tests__/components/TradeAccordionHeader.test.tsx`.
  The critical `group-hover` CSS test — **this must be written before any implementation**:
  - Assert that the MAE tooltip element (`data-testid="mae-tooltip"`) has className containing
    `hidden group-hover:block` (or equivalent `opacity-0 group-hover:opacity-100`).
  - Assert that the Max Capital Deployed tooltip element (`data-testid="capital-tooltip"`) has
    the same hidden-by-default, group-hover-revealed pattern.
  - Assert the MAE icon is `TrendingDown` from lucide-react (check `aria-label` or test-id).
  - Assert the Capital Deployed icon is `PieChart` from lucide-react.
  - Duration badge is `text-emerald-400` when `durationHours < 24`.
  - Duration badge is `text-amber-400` when `24 <= durationHours < 120`.
  - Duration badge is `text-rose-400` when `durationHours >= 120`.
  - Gross PnL renders as positive string with `+` prefix or negative with `-`.
  - Fees render in red-class text.
  - Net PnL renders in green-class text.
  Confirm tests FAIL before T024 is written.

- [X] **T024** [frontend] [US4] **Implement `frontend/src/components/TradeAccordionHeader.tsx`** (depends on T023)
  - Props: `metrics: TradeGroupMetrics`, `isOpen: boolean`, `onToggle: () => void`.
  - Root div: `className="group relative flex items-center gap-2 ..."` — the `group` class is
    **mandatory** for `group-hover:block` to work on child tooltip divs.
  - Left: sequential trade ID pill (`#1`, `#2`, …), "CLOSED" status pill.
  - Duration badge: colored by `metrics.durationHours` thresholds (< 24h → emerald, < 120h →
    amber, ≥ 120h → rose).
  - **CONSTITUTION GATE — group-hover tooltips**:
    MAE icon + tooltip block:
    ```tsx
    <div className="relative group/mae">
      <TrendingDown className="w-3.5 h-3.5 text-rose-400 cursor-pointer" />
      <div data-testid="mae-tooltip"
           className="hidden group-hover/mae:block absolute bottom-full left-1/2 -translate-x-1/2
                      mb-2 px-2 py-1 bg-[#0d1117] border border-slate-700 rounded text-[10px]
                      text-slate-300 whitespace-nowrap z-50 pointer-events-none">
        MAE: {formatCurrency(metrics.mae)}
      </div>
    </div>
    ```
    Capital Deployed icon + tooltip block (same pattern, `data-testid="capital-tooltip"`).
    Use Tailwind's arbitrary group-modifier `group/mae` and `group/capital` to scope each tooltip
    independently so they don't both appear when only one icon is hovered.
  - Far right: Gross (neutral), Fees (red), Net (green) — use `formatCurrency`.
  Green Light: run `npm test` — T023 tests must pass.

- [X] **T025** [P] [frontend] [US4] **Write tests for `TradeOrdersTable`** (TEST-FIRST)
  Create `frontend/src/__tests__/components/TradeOrdersTable.test.tsx`. Verify:
  - Table has columns: Time, Action, Price, Quantity, Cost/PnL, Fee Deducted.
  - ENTRY action cell has `text-emerald-300` class (or `bg-emerald-900/40`).
  - SAFETY_ORDER action cell has `text-slate-200` class (or `bg-slate-600/40`).
  - EXIT action cell has `text-rose-300` class (or `bg-rose-900/40`).
  - Each row renders timestamp from `TradeEvent.timestamp`.
  Confirm tests FAIL before T026 is written.

- [X] **T026** [frontend] [US4] **Implement `frontend/src/components/TradeOrdersTable.tsx`** (depends on T025)
  - Props: `events: TradeEvent[]`.
  - Wrapper `bg-[#080b14]` to create distinct background from accordion header.
  - Action pill mapping reuses the `EVENT_PILL` constant pattern from the existing
    `frontend/src/components/ResultsDashboard.tsx` — extract to
    `frontend/src/services/formatters.ts` as `getEventPillClass(eventType: string): string` to
    avoid duplication.
  - Timestamps: use `new Date(event.rawTimestamp).toLocaleString()`.
  - Price and Quantity: use `formatCurrency` and `formatCryptoQuantity` from `formatters.ts`.
  Green Light: run `npm test` — T025 tests must pass.

- [X] **T027** [P] [frontend] [US4] **Write tests for `TradeAccordion`** (TEST-FIRST)
  Create `frontend/src/__tests__/components/TradeAccordion.test.tsx`. Verify:
  - Collapsed by default: `TradeOrdersTable` is NOT in the DOM (or has `hidden` class).
  - Clicking the header toggles open state.
  - When open: `TradeOrdersTable` IS in the DOM.
  - `TradeAccordionHeader` receives `isOpen` prop that matches current open state.
  Confirm tests FAIL before T028 is written.

- [X] **T028** [frontend] [US4] **Implement `frontend/src/components/TradeAccordion.tsx`** (depends on T024, T026, T027)
  - Props: `metrics: TradeGroupMetrics`.
  - `useState(false)` for open/closed.
  - Renders `<TradeAccordionHeader>` + conditionally renders `<TradeOrdersTable>` in expanded
    state. Add a smooth height transition via `overflow-hidden transition-all` or conditional
    `max-h-0 / max-h-screen` classes.
  Green Light: run `npm test` — T027 tests must pass.

---

## Phase 8: DashboardView — Assembly (User Story 3)

- [X] **T029** [P] [frontend] [US3] **Write tests for `DashboardView`** (TEST-FIRST)
  Create `frontend/src/__tests__/components/DashboardView.test.tsx`. Verify:
  - Renders `DashboardHeader` containing the run's short ID.
  - Renders 8 KPI cards (count `aria-label="kpi-card"` or test-id attributes).
  - Renders the Safety Order Usage panel.
  - Renders the Configuration summary panel.
  - Renders the correct number of `TradeAccordion` items matching the number of unique `trade_id`
    values in `results.tradeEvents`.
  - `useResultsMetrics` is called (mock at module boundary) and its return value is distributed
    to child components.
  Confirm tests FAIL before T030 is written.

- [X] **T030** [frontend] [US3] **Implement `frontend/src/components/DashboardView.tsx`** (depends on T015, T017, T019, T021, T022, T028, T029)
  - Props: `run: Run` (where `run.results` is defined, `run.status === 'completed'`).
  - Calls `useResultsMetrics(run.results!, run.config)` to get `DashboardMetrics`.
  - Layout: scrollable main column, `overflow-y-auto custom-scrollbar`.
  - Top: `<DashboardHeader run={run} />`.
  - Below header: `<KpiGrid metrics={metrics} />`.
  - Below KPIs: 3/4 + 1/4 CSS grid:
    - Left 3/4: `<section>` titled "Trade History" (tracking-widest uppercase). Maps
      `metrics.tradeGroups` to `<TradeAccordion key={tg.tradeId} metrics={tg} />`.
    - Right 1/4: stacked `<SafetyOrderUsagePanel>` and `<ConfigSummaryPanel>`.
  Green Light: run `npm test` — T029 tests must pass.

---

## Phase 9: Integration & Wiring (All User Stories)

- [X] **T031** [frontend] [US1/US2/US3/US4] **Write integration test for concurrent-run flow** (TEST-FIRST)
  Create `frontend/src/__tests__/integration/concurrent-runs.test.tsx`.
  This is the key US2 acceptance test. Assertions:
  - Submit Run A → sidebar shows one card with `Loader2` spinner.
  - Without awaiting Run A completion, clicking `+` again shows `ConfigFormView` in main area.
  - Submitting Run B → sidebar shows two cards both with `Loader2` spinner.
  - Mock `useBacktestPolling` for both `backtestId` values independently (return different
    mock states per `backtestId`).
  - Resolving Run A does NOT affect Run B's polling state.
  - After both resolve: sidebar shows two completed cards with ROI values.
  - Clicking Run A → DashboardView renders Run A's data.
  - Clicking Run B → DashboardView renders Run B's data.
  **Do NOT use fake timers.** Mock at module boundary only.
  Confirm tests FAIL before T032 is written.

- [X] **T032** [frontend] [US1/US2] **Implement `RunPollingController` and wire into `App.tsx`** (depends on T003, T011, T031)
  Create `frontend/src/components/RunPollingController.tsx` and mount one instance per running
  run inside `App.tsx`.

  **`RunPollingController.tsx`**:
  - Props: `backtestId`, `onComplete`, `onFail`, `onLogsUpdate`, `onProgressUpdate`.
  - Renders `null` (invisible).
  - **Sole polling owner**: calls `useRunPolling({ backtestId, onComplete, onFail, onLogUpdate:
    onLogsUpdate, onProgressUpdate })`. This is the ONLY place `useRunPolling` is called.
  - No other component in the tree calls `useRunPolling` or `useBacktestPolling`.

  **`App.tsx` wiring**:
  - Render, outside the visible layout, one `<RunPollingController>` per run where
    `run.status === 'running'`, regardless of which run is currently selected or displayed:
    ```tsx
    {runs.filter(r => r.status === 'running').map(r => (
      <RunPollingController
        key={r.backtestId}
        backtestId={r.backtestId}
        onComplete={handleRunComplete}
        onFail={handleRunFail}
        onLogsUpdate={handleLogsUpdate}
        onProgressUpdate={handleProgressUpdate}
      />
    ))}
    ```
  - The controller is unmounted automatically when `run.status` changes away from `'running'`
    because it is filtered out of the render list.

  **Constitution verification steps** (run after implementation):
  - `grep -rn "useRunPolling\|useBacktestPolling" frontend/src/components/LiveTerminalView.tsx`
    → must return no matches.
  - `grep -rn "setTimeout" frontend/src/hooks/useRunPolling.ts`
    → must return no matches.
  Green Light: run `npm test` — T031 tests must pass.

- [X] **T033** [P] [frontend] [US3] **Write integration test for sidebar navigation** (TEST-FIRST)
  Create (or extend) `frontend/src/__tests__/integration/app-state.test.tsx`. Assertions mirror
  US3 acceptance scenarios:
  - Completed run card click → `selectedRunId` updates → `DashboardView` renders with correct data.
  - Clicking `+` from a DashboardView → `ConfigFormView` renders; `runs[]` is unchanged.
  - Expanding a completed card shows expanded stats without changing `selectedRunId`.
  Confirm tests FAIL before T034 is written.

- [X] **T034** [frontend] [US3] **Validate sidebar card expand/select interaction in `LeftSidebar`** (depends on T007, T033)
  Ensure the `expandedRunId` local state in `LeftSidebar` correctly separates two gestures:
  - Clicking the card body → toggles expansion.
  - Clicking "View Full Dashboard" → fires `onViewDashboard(backtestId)` without toggling
    expansion again.
  No new production code needed beyond confirming T007 implementation handles this. If it does
  not, update `LeftSidebar.tsx` accordingly.
  Green Light: run `npm test` — T033 tests must pass.

---

## Phase 10: Error, Edge-Case & Pre-existing Test Suite Validation (All User Stories)

- [X] **T035** [P] [frontend] [US1] **Write test for submission error flow** (TEST-FIRST)
  Extend `frontend/src/__tests__/App.test.tsx` or create
  `frontend/src/__tests__/integration/error-handling.test.tsx`. Verify:
  - When `submitBacktest` rejects, `runs[]` length stays 0.
  - `ConfigFormView` receives a non-null `error` prop containing the rejection message.
  - No new `RunCard` appears in the sidebar.
  Confirm tests FAIL before T036 is written.

- [X] **T036** [frontend] [US1] **Validate error path in `App.tsx` `handleSubmit`** (depends on T003, T035)
  The try/catch in `handleSubmit` already handles this per T003 spec; this task confirms it and
  adds any missing guard for the zero-card invariant. No new production file.
  Green Light: run `npm test` — T035 tests must pass.

- [X] **T037** [P] [frontend] [US1] **Write test for polling failure → failed run card** (TEST-FIRST)
  Create or extend `frontend/src/__tests__/integration/error-handling.test.tsx`. Verify:
  - When `RunPollingController`'s `useRunPolling` fires the `onFail` callback, `App.tsx` receives
    it via `handleRunFail` and updates `run.status` to `'failed'`.
  - `LiveTerminalView` (re-rendered with the updated `run`) displays the failure message.
  - The corresponding `RunCard` in the sidebar renders `'Failed'` text and red indicator.
  - The `RunPollingController` for that run is no longer rendered (filtered out because
    `run.status !== 'running'`).
  Confirm tests FAIL before T038; update T032 if needed.

- [X] **T038** [frontend] [US1] **Validate `handleRunFail` in `App.tsx`** (depends on T003, T037)
  Ensure `handleRunFail(backtestId, errorMsg)` in `App.tsx` correctly sets `status: 'failed'` and
  appends the error to `logs[]`. The run MUST remain in `runs[]` (not removed). No new file.
  Green Light: run `npm test` — T037 tests must pass.

- [X] **T039** [frontend] **Regression: run full pre-existing test suite and validate Green Light**
  Run `npm test --run` inside `frontend/`. All of the following pre-existing test files MUST pass
  without modification:
  - `__tests__/services/backtest-api.test.ts`
  - `__tests__/services/formatters.test.ts`
  - `__tests__/hooks/useBacktestPolling.test.ts`
  - `__tests__/hooks/useFormValidation.test.ts`
  - `__tests__/components/ErrorBoundary.test.tsx`
  If any of the above fail due to new code, fix the regression before proceeding to T040.
  **Green Light Protocol**: this task and every subsequent commit MUST produce a green test suite.

- [X] **T040** [frontend] **Remove deprecated view files** (depends on T039, all prior tasks green)
  Archive (git-delete) the old page/component files that are now replaced:
  - `frontend/src/pages/ConfigurationPage.tsx`
  - `frontend/src/pages/PollingPage.tsx`
  - `frontend/src/pages/ResultsPage.tsx`
  - `frontend/src/components/ResultsDashboard.tsx` (replaced by `DashboardView` + sub-components)
  - `frontend/src/components/PollingIndicator.tsx` (replaced by `LiveTerminalView`)
  Before deleting, verify with `grep -rn "ConfigurationPage\|PollingPage\|ResultsPage\|ResultsDashboard\|PollingIndicator" frontend/src`
  that no remaining file imports these. If any import exists, fix it first.
  Green Light: run `npm test` — all tests must remain green after removal.

---

## Dependency Graph (summary)

```
T001 ──┬──► T003 ──► T032 ──► (App wiring complete)
       │       └──► T036 ──► T038
       ├──► T002 ──► T003
T004 ──► T005 ──► T007
T006 ──► T007
T008 ──► T009
T010 ──► T011 ──► T013
T012 ──► T013
T014 ──► T015 ──► T030
T016 ──► T017 ──► T030
T018 ──► T019 ──► T030
T020 ──► T021 ──► T030
T022 ──────────► T030
T023 ──► T024 ──► T028 ──► T030
T025 ──► T026 ──► T028
T027 ──► T028
T029 ──► T030
T031 ──► T032
T033 ──► T034
T035 ──► T036
T037 ──► T038
T039 ──► T040
```

**Parallel execution opportunities** (same phase, no file overlap): T002 ∥ T004 ∥ T006; T008 ∥ T010 ∥ T012; T014 ∥ T016 ∥ T018 ∥ T020; T023 ∥ T025 ∥ T027; T029 ∥ T033 ∥ T035 ∥ T037.
