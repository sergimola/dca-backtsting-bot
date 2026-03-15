# Research: Pro Quant Terminal UI

**Feature**: `009-pro-quant-terminal-ui`
**Phase**: 0 — Unknowns resolved before design begins

---

## 1. Icon library — `lucide-react` availability

**Question**: Is `lucide-react` installed in `frontend/`?

**Finding**: `frontend/package.json` does **NOT** list `lucide-react` in either `dependencies` or
`devDependencies`. The existing components (`ResultsDashboard.tsx`, `PollingIndicator.tsx`, etc.)
do not import from it. The feature description assumes it is available.

**Decision**: Add `lucide-react` as a production dependency before implementing any component that
references it.
- Install command: `npm install lucide-react` inside `frontend/`.
- Version: latest stable (≥ 0.400.0 for `TerminalSquare`, `TrendingDown`, `PieChart`, `Loader2`,
  `AlertCircle`, `Plus`, `Settings2`, `Wallet`, `BarChart2`, `Receipt`, `Target`, `Calendar`,
  `Clock`, `Hash`, `Percent` icons).
- `lucide-react` has zero runtime dependencies and < 4 kB tree-shaken per icon.
- **This is a hard prerequisite for T004 (RunCard), T007 (LeftSidebar), T009 (ConfigFormView),
  T013 (LiveTerminalView), T019 (KpiGrid), T024 (TradeAccordionHeader).**

**Alternatives considered**: `react-icons` (heavier bundle, harder to tree-shake), `heroicons`
(different aesthetic). `lucide-react` matches the spec exactly and is the de-facto standard for
modern dark-mode dashboards.

---

## 2. Fixed-point library — `decimal.js` availability

**Question**: Is `decimal.js` installed? `ResultsDashboard.tsx` imports from it but it is not
in `package.json`.

**Finding**: `decimal.js` is imported in `frontend/src/components/ResultsDashboard.tsx` line 2
(`import Decimal from 'decimal.js'`) but is absent from `package.json`. It is therefore either a
transitive dependency of `recharts` (unlikely) or was installed manually and the lock-file was not
committed with an updated `package.json`. Running `npm ls decimal.js` would confirm.

**Decision**: Add `decimal.js` explicitly to `dependencies` to make the dependency visible and
auditable: `npm install decimal.js`.
- This matches the constitution's fixed-point arithmetic gate; `decimal.js` uses arbitrary
  precision base-10 arithmetic equivalent to Python's `Decimal(ROUND_HALF_UP)`.
- The `useResultsMetrics` hook (T015) MUST use `decimal.js` for all intermediate summations
  before returning `number` via `.toNumber()`. This is the only arithmetic in the new UI.

**Alternatives considered**: `big.js` (smaller but fewer rounding modes), `bignumber.js` (heavier).
`decimal.js` is already used in the codebase — consistency is the deciding factor.

---

## 3. Tailwind CSS — `group-hover` arbitrary modifier support

**Question**: Does the current Tailwind 3.3 installation support named group modifiers
(`group/mae`, `group-hover/mae:block`) needed for scoped per-icon tooltips?

**Finding**: Named group modifiers (`group/{name}` and `group-hover/{name}`) were introduced in
**Tailwind CSS v3.2.0**. The project uses `tailwindcss: ^3.3.0`, which satisfies this requirement.

**Decision**: Use `group/mae` and `group/capital` named modifiers on the wrapper `<div>` of each
tooltip icon in `TradeAccordionHeader`. The tooltip `<div>` uses `hidden group-hover/mae:block`
(or `hidden group-hover/capital:block`). No configuration changes to `tailwind.config.js` needed.

**Alternatives considered**: Plain `group` on the row header (causes both tooltips to appear
simultaneously when any child is hovered — rejected). JavaScript `onMouseEnter`/`onMouseLeave`
state (works but adds JS overhead and is harder to test via className assertions — rejected).

---

## 4. Multi-run concurrent polling architecture

**Question**: How do multiple simultaneous polling loops coexist without React state conflicts?
The existing `useBacktestPolling` hook is designed for a single-run lifecycle.

**Finding**: The existing `useBacktestPolling` hook creates an `setInterval` in a `useEffect`
tied to a single `backtestId`. It is stateless beyond its own `useState` return. Multiple
instances of this hook in different React component subtrees are fully independent — React isolates
their `useRef` and `useState` values per component instance.

**Decision**: Introduce a `<RunPollingController backtestId={run.backtestId} />` invisible
component rendered in `App.tsx` for each run with `status === 'running'`. Because it is keyed
by `backtestId`, each controller lives in its own isolated React subtree. When the run completes
or fails, the controller unmounts automatically (status changes → no longer rendered).
- This guarantees zero cross-contamination between polling loops.
- Avoids any global polling registry, singleton, or pub/sub overhead.
- The `useRunPolling` hook inside the controller delegates to one `useBacktestPolling` instance.

**Alternatives considered**: A single top-level polling manager with a `Map<backtestId, timer>`
(complex, hard to test cleanly, violates single-responsibility). Context + reducer (over-engineered
for session-only state with no persistence requirement).

---

## 5. KPI metrics derivation (Profit Factor, Win Rate, Account Equity, Capital Utilized)

**Question**: Which KPIs from the spec are NOT directly available in `BacktestResults` and must
be derived from `tradeEvents`?

**Finding** (from `frontend/src/services/types.ts`):
```ts
interface PnlSummary {
  roi: number           // ✅ direct
  maxDrawdown: number   // ✅ direct
  totalFees: number     // ✅ direct
}
interface BacktestResults {
  backtestId: string
  pnlSummary: PnlSummary
  safetyOrderUsage: SafetyOrderUsage[]
  tradeEvents: TradeEvent[]
}
```

The following 5 KPIs must be computed from `tradeEvents`:

| KPI | Derivation |
|-----|-----------|
| **Net Profit** | Sum of `balance` for all EXIT-type events |
| **Win Rate** | `(trades where EXIT.balance > 0) / total_closed_trades × 100` |
| **Profit Factor** | `sum(EXIT.balance where balance > 0) / abs(sum(EXIT.balance where balance < 0))` |
| **Account Equity** | `parseFloat(config.accountBalance) + netProfit` |
| **Capital Utilized** | `sum(ENTRY + SAFETY_ORDER balance) / parseFloat(config.accountBalance) × 100` |

**Decision**: All five derived KPIs are computed once in the `useResultsMetrics` hook (T015) using
`decimal.js`. Results are returned as plain `number` values in the `DashboardMetrics` return type.
No inline computation in JSX templates.

---

## 6. Per-trade MAE and Max Capital Deployed derivation

**Question**: How are Max Adverse Excursion (MAE) and Max Capital Deployed derived per trade
group from `TradeEvent[]`?

**Finding**: From `frontend/src/services/backtest-api.ts`:
- `PositionOpened` event → `eventType: 'ENTRY'`, `price` = entry price, `balance` = notional
  cost of entry.
- `BuyOrderExecuted` event → `eventType: 'SAFETY_ORDER'`, `price` = fill price, `balance` =
  notional cost of that safety order fill.
- `PositionClosed` event → `eventType: 'EXIT'`, `balance` = net PnL.

**Derivations**:
- **MAE** = `min((fill.price - entryPrice) / entryPrice)` across all ENTRY + SAFETY_ORDER fills
  in the group. This is negative (a loss percent) when safety orders trigger. If only the entry
  fills (no safety orders hit), MAE = 0.
- **Max Capital Deployed** = sum of all `balance` values where `eventType === 'ENTRY'` or
  `eventType === 'SAFETY_ORDER'`. This is the total notional USDT committed at peak.

**Decision**: Compute both in `useResultsMetrics` during trade group construction. Values are
passed as `mae: number` and `maxCapitalDeployed: number` on the `TradeGroupMetrics` type.

---

## 7. Custom scrollbar & shimmer animation — global CSS injection strategy

**Question**: Where should the `.custom-scrollbar` and shimmer keyframe CSS live to avoid
duplication?

**Finding**: Vite's `App.tsx` can inject a `<style>` tag in the JSX return, but this is
non-idiomatic. The project already has `frontend/src/index.css` (imported in `main.tsx`) which is
the correct global CSS entry point.

**Decision**: Add the `.custom-scrollbar` ruleset and `@keyframes shimmer` to
`frontend/src/index.css`, not to `App.tsx`. Using `index.css` is the single source of truth for
global styles. The `<style>` block in `App.tsx` mentioned in the original feature description is
replaced by this cleaner approach with no functional difference.

```css
/* Custom scrollbar */
.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }

/* Shimmer animation for LiveTerminalView progress bar */
@keyframes shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}
```

**Alternatives considered**: CSS Modules (overkill for two global rules). Tailwind `@layer`
utilities (valid but harder to reference WebKit pseudo-elements). Inline `<style>` in `App.tsx`
(functional but non-standard for keyframes).

---

## 8. `BacktestFormState` field types — string vs number

**Question**: The spec's "Type-Casting Guardrail" implies numeric fields need to be cast. But
`BacktestFormState` already defines all numeric fields as `string`. What exactly is the guardrail?

**Finding** (confirmed from `types.ts` and `backtest-api.ts`):
- `BacktestFormState` intentionally uses `string` for all numeric fields to avoid JS float
  coercion at the form state level.
- `submitBacktest()` in `backtest-api.ts` performs the actual `parseFloat`/`parseInt` internally
  when building the API payload.
- The **guardrail** is therefore: ConfigFormView's submit handler MUST NOT pass a field if it is
  an empty string or if `parseFloat(field)` returns `NaN`. This is a **pre-submission validation
  gate**, not a type conversion.

**Decision**: `ConfigFormView` validates all required numeric fields with `!isNaN(parseFloat(v))`
before enabling submit. The `onSubmit` prop receives a valid `BacktestFormState` (all strings, as
typed). `submitBacktest` handles the final number conversion unchanged.
