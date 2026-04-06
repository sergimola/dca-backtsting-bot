/**
 * IrrCalculator — Internal Rate of Return solver
 * Feature: 020-annualized-return
 *
 * Computes annualizedReturn (IRR as % per year) from a completed backtest's
 * tradeEvents array.  All intermediate arithmetic uses Decimal.js (precision=20)
 * to satisfy the constitution's Fixed-Point Arithmetic MUST gate.
 *
 * Cash-flow construction (per spec FR-002, FR-003, FR-004):
 *   - Initial outflow: accountBalance at t=0 (backtest start_date)
 *   - DEPOSIT events:  event.balance = injection amount → outflow at rawTimestamp
 *   - Terminal inflow: last event's balance → inflow at last event's rawTimestamp
 *
 * Returns:
 *   - number  — IRR * 100, rounded to 4dp via Decimal chain
 *   - -100    — when terminal balance is zero (full liquidation, per FR-005)
 *   - null    — when no capital deployed, all flows non-negative, or solver fails
 */

import Decimal from 'decimal.js';
import type { StoredTradeEvent } from '../types/index.js';

// Set global Decimal precision once at module load.
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

interface CashFlow {
  t: Decimal;       // fractional years from backtest start
  amount: Decimal;  // negative = outflow, positive = inflow
}

const MS_PER_YEAR = new Decimal(365.25 * 24 * 60 * 60 * 1000);
const ZERO = new Decimal(0);
const ONE = new Decimal(1);
const HUNDRED = new Decimal(100);

/**
 * Compute the Net Present Value of cash flows at rate r.
 * NPV(r) = Σ [ CF_i / (1+r)^t_i ]
 */
function npv(cashFlows: CashFlow[], r: Decimal): Decimal {
  let total = ZERO;
  const onePlusR = ONE.plus(r);
  for (const cf of cashFlows) {
    // (1+r)^t — Decimal.pow handles fractional exponents via ln/exp
    const discount = onePlusR.pow(cf.t);
    total = total.plus(cf.amount.div(discount));
  }
  return total;
}

/**
 * Compute dNPV/dr = Σ [ -t_i * CF_i / (1+r)^(t_i+1) ]
 */
function npvDerivative(cashFlows: CashFlow[], r: Decimal): Decimal {
  let total = ZERO;
  const onePlusR = ONE.plus(r);
  for (const cf of cashFlows) {
    const exp = cf.t.plus(ONE);
    const discount = onePlusR.pow(exp);
    total = total.plus(cf.t.neg().times(cf.amount).div(discount));
  }
  return total;
}

/**
 * Newton-Raphson solver.
 * Returns the rate r (not percentage) or null if diverged.
 */
function newtonRaphson(cashFlows: CashFlow[]): Decimal | null {
  let r = new Decimal(0.1);
  const tolerance = new Decimal('1e-10');
  const deltaTolerance = new Decimal('1e-12');

  for (let i = 0; i < 100; i++) {
    // Divergence: (1+r) ≤ 0 means we've left the valid domain
    if (ONE.plus(r).lte(ZERO)) return null;

    const f = npv(cashFlows, r);
    if (f.abs().lte(tolerance)) return r;

    const df = npvDerivative(cashFlows, r);
    if (df.abs().lte(new Decimal('1e-14'))) return null; // derivative too small

    const delta = f.div(df);
    r = r.minus(delta);

    if (delta.abs().lte(deltaTolerance)) return r;
  }
  return null; // did not converge
}

/**
 * Bisection fallback solver.
 * Bracket [-0.9999, 100.0]. Returns rate r or null if sign not consistent.
 */
function bisection(cashFlows: CashFlow[]): Decimal | null {
  let lo = new Decimal('-0.9999');
  let hi = new Decimal('100.0');
  const convergence = new Decimal('1e-12');

  const fLo = npv(cashFlows, lo);
  const fHi = npv(cashFlows, hi);

  // Must have opposite signs to bracket the root
  if (fLo.times(fHi).gte(ZERO)) return null;

  for (let i = 0; i < 100; i++) {
    const mid = lo.plus(hi).div(2);
    const fMid = npv(cashFlows, mid);

    if (fMid.abs().lte(new Decimal('1e-10'))) return mid;
    if (hi.minus(lo).lte(convergence)) return mid;

    if (fMid.times(fLo).lt(ZERO)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return lo.plus(hi).div(2);
}

/**
 * Compute the annualized return (IRR × 100) for a completed backtest.
 *
 * @param tradeEvents   Events from Go engine result (DEPOSIT events + all others)
 * @param startDate     ISO 8601 UTC — backtest config start_date — anchors t=0
 * @param accountBalance Initial account balance as decimal string (first outflow)
 * @param finalBalance  Optional: final account equity as decimal string.
 *                      When provided, used as the terminal inflow (more accurate).
 *                      When omitted, falls back to lastEvent.balance (legacy / test mode).
 * @returns IRR as % per year (number), -100 for full loss, or null
 */
export function computeAnnualizedReturn(
  tradeEvents: StoredTradeEvent[],
  startDate: string,
  accountBalance: string,
  finalBalance?: string | number | null,
): number | null {
  const startMs = Date.parse(startDate);
  const initialBalance = new Decimal(accountBalance || '0');

  // Guard: no capital deployed
  const hasDeposits = tradeEvents.some(e => e.eventType === 'DEPOSIT');
  if (initialBalance.lte(ZERO) && !hasDeposits) return null;

  if (tradeEvents.length === 0) return null;

  // Terminal inflow: use provided finalBalance if available, else last event's balance
  const lastEvent = tradeEvents[tradeEvents.length - 1];
  const terminalBalance = finalBalance != null
    ? new Decimal(finalBalance)
    : new Decimal(lastEvent.balance);

  // Guard: full loss (FR-005)
  if (terminalBalance.lte(ZERO)) return -100;

  // Build cash flows
  const cashFlows: CashFlow[] = [];

  // Initial outflow at t=0
  if (initialBalance.gt(ZERO)) {
    cashFlows.push({ t: ZERO, amount: initialBalance.neg() });
  }

  // DEPOSIT events as outflows; other events ignored (they update running equity)
  for (const ev of tradeEvents) {
    if (ev.eventType === 'DEPOSIT') {
      const depositAmount = new Decimal(ev.balance);
      if (depositAmount.lte(ZERO)) continue;
      const evMs = Date.parse(ev.rawTimestamp);
      const t = new Decimal(evMs - startMs).div(MS_PER_YEAR);
      // Only add as separate outflow if t > 0 to avoid duplicate t=0 with initial
      if (t.gt(ZERO)) {
        cashFlows.push({ t, amount: depositAmount.neg() });
      }
    }
  }

  // Terminal inflow at last event's timestamp
  const terminalMs = Date.parse(lastEvent.rawTimestamp);
  const terminalT = new Decimal(terminalMs - startMs).div(MS_PER_YEAR);
  cashFlows.push({ t: terminalT.lte(ZERO) ? new Decimal('1e-6') : terminalT, amount: terminalBalance });

  // Guard: all flows non-negative (no outflows at all)
  const hasOutflow = cashFlows.some(cf => cf.amount.lt(ZERO));
  if (!hasOutflow) return null;

  // Solve with Newton-Raphson, fall back to bisection
  let rate = newtonRaphson(cashFlows);
  if (rate === null) {
    rate = bisection(cashFlows);
  }
  if (rate === null) return null;

  // Return annualizedReturn = r * 100, rounded to 4dp via pure Decimal chain
  return rate.times(HUNDRED).toDecimalPlaces(4).toNumber();
}
