# Data Model: Pro Quant Terminal UI

**Feature**: `009-pro-quant-terminal-ui`
**Layer**: `frontend/src/` only — display-layer types, no persistence, no API mutations

---

## Overview

This feature introduces two new TypeScript types alongside the existing `BacktestFormState`,
`BacktestResults`, `TradeEvent`, `SafetyOrderUsage`, and `PnlSummary` types in
`frontend/src/services/types.ts`. All new types are **display-side only**: they are derived from
backend response data and never sent to the API.

---

## Entity: `RunStatus`

**Purpose**: Discriminated union representing the lifecycle state of a single backtest run.

```ts
export type RunStatus = 'running' | 'completed' | 'failed'
```

| Value | Meaning |
|-------|---------|
| `running` | `submitBacktest` has returned a `backtestId`; polling is active |
| `completed` | `getResults` has resolved; `results` is populated |
| `failed` | Polling returned `failed`/`timeout`; or `getResults` threw |

**State transitions** (one-way, no rollback):
```
[submit resolves] → running
running → completed  (when getStatus returns 'completed' AND getResults resolves)
running → failed     (when getStatus returns 'failed', timeout, or getResults throws)
```

---

## Entity: `Run`

**Purpose**: The central session-state entity. Holds everything the UI needs to render a sidebar
card, a LiveTerminalView, or a DashboardView for a single backtest execution.

```ts
export interface Run {
  backtestId: string           // Backend-assigned UUID; stable React key
  shortId: string              // First 8 chars of backtestId; used in UI labels
  status: RunStatus
  config: BacktestFormState    // Original 13-field parameter set; never mutated after creation
  results?: BacktestResults    // Populated when status transitions to 'completed'
  logs: string[]               // Status messages accumulated during polling; append-only
  progress: number             // 0–100; updated by RunPollingController via handleProgressUpdate
  createdAt: string            // ISO 8601 timestamp; set once at run creation
}
```

**Validation rules**:
- `results` MUST be `undefined` when `status` is `'running'` or `'failed'`
- `results` MUST be defined when `status` is `'completed'`
- `logs` is append-only; items are never removed or reordered
- `progress` defaults to `0` at run creation; set to `100` when `status` transitions to `'completed'`;
  set to `0` (or left as-is) when `status` transitions to `'failed'`. Progress is owned by
  `App.tsx` global state so it survives any `LiveTerminalView` unmount/remount
- `createdAt` is set once when the run is created and never updated
- `backtestId` is set once and never changed

**Lifecycle (in `App.tsx` state)**:
```
runs: Run[]    ← append-only; runs are never removed during the browser session
```

---

## Entity: `TradeGroupMetrics`

**Purpose**: A derived, display-only aggregation of all `TradeEvent` records that share the same
`trade_id`. Computed once by `useResultsMetrics`; passed down to `TradeAccordion` as props.
Never sent to the API.

```ts
export interface TradeGroupMetrics {
  tradeId: string              // Sequential display ID ("1", "2", …); from TradeEvent.trade_id
  events: TradeEvent[]         // All events for this trade, in chronological order
  status: 'CLOSED' | 'OPEN'   // CLOSED if an EXIT event exists; OPEN otherwise
  grossProfit: number          // netProfit + totalFees  (Decimal computation, returned as number)
  totalFees: number            // Sum of all TradeEvent.fee values in the group
  netProfit: number            // TradeEvent.balance of the EXIT event; 0 if OPEN
  durationHours: number        // (last event timestamp - first event timestamp) / 3_600_000
  mae: number                  // Max Adverse Excursion: min((fill.price - entryPrice)/entryPrice)
                               // across all ENTRY + SAFETY_ORDER fills; negative means loss
  maxCapitalDeployed: number   // Sum of all ENTRY + SAFETY_ORDER balance values in the group
}
```

**Derivation rules** (implemented in `useResultsMetrics`, T015):
- `grossProfit = new Decimal(netProfit).plus(totalFees).toNumber()`
- `totalFees = events.reduce((acc, e) => acc.plus(e.fee ?? 0), new Decimal(0)).toNumber()`
- `netProfit`: EXIT event's `balance` field; `0` if no EXIT event found
- `durationHours`: `(new Date(last.rawTimestamp).getTime() - new Date(first.rawTimestamp).getTime()) / 3_600_000`
- `mae`: requires `entryPrice` from the ENTRY event's `price` field; computes
  `Math.min(...buys.map(e => (e.price - entryPrice) / entryPrice))` — or `0` if only one fill
- `maxCapitalDeployed`: `events.filter(e => e.eventType !== 'EXIT').reduce((s, e) => s + e.balance, 0)`

---

## Entity: `DashboardMetrics`

**Purpose**: The complete set of pre-computed metrics for a single `BacktestResults`. This is the
output of `useResultsMetrics` and the single props interface for all `DashboardView` child
components. No component below `DashboardView` should access `BacktestResults` directly.

```ts
export interface DashboardMetrics {
  // --- 8 KPI cards ---
  accountEquity: number         // parseFloat(config.accountBalance) + netProfit
  netProfit: number             // Sum of EXIT event balance values across all trades
  roi: number                   // (netProfit / parseFloat(config.accountBalance)) * 100
  profitFactor: number          // grossWins / abs(grossLosses); Infinity if no losses
  totalFees: number             // pnlSummary.totalFees (direct pass-through)
  capitalUtilized: number       // (totalCapitalDeployed / accountBalance) * 100
  maxDrawdown: number           // pnlSummary.maxDrawdown (direct pass-through)
  winRate: number               // (winCount / totalClosedTrades) * 100

  // --- Trade history ---
  tradeGroups: TradeGroupMetrics[]

  // --- Right column ---
  safetyOrderUsage: SafetyOrderUsage[]   // pass-through from results.safetyOrderUsage
  totalTrades: number                    // tradeGroups.length
}
```

**Arithmetic rules** (all use `decimal.js` intermediate):
```
netProfit          = Σ exitBalance for all CLOSED trades
totalFees          = results.pnlSummary.totalFees  (no re-computation)
roi                = (netProfit / accountBalance) × 100
profitFactor       = Σ positive exitBalances / |Σ negative exitBalances|
accountEquity      = accountBalance + netProfit
capitalUtilized    = (Σ ENTRY+SO balances across ALL trades / accountBalance) × 100
winRate            = (count EXIT.balance > 0) / totalClosedTrades × 100
maxDrawdown        = results.pnlSummary.maxDrawdown  (no re-computation)
```

---

## Existing Types (unchanged — for reference)

These types are defined in `frontend/src/services/types.ts` and are not modified by this feature:

```
BacktestFormState   — 13 input fields (all numeric values stored as strings)
BacktestResults     — { backtestId, pnlSummary, safetyOrderUsage, tradeEvents }
PnlSummary          — { roi, maxDrawdown, totalFees }
SafetyOrderUsage    — { level: string, count: number }
TradeEvent          — { timestamp, rawTimestamp, eventType, price, quantity, balance, trade_id, fee }
```

---

## File Placement

All new types are added to `frontend/src/services/types.ts` alongside existing types.
No new type files are created.

```
frontend/src/services/types.ts   ← add RunStatus, Run, TradeGroupMetrics, DashboardMetrics
```
