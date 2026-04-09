import Decimal from 'decimal.js'
import type { BacktestResults, BacktestFormState } from './types'

export interface NetMetrics {
  netProfit: number
  closedTradesCount: number
}

export function calculateNetMetrics(results: BacktestResults, _config: BacktestFormState): NetMetrics {
  const { tradeEvents } = results

  // Group events by trade_id
  const groupMap = new Map<string, typeof tradeEvents>()
  for (const evt of tradeEvents) {
    const arr = groupMap.get(evt.trade_id) ?? []
    arr.push(evt)
    groupMap.set(evt.trade_id, arr)
  }

  // Calculate net profit by summing only closed trades (matching useResultsMetrics)
  let netProfitD = new Decimal(0)
  let closedTradesCount = 0

  for (const [, events] of groupMap.entries()) {
    const exitEvents = events.filter(e => e.eventType === 'EXIT')
    
    // Gross profit: sum of EXIT balances
    const grossProfit = exitEvents.reduce((s, e) => s.plus(e.balance), new Decimal(0))
    // Total fees: sum of all fees in this trade
    const fees = events.reduce((s, e) => s.plus(e.fee ?? 0), new Decimal(0))
    // EXIT balance already reflects net profit after all fees (engine deducts
    // entry+SO+exit fees via FeesAccumulated before CalculateProfit). Do NOT
    // subtract fees again — that would double-count them.
    const netProfit = grossProfit
    
    // Only include closed trades in net profit calculation
    if (exitEvents.length > 0) {
      netProfitD = netProfitD.plus(netProfit)
      closedTradesCount++
    }
  }

  const netProfit = netProfitD.toNumber()

  return { netProfit, closedTradesCount }
}
