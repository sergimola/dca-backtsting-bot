import { useMemo } from 'react'
import Decimal from 'decimal.js'
import type { BacktestResults, BacktestFormState, DashboardMetrics, TradeGroupMetrics, TradeEvent } from '../services/types'

export function useResultsMetrics(
  results: BacktestResults,
  config: BacktestFormState
): DashboardMetrics {
  return useMemo(() => {
    const { tradeEvents, pnlSummary, safetyOrderUsage } = results
    const accountBalance = parseFloat(config.accountBalance) || 0

    // Group events by trade_id
    const groupMap = new Map<string, TradeEvent[]>()
    for (const evt of tradeEvents) {
      const arr = groupMap.get(evt.trade_id) ?? []
      arr.push(evt)
      groupMap.set(evt.trade_id, arr)
    }

    // Build TradeGroupMetrics per group
    const tradeGroups: TradeGroupMetrics[] = []
    let grossWins = new Decimal(0)
    let grossLosses = new Decimal(0)
    let totalFeesD = new Decimal(0)
    let netProfitD = new Decimal(0)
    let totalCapitalD = new Decimal(0)

    for (const [tradeId, events] of groupMap.entries()) {
      const exitEvents = events.filter(e => e.eventType === 'EXIT')
      const entryEvents = events.filter(
        e => e.eventType === 'ENTRY' || e.eventType === 'SAFETY_ORDER'
      )

      const grossProfit = exitEvents.reduce((s, e) => s.plus(e.balance), new Decimal(0))
      const fees = events.reduce((s, e) => s.plus(e.fee ?? 0), new Decimal(0))
      const netProfit = grossProfit.minus(fees)

      // Capital deployed: sum of buy-side balances
      const capital = entryEvents.reduce((s, e) => s.plus(Math.abs(e.balance)), new Decimal(0))

      // Only include closed trades in PnL calculations
      if (exitEvents.length > 0) {
        if (grossProfit.gt(0)) {
          grossWins = grossWins.plus(grossProfit)
        } else {
          grossLosses = grossLosses.plus(grossProfit.abs())
        }
        totalFeesD = totalFeesD.plus(fees)
        netProfitD = netProfitD.plus(netProfit)
        totalCapitalD = totalCapitalD.plus(capital)
      }

      // MAE: worst (lowest) price relative to entry price among buy fills
      const entryPrice = entryEvents[0]?.price ?? 0
      let mae = 0
      if (entryPrice > 0) {
        for (const e of entryEvents) {
          const excursion = (e.price - entryPrice) / entryPrice
          if (excursion < mae) mae = excursion
        }
      }

      // Duration: first to last event timestamp
      const timestamps = events
        .map(e => new Date(e.rawTimestamp || e.timestamp).getTime())
        .filter(t => !isNaN(t))
      const durationMs = timestamps.length >= 2
        ? Math.max(...timestamps) - Math.min(...timestamps)
        : 0
      const durationHours = durationMs / (1000 * 60 * 60)

      const hasOpen = exitEvents.length === 0

      tradeGroups.push({
        tradeId,
        events,
        status: hasOpen ? 'OPEN' : 'CLOSED',
        grossProfit: grossProfit.toNumber(),
        totalFees: fees.toNumber(),
        netProfit: netProfit.toNumber(),
        durationHours,
        mae,
        maxCapitalDeployed: capital.toNumber(),
      })
    }

    const netProfit = netProfitD.toNumber()
    const totalFees = totalFeesD.toNumber()
    const roi = accountBalance > 0 ? (netProfit / accountBalance) * 100 : 0
    const profitFactor = grossLosses.gt(0) ? grossWins.div(grossLosses).toNumber() : Infinity
    const capitalUtilized = accountBalance > 0
      ? totalCapitalD.div(accountBalance).times(100).toNumber()
      : 0

    const winCount = tradeGroups.filter(tg => tg.grossProfit > 0).length
    const closedTradesCount = tradeGroups.filter(t => t.status === 'CLOSED').length;
    const winRate = closedTradesCount > 0 ? (winCount / closedTradesCount) * 100 : 0

    return {
      netProfit,
      totalFees,
      roi,
      winRate,
      profitFactor,
      capitalUtilized,
      maxDrawdown: pnlSummary.maxDrawdown,
      accountEquity: accountBalance + netProfit,
      tradeGroups,
      safetyOrderUsage,
    }
  }, [results.backtestId]) // eslint-disable-line react-hooks/exhaustive-deps
}
