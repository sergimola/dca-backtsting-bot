import { renderHook } from '@testing-library/react'
import { useResultsMetrics } from '../../hooks/useResultsMetrics'
import type { BacktestResults, BacktestFormState } from '../../services/types'

const config: BacktestFormState = {
  tradingPair: 'BTC/USDT', startDate: '2024-01-01', endDate: '2024-06-01',
  priceEntry: '50000', priceScale: '1.1', amountScale: '2', numberOfOrders: '5',
  amountPerTrade: '0.1', marginType: 'isolated', multiplier: '1',
  takeProfitDistancePercent: '2.5', accountBalance: '1000', exitOnLastOrder: false,
}

const results: BacktestResults = {
  backtestId: 'test-bt-001',
  pnlSummary: { roi: 5.0, maxDrawdown: -2.5, totalFees: 3.0 },
  safetyOrderUsage: [{ level: '1', count: 2 }, { level: '2', count: 1 }],
  tradeEvents: [
    // Trade 1: ENTRY + EXIT (win)
    {
      timestamp: '2024-01-10T10:00:00', rawTimestamp: '2024-01-10T10:00:00',
      eventType: 'ENTRY', price: 48000, quantity: 0.01, balance: -480, trade_id: 't1', fee: 0.5,
    },
    {
      timestamp: '2024-01-11T10:00:00', rawTimestamp: '2024-01-11T10:00:00',
      eventType: 'EXIT', price: 50000, quantity: 0.01, balance: 25, trade_id: 't1', fee: 0.5,
    },
    // Trade 2: ENTRY + EXIT (loss)
    {
      timestamp: '2024-02-01T10:00:00', rawTimestamp: '2024-02-01T10:00:00',
      eventType: 'ENTRY', price: 52000, quantity: 0.01, balance: -520, trade_id: 't2', fee: 0.5,
    },
    {
      timestamp: '2024-02-02T10:00:00', rawTimestamp: '2024-02-02T10:00:00',
      eventType: 'EXIT', price: 51000, quantity: 0.01, balance: -10, trade_id: 't2', fee: 0.5,
    },
  ],
}

describe('useResultsMetrics', () => {
  it('computes netProfit as sum of EXIT balance values (fees already embedded by engine)', () => {
    const { result } = renderHook(() => useResultsMetrics(results, config))
    // EXIT balances: 25 + (-10) = 15. Engine already deducts all fees from EXIT.balance.
    // Do NOT subtract fees again — that would double-count them.
    expect(result.current.netProfit).toBeCloseTo(15, 1)
  })

  it('computes totalFees as sum of all event fees', () => {
    const { result } = renderHook(() => useResultsMetrics(results, config))
    // 4 events * 0.5 fee = 2
    expect(result.current.totalFees).toBeCloseTo(2, 2)
  })

  it('passes through roi from pnlSummary (engine authoritative value)', () => {
    const { result } = renderHook(() => useResultsMetrics(results, config))
    // roi comes directly from pnlSummary.roi = 5.0 (no local re-derivation)
    expect(result.current.roi).toBe(5.0)
  })

  it('computes winRate as percentage of winning trades', () => {
    const { result } = renderHook(() => useResultsMetrics(results, config))
    // 1 win out of 2 trades = 50%
    expect(result.current.winRate).toBeCloseTo(50, 0)
  })

  it('computes profitFactor as grossWins / grossLosses', () => {
    const { result } = renderHook(() => useResultsMetrics(results, config))
    // grossWins = 25, grossLosses = 10; pf = 2.5
    expect(result.current.profitFactor).toBeCloseTo(2.5, 1)
  })

  it('passes through maxDrawdown from pnlSummary', () => {
    const { result } = renderHook(() => useResultsMetrics(results, config))
    expect(result.current.maxDrawdown).toBe(-2.5)
  })

  it('computes accountEquity as accountBalance + netProfit', () => {
    const { result } = renderHook(() => useResultsMetrics(results, config))
    expect(result.current.accountEquity).toBeCloseTo(1015, 1)
  })

  it('computes per-trade MAE (negative excursion relative to entry price)', () => {
    const { result } = renderHook(() => useResultsMetrics(results, config))
    // t1 entry is already the entry price, MAE = 0
    const t1 = result.current.tradeGroups.find(tg => tg.tradeId === 't1')
    expect(t1?.mae).toBe(0)
  })

  it('computes per-trade maxCapitalDeployed as sum of ENTRY + SAFETY_ORDER balances', () => {
    const { result } = renderHook(() => useResultsMetrics(results, config))
    const t1 = result.current.tradeGroups.find(tg => tg.tradeId === 't1')
    // t1 ENTRY balance = -480, abs = 480
    expect(t1?.maxCapitalDeployed).toBeCloseTo(480, 1)
  })

  it('computes per-trade durationHours as hours between first and last event', () => {
    const { result } = renderHook(() => useResultsMetrics(results, config))
    const t1 = result.current.tradeGroups.find(tg => tg.tradeId === 't1')
    // 2024-01-10T10 to 2024-01-11T10 = 24 hours
    expect(t1?.durationHours).toBeCloseTo(24, 0)
  })

  it('passes safetyOrderUsage through', () => {
    const { result } = renderHook(() => useResultsMetrics(results, config))
    expect(result.current.safetyOrderUsage).toEqual(results.safetyOrderUsage)
  })

  it('passes through annualizedReturn from pnlSummary', () => {
    const resultsWithAR: BacktestResults = {
      ...results,
      pnlSummary: { ...results.pnlSummary, annualizedReturn: 8.5 },
    }
    const { result } = renderHook(() => useResultsMetrics(resultsWithAR, config))
    expect(result.current.annualizedReturn).toBe(8.5)
  })
})
