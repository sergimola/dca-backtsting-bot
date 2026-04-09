import { calculateRoi } from '../../services/roiCalculator'

describe('calculateRoi', () => {
  it('no-additions baseline: 50 / 1000 = 5.0%', () => {
    expect(calculateRoi(50, 1000, 0)).toBeCloseTo(5.0, 4)
  })

  it('with additions: 50 / (1000 + 200) = 4.1667%', () => {
    expect(calculateRoi(50, 1000, 200)).toBeCloseTo(4.1667, 4)
  })

  it('12-month additions: 200 / (1000 + 1200) = 9.0909%', () => {
    // spec table note: "12 months × $100/month = $1,200 additions"; formula = netProfit / (B + D) × 100
    expect(calculateRoi(200, 1000, 1200)).toBeCloseTo(9.0909, 4)
  })

  it('zero-denominator guard: (0, 0, 0) → 0', () => {
    expect(calculateRoi(0, 0, 0)).toBe(0)
  })

  it('additions-only denominator: 25 / (0 + 500) = 5.0%', () => {
    expect(calculateRoi(25, 0, 500)).toBeCloseTo(5.0, 4)
  })
})
