# Quickstart: Pro Quant Terminal UI

**Feature**: `009-pro-quant-terminal-ui`
**Branch**: `009-pro-quant-terminal-ui`

---

## Prerequisites

- Node.js 18+ installed
- Docker running (for the backend — ClickHouse + orchestrator API)
- Backend stack running: `docker-compose up -d` in repository root
- Active branch: `git checkout 009-pro-quant-terminal-ui`

---

## 1. Install new dependencies

```bash
cd frontend
npm install lucide-react decimal.js
```

Verify both are now in `package.json` dependencies:
- `lucide-react` — icon library (~4 kB/icon tree-shaken)
- `decimal.js` — fixed-point arithmetic for `useResultsMetrics`

---

## 2. Run the test suite (Green Light baseline)

Before writing any code, confirm the existing test suite is fully green:

```bash
cd frontend
npm test -- --watchAll=false
```

All pre-existing tests must pass. If any fail, stop and fix them before proceeding.

---

## 3. Implementation order

Follow the phases in `tasks.md` strictly. Each phase gate is `npm test` passing before the next
phase begins.

```
Phase 0  →  T001 (types) + T002 (App tests, FAIL expected) → T003 (App shell, tests GREEN)
Phase 1  →  T004 (RunCard tests, FAIL) → T005 (RunCard) → T006 (Sidebar tests, FAIL) → T007
Phase 2  →  T008 (ConfigFormView tests, FAIL) → T009 (ConfigFormView)
Phase 3  →  T010 (useRunPolling tests, FAIL) → T011 → T012 (LiveTerminalView tests, FAIL) → T013
Phase 4  →  T014 (useResultsMetrics tests, FAIL) → T015
Phase 5  →  T016-T019 (DashboardHeader, KpiGrid) [can run in parallel]
Phase 6  →  T020-T022 (Panels) [can run in parallel]
Phase 7  →  T023-T028 (Trade Accordions — strictly sequential)
Phase 8  →  T029 (DashboardView tests, FAIL) → T030
Phase 9  →  T031 (concurrent-run integration test, FAIL) → T032 → T033 → T034
Phase 10 →  T035-T040 (error paths + regression + cleanup)
```

---

## 4. Start the dev server

```bash
cd frontend
npm run dev
```

App runs at `http://localhost:5173`. The backend API is expected at `http://localhost:4000`.

---

## 5. Smoke-test the new UI manually

After Phase 0–3 (App shell + sidebar + form + live terminal) are complete:

1. Open `http://localhost:5173`.
2. You should see the split-view layout: dark left sidebar (w-80) + main content area.
3. Click `+` → `ConfigFormView` appears in the main pane.
4. Fill all 13 fields. Pay attention to:
   - `startDate` / `endDate` using the `datetime-local` picker
   - `exitOnLastOrder` toggle switch animates on/off
   - `marginType` dropdown shows "isolated" / "cross"
5. Click **Run Simulation** → sidebar updates with a new run card (spinner + "Processing…").
6. Main area shows `LiveTerminalView` with progress bar shimmer animation and live log scroll.
7. After backend responds (~5–30 seconds): sidebar card switches to "completed" with ROI/PnL.
   Main area automatically shows `DashboardView`.
8. Click `+` again while a run is processing → `ConfigFormView` shows; first run continues in
   sidebar as "Processing…".

---

## 6. Key file locations after implementation

```
frontend/src/
├── App.tsx                                  ← rewritten split-view shell
├── index.css                                ← .custom-scrollbar + @keyframes shimmer added
├── services/
│   └── types.ts                             ← Run, RunStatus, TradeGroupMetrics, DashboardMetrics added
├── hooks/
│   ├── useBacktestPolling.ts                ← UNCHANGED
│   ├── useFormValidation.ts                 ← UNCHANGED
│   ├── useRunPolling.ts                     ← NEW
│   └── useResultsMetrics.ts                 ← NEW
└── components/
    ├── LeftSidebar.tsx                      ← NEW
    ├── RunCard.tsx                          ← NEW
    ├── ConfigFormView.tsx                   ← NEW (replaces ConfigurationForm.tsx + ConfigurationPage.tsx)
    ├── LiveTerminalView.tsx                 ← NEW (replaces PollingPage.tsx + PollingIndicator.tsx)
    ├── RunPollingController.tsx             ← NEW (invisible; one per running run)
    ├── DashboardView.tsx                    ← NEW (assembly; replaces ResultsPage.tsx)
    ├── DashboardHeader.tsx                  ← NEW
    ├── KpiGrid.tsx                          ← NEW
    ├── SafetyOrderUsagePanel.tsx            ← NEW (replaces SafetyOrderChart.tsx for this view)
    ├── ConfigSummaryPanel.tsx               ← NEW
    ├── TradeAccordion.tsx                   ← NEW
    ├── TradeAccordionHeader.tsx             ← NEW
    ├── TradeOrdersTable.tsx                 ← NEW (replaces inline table in ResultsDashboard.tsx)
    └── ErrorBoundary.tsx                    ← UNCHANGED
```

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `Cannot find module 'lucide-react'` | `npm install` not run | `cd frontend && npm install lucide-react` |
| `Cannot find module 'decimal.js'` | Not in package.json | `cd frontend && npm install decimal.js` |
| Progress bar does not shimmer | `@keyframes shimmer` missing from `index.css` | Add shimmer keyframe per research.md §7 |
| Both tooltips appear at once | Not using named group modifiers | Use `group/mae` and `group/capital` per contracts.md |
| Polling stops when user clicks `+` | `RunPollingController` not rendered for all running runs | Check T032 — controller must render for ALL `status === 'running'` runs, not just selected |
| Test: `TypeError: lucide-react is not a module` | lucide-react not installed in test env | Run `npm install`; ensure jest `moduleNameMapper` doesn't block it |
