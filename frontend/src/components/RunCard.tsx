import React from 'react'
import { Loader2, AlertCircle, TrendingDown } from 'lucide-react'
import type { Run } from '../services/types'
import { formatCurrency, formatPercentage } from '../services/formatters'
import { calculateNetMetrics } from '../services/metricsCalculator'

interface RunCardProps {
  run: Run
  isSelected: boolean
  isExpanded: boolean
  onSelect: () => void
  onViewDashboard: () => void
}

export function RunCard({ run, isSelected, isExpanded, onSelect, onViewDashboard }: RunCardProps) {
  const selectedClass = isSelected
    ? 'bg-blue-500/5 border-l-2 border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.05)]'
    : 'border-l-2 border-transparent'

  const completedResults = run.status === 'completed' ? run.results : undefined
  
  // Calculate net metrics using shared utility
  const metrics = completedResults ? calculateNetMetrics(completedResults, run.config) : null

  // Net profit and ROI: pnlSummary.roi is already net of all fees (engine deducts
  // fees via FeesAccumulated before CalculateProfit). Do NOT subtract fees again.
  // When tradeEvents are present, use the event-derived metrics directly.
  // When list-view returns tradeEvents:[] (select omission), use pnlSummary directly.
  const { displayNetProfit, displayNetRoi } = (() => {
    if (!completedResults) return { displayNetProfit: 0, displayNetRoi: 0 };
    const netRoi = completedResults.pnlSummary.roi;
    if (completedResults.tradeEvents.length > 0) {
      return { displayNetProfit: metrics?.netProfit ?? 0, displayNetRoi: netRoi };
    }
    // Fallback when tradeEvents are empty (list-view omission): derive dollar amount from roi.
    const balance = parseFloat(run.config.accountBalance) || 1;
    const netProfit = (netRoi / 100) * balance;
    return { displayNetProfit: netProfit, displayNetRoi: netRoi };
  })();
  
  // Unused safety orders: numberOfOrders is the TOTAL safety orders allowed (including initial entry)
  // So we need numberOfOrders - 1 = max possible safety order levels, then subtract actual usage
  const unusedSafetyOrders =
    completedResults && run.config.numberOfOrders
      ? (parseInt(run.config.numberOfOrders) - 1) - (completedResults.safetyOrderUsage?.length ?? 0)
      : 0

  return (
    <div
      className={`px-4 py-3 cursor-pointer hover:bg-slate-800/30 transition-colors ${selectedClass}`}
      onClick={onSelect}
      role="button"
      aria-pressed={isSelected}
    >
      {/* Run ID + pair header */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">
          #{run.shortId}
        </span>
        <span className="text-xs text-slate-400">{run.config.tradingPair}</span>
      </div>

      {/* Date range */}
      <div className="text-[10px] text-slate-500 mb-1">
        {run.config.startDate?.slice(0, 10)} → {run.config.endDate?.slice(0, 10)}
      </div>

      {/* Status area */}
      {run.status === 'running' && (
        <div className="flex items-center gap-1 text-xs text-blue-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Processing…</span>
        </div>
      )}

      {run.status === 'failed' && (
        <div className="flex items-center gap-1 text-xs text-red-400">
          <AlertCircle className="w-3 h-3" />
          <span>Failed</span>
        </div>
      )}

      {run.status === 'completed' && completedResults && (
        <div className="flex items-center gap-2 text-xs">
          <span className={displayNetRoi >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
            ROI {formatPercentage(displayNetRoi)}
          </span>
          <span className="text-slate-400">/ {formatCurrency(displayNetProfit)}</span>
        </div>
      )}

      {/* Expanded details */}
      {run.status === 'completed' && isExpanded && completedResults && metrics && (
        <div className="mt-2 pt-2 border-t border-slate-700/50 text-[10px] text-slate-400 space-y-1">
          <div>Trades: {metrics.closedTradesCount}</div>
          <div>Price scale: {run.config.priceScale}</div>
          <div>Max Drawdown: {formatPercentage(completedResults.pnlSummary.maxDrawdown)}</div>
          <div>Annualized Return: {completedResults.pnlSummary.annualizedReturn != null
            ? `${completedResults.pnlSummary.annualizedReturn.toFixed(4)}%`
            : 'N/A'}
          </div>

          {unusedSafetyOrders > 0 && (
            <div className="flex items-center gap-1 text-amber-400">
              <AlertCircle className="w-3 h-3" />
              <span>{unusedSafetyOrders} unused safety orders</span>
            </div>
          )}

          <button
            className="mt-1 text-blue-400 hover:text-blue-300 underline"
            onClick={e => { e.stopPropagation(); onViewDashboard() }}
          >
            View Full Dashboard
          </button>
        </div>
      )}
    </div>
  )
}
