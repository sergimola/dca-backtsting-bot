import Decimal from 'decimal.js'

/**
 * Calculates ROI using fixed-point arithmetic to avoid floating-point
 * precision errors on the denominator.
 *
 * Formula: netProfit / (initialBalance + totalAdditions) × 100
 *
 * @returns ROI as a plain number (e.g. 5.0 means 5%). Returns 0 when the
 * denominator is ≤ 0 (zero-guard).
 */
export function calculateRoi(
  netProfit: number,
  initialBalance: number,
  totalAdditions: number
): number {
  const denominator = new Decimal(initialBalance).plus(totalAdditions)
  if (denominator.lte(0)) return 0
  return new Decimal(netProfit).div(denominator).times(100).toNumber()
}
