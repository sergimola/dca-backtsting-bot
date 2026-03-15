# Implementation Plan: Pro Quant Terminal UI

**Branch**: `009-pro-quant-terminal-ui` | **Date**: 2026-03-15 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/009-pro-quant-terminal-ui/spec.md`

## Summary

Overhaul the existing single-column React step-by-step wizard (`App.tsx` → `ConfigurationPage` →
`PollingPage` → `ResultsPage`) into a professional split-view "Pro Quant Terminal" dashboard.
The new layout provides a persistent left sidebar that lists all backtest runs (past and active),
and a smart right content area that renders one of three views (`ConfigFormView`,
`LiveTerminalView`, `DashboardView`) based on which run is selected and its status.

The key architectural advancement over the existing UI is **concurrent multi-run support**: the
user may submit a second (or third) backtest while the first is still polling the backend, because
each run's polling lifecycle is isolated in its own `<RunPollingController>` React subtree. The
existing `useBacktestPolling` hook and all API functions (`submitBacktest`, `getStatus`,
`getResults`) are unchanged.

Two new npm packages are required: `lucide-react` (icons) and `decimal.js` (explicit dependency
declaration; already used in `ResultsDashboard.tsx` but absent from `package.json`).

## Technical Context

**Language/Version**: TypeScript 5.1 / React 18.2
**Primary Dependencies**: React 18, Vite 5, TailwindCSS 3.3, lucide-react (NEW), decimal.js
  (explicit), axios 1.6, @testing-library/react 14, Jest 29, ts-jest
**Storage**: N/A — session-only React state; no persistence
**Testing**: Jest 29 + @testing-library/react 14 + ts-jest; `npm test` in `frontend/`
**Target Platform**: Modern browser (Chrome 110+, Firefox 115+, Safari 16+); accessed via
  `http://localhost:5173` during development
**Project Type**: Single-page web application (SPA)
**Performance Goals**: 500 trade-group accordions render without visible jank; tooltip hover
  latency < 200ms (pure CSS `group-hover` — zero JS)
**Constraints**: Full-screen layout (h-screen overflow-hidden); no document-level scroll;
  custom scrollbar 6px wide; zero re-computation of PnL/ROI/fees in UI components
**Scale/Scope**: Session-only; up to ~10 concurrent run cards; up to ~500 trades per dashboard

## Constitution Check

*Gates evaluated before Phase 0. Re-evaluated post Phase 1 design — no violations found.*

| Gate | Status | Evidence |
|------|--------|---------|
| **No Live Trading** | ✅ PASS | Pure UI feature; no changes to core-engine or orchestrator API; no execution logic |
| **Green Light Protocol** | ✅ ENFORCED | Every task pair is test-first (FAIL) → implementation (GREEN). T039 requires full pre-existing suite pass before T040. |
| **Fixed-Point Arithmetic** | ✅ PASS | No monetary arithmetic in UI components. `useResultsMetrics` uses `decimal.js` for the 5 derived KPIs and returns `number`. `maxDrawdown`/`totalFees` are pass-throughs. `formatCurrency`/`formatPercentage` in `formatters.ts` use `toFixed` for display only — no re-computation. |
| **No Fake Timers** | ✅ ENFORCED | `useRunPolling` delegates to `useBacktestPolling` with hardcoded `pollInterval: 2000`, `timeoutThreshold: 300_000`. Test tasks T010, T012, T031 explicitly forbid `jest.useFakeTimers()`. T032 includes a `grep` verification step. |
| **Architecture Boundary** | ✅ PASS | All changes are in `frontend/src/`. Zero changes to `core-engine/` or `orchestrator/api/`. |
| **BDD Acceptance Criteria** | ✅ COVERED | 4 user stories with Given/When/Then scenarios in spec.md; integration tests T031 and T033 map 1:1 to US2 and US3 acceptance scenarios. |

## Project Structure

### Documentation (this feature)

```text
specs/009-pro-quant-terminal-ui/
├── plan.md                         # This file
├── research.md                     # Phase 0: 8 resolved unknowns
├── data-model.md                   # Phase 1: Run, RunStatus, TradeGroupMetrics, DashboardMetrics
├── quickstart.md                   # Phase 1: dev setup + smoke test walkthrough
├── contracts/
│   └── component-contracts.md      # Phase 1: all props interfaces & callback signatures
└── tasks.md                        # 40 tasks across 10 phases (test-first throughout)
```

### Source Code Impact (Frontend only)

```text
frontend/src/
├── App.tsx                          ← REWRITE: split-view shell; runs[] state; polling controllers
├── index.css                        ← ADD: .custom-scrollbar + @keyframes shimmer
├── services/
│   └── types.ts                     ← ADD: Run, RunStatus, TradeGroupMetrics, DashboardMetrics
├── hooks/
│   ├── useBacktestPolling.ts        ← UNCHANGED (existing, re-used)
│   ├── useFormValidation.ts         ← UNCHANGED
│   ├── useRunPolling.ts             ← NEW: wraps useBacktestPolling for multi-run App
│   └── useResultsMetrics.ts        ← NEW: decimal.js aggregations → DashboardMetrics
└── components/
    ├── LeftSidebar.tsx              ← NEW
    ├── RunCard.tsx                  ← NEW
    ├── ConfigFormView.tsx           ← NEW (supersedes ConfigurationForm + ConfigurationPage)
    ├── LiveTerminalView.tsx         ← NEW (supersedes PollingPage + PollingIndicator)
    ├── RunPollingController.tsx     ← NEW (invisible; one per running run)
    ├── DashboardView.tsx            ← NEW assembly (supersedes ResultsPage + ResultsDashboard)
    ├── DashboardHeader.tsx          ← NEW
    ├── KpiGrid.tsx                  ← NEW
    ├── SafetyOrderUsagePanel.tsx    ← NEW
    ├── ConfigSummaryPanel.tsx       ← NEW
    ├── TradeAccordion.tsx           ← NEW
    ├── TradeAccordionHeader.tsx     ← NEW
    ├── TradeOrdersTable.tsx         ← NEW
    └── ErrorBoundary.tsx            ← UNCHANGED

# Files scheduled for deletion after Phase 10 (T040):
frontend/src/pages/ConfigurationPage.tsx
frontend/src/pages/PollingPage.tsx
frontend/src/pages/ResultsPage.tsx
frontend/src/components/ResultsDashboard.tsx
frontend/src/components/PollingIndicator.tsx
```

**No changes** to `core-engine/`, `orchestrator/api/`, or `orchestrator/jobs/`.

## Complexity Tracking

No constitution violations. This feature introduces no new architectural boundaries, no new
backend services, and no persistence layer. The only complexity increase is adding two npm
packages (`lucide-react`, explicit `decimal.js`) which are justified by existing usage patterns
in the codebase.

---

## Phase 0: Research Summary

All unknowns resolved. See [research.md](research.md) for full details.

| Unknown | Resolution |
|---------|-----------|
| `lucide-react` availability | NOT in package.json → must `npm install lucide-react` |
| `decimal.js` availability | Used in code but NOT in package.json → must `npm install decimal.js` |
| Tailwind named group modifiers | Available in Tailwind 3.2+ → project uses 3.3, no config change needed |
| Multi-run concurrent polling | Per-run `<RunPollingController key={backtestId}>` isolates each polling loop |
| KPI derivation (5 metrics) | Derivation formulas documented in data-model.md §DashboardMetrics |
| MAE & Max Capital per trade | Derivation from TradeEvent fields documented in data-model.md §TradeGroupMetrics |
| Global CSS strategy | `.custom-scrollbar` + `@keyframes shimmer` → `frontend/src/index.css` |
| BacktestFormState casting | Validation is NaN-parse gate (not type conversion); `submitBacktest` already handles int/float casting |

---

## Phase 1: Design Artifacts

- [data-model.md](data-model.md) — 4 new types: `RunStatus`, `Run`, `TradeGroupMetrics`, `DashboardMetrics`
- [contracts/component-contracts.md](contracts/component-contracts.md) — 14 component prop interfaces + 2 hook signatures
- [quickstart.md](quickstart.md) — dev setup, implementation order, smoke test walkthrough, troubleshooting table

---

## Post-Design Constitution Re-Check

All 6 gates remain GREEN after Phase 1 design:
- No monetary re-computation added to any component JSX.
- `useResultsMetrics` is the single boundary where `decimal.js` arithmetic occurs.
- `useRunPolling` contains zero fake timers — confirmed by contract that `pollInterval` and
  `timeoutThreshold` are hardcoded, not injectable.
- All new components are in `frontend/src/` — no architecture boundary violations.
