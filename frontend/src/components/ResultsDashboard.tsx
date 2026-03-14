import React, { useState, useMemo } from 'react'
import Decimal from 'decimal.js'
import { SafetyOrderChart } from './SafetyOrderChart'
import type { BacktestResults, TradeEvent } from '../services/types'

export interface ResultsDashboardProps {
  results: BacktestResults
  onReset: () => void
  onModify: () => void
}

// --- Event type pill styles ---
const EVENT_PILL: Record<string, string> = {
  ENTRY:        'bg-emerald-900/40 text-emerald-300 px-2 py-1 rounded-full text-xs font-bold',
  SAFETY_ORDER: 'bg-slate-600/40 text-slate-200 px-2 py-1 rounded-full text-xs font-bold',
  EXIT:         'bg-rose-900/40 text-rose-300 px-2 py-1 rounded-full text-xs font-bold',
}

// --- Group trade events by trade_id ---
function groupByTradeId(events: TradeEvent[]): [string, TradeEvent[]][] {
  const map = new Map<string, TradeEvent[]>()
  for (const e of events) {
    const key = e.trade_id || 'unknown'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(e)
  }
  return Array.from(map.entries())
}

// --- Single trade accordion card ---
function TradeAccordion({ tradeId, events }: { tradeId: string; events: TradeEvent[] }) {
  const [open, setOpen] = useState(false)

  const exitEvent = events.find(e => e.eventType === 'EXIT')
  const netProfit = exitEvent ? exitEvent.balance : null
  const status    = exitEvent ? 'CLOSED' : 'OPEN'

  // Compute total fees with Decimal precision (US2)
  const tradeTotalFees = events
    .reduce((acc, e) => acc.plus(new Decimal(e.fee ?? 0)), new Decimal(0))
    .toNumber()

  // Gross = Net + Fees; null for open trades (US2)
  const grossProfit = netProfit !== null
    ? new Decimal(netProfit).plus(tradeTotalFees).toNumber()
    : null

  const grossStr = grossProfit !== null
    ? `${grossProfit >= 0 ? '+' : ''}$${grossProfit.toFixed(2)}`
    : '—'
  const feesStr  = `-$${tradeTotalFees.toFixed(2)}`
  const netStr   = netProfit !== null
    ? `${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}`
    : '—'

  const grossColor = grossProfit !== null
    ? (grossProfit >= 0 ? 'text-emerald-400' : 'text-rose-400')
    : 'text-slate-400'
  const netColor = netProfit !== null
    ? (netProfit > 0 ? 'text-emerald-400' : 'text-rose-400')
    : 'text-slate-400'

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      {/* Collapsed header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-slate-800 hover:bg-slate-700 transition-colors text-left"
      >
        <div className="flex items-center gap-5 min-w-0 flex-wrap">
          <span className="text-gray-200 text-sm font-semibold">Trade #{tradeId}</span>
          <span className="text-gray-500 text-xs">
            Gross: <span className={`font-semibold tabular-nums ${grossColor}`}>{grossStr}</span>
          </span>
          <span className="text-gray-500 text-xs">
            Fees: <span className="font-semibold tabular-nums text-rose-400">{feesStr}</span>
          </span>
          <span className="text-gray-500 text-xs">
            Net: <span className={`font-semibold tabular-nums ${netColor}`}>{netStr}</span>
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
            status === 'CLOSED'
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-amber-500/20 text-amber-400'
          }`}>
            {status}
          </span>
          <span className="text-gray-500 text-xs select-none">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expanded event rows */}
      {open && (
        <div className="divide-y divide-gray-700/50">
          {/* Column headers */}
          <div className="px-5 py-2 flex items-center gap-4 bg-gray-900/50">
            <span className="w-28 text-gray-600 text-xs uppercase tracking-wide">Type</span>
            <span className="flex-1 text-gray-600 text-xs uppercase tracking-wide">Timestamp</span>
            <span className="w-32 text-right text-gray-600 text-xs uppercase tracking-wide">Price</span>
            <span className="w-28 text-right text-gray-600 text-xs uppercase tracking-wide">Quantity</span>
            <span className="w-32 text-right text-gray-600 text-xs uppercase tracking-wide">Amount / P&L</span>
          </div>

          {events.map((event, idx) => {
            const isExit   = event.eventType === 'EXIT'
            const valueColor = isExit
              ? (event.balance >= 0 ? 'text-emerald-400' : 'text-rose-400')
              : 'text-gray-300'

            return (
              <div key={idx} className="px-5 py-2.5 flex items-center gap-4 bg-gray-800/60 hover:bg-gray-800 transition-colors">
                <div className="w-28 shrink-0">
                  <span className={EVENT_PILL[event.eventType] ?? 'bg-gray-600/20 text-gray-400 px-2 py-1 rounded-full text-xs font-bold'}>
                    {event.eventType}
                  </span>
                </div>
                <span className="flex-1 text-gray-500 text-xs truncate">{event.timestamp}</span>
                <span className="w-32 text-right font-mono text-gray-300 text-sm">
                  ${event.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="w-28 text-right font-mono text-gray-400 text-sm">
                  {event.quantity.toFixed(6)}
                </span>
                <span className={`w-32 text-right font-mono text-sm font-semibold tabular-nums ${valueColor}`}>
                  {isExit
                    ? `${event.balance >= 0 ? '+' : ''}$${event.balance.toFixed(4)}`
                    : `$${event.balance.toFixed(4)}`}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- Main Dashboard ---
export function ResultsDashboard({ results, onReset, onModify }: ResultsDashboardProps) {
  const { pnlSummary } = results

  const tradeGroups = useMemo(() => groupByTradeId(results.tradeEvents), [results.tradeEvents])

  const roiPositive = pnlSummary.roi >= 0

  // Compute Total Net P&L in dollar terms from closed trade profits (US4/T023)
  const totalNetPnL = useMemo(() =>
    results.tradeEvents
      .filter(e => e.eventType === 'EXIT')
      .reduce((sum, e) => sum + e.balance, 0),
    [results.tradeEvents]
  )
  const pnlPositive = totalNetPnL >= 0

  return (
    <div className="space-y-6 text-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Backtest Results</h1>
          <p className="text-gray-500 text-sm mt-0.5">ID: {results.backtestId}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onReset}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium text-sm transition-colors"
          >
            New Backtest
          </button>
          <button
            onClick={onModify}
            className="px-5 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg font-medium text-sm transition-colors border border-gray-600"
          >
            Modify &amp; Re-run
          </button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">Total Net P&L</p>
          <p className={`text-2xl font-bold tabular-nums ${pnlPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {pnlPositive ? '+' : ''}${totalNetPnL.toFixed(2)}
          </p>
        </div>
        <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">Return on Investment</p>
          <p className={`text-2xl font-bold tabular-nums ${roiPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {roiPositive ? '+' : ''}{pnlSummary.roi.toFixed(4)}%
          </p>
        </div>
        <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">Max Drawdown</p>
          <p className="text-2xl font-bold tabular-nums text-rose-400">
            {pnlSummary.maxDrawdown.toFixed(4)}%
          </p>
        </div>
        <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">Total Fees</p>
          <p className="text-2xl font-bold tabular-nums text-red-400">
            ${pnlSummary.totalFees.toFixed(4)}
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <SafetyOrderChart soUsageData={results.safetyOrderUsage} />
      </div>

      {/* Trade Accordions */}
      <div>
        <h2 className="text-lg font-semibold text-gray-300 mb-3">
          Trade History
          <span className="ml-2 text-sm font-normal text-gray-500">({tradeGroups.length} trade{tradeGroups.length !== 1 ? 's' : ''})</span>
        </h2>
        {tradeGroups.length === 0 ? (
          <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-500 border border-gray-700">
            No trade events recorded
          </div>
        ) : (
          <div className="space-y-2">
            {tradeGroups.map(([tradeId, events]) => (
              <TradeAccordion key={tradeId} tradeId={tradeId} events={events} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

