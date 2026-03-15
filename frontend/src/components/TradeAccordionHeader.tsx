import React from 'react'
import { TrendingDown, PieChart } from 'lucide-react'
import type { TradeGroupMetrics } from '../services/types'
import { formatCurrency } from '../services/formatters'

interface TradeAccordionHeaderProps {
  metrics: TradeGroupMetrics
  isOpen: boolean
  onToggle: () => void
}

function durationClass(hours: number): string {
  if (hours < 24)  return 'text-emerald-400'
  if (hours < 120) return 'text-amber-400'
  return 'text-rose-400'
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${hours.toFixed(1)}h`
  return `${Math.round(hours / 24)}d`
}

export function TradeAccordionHeader({ metrics, isOpen, onToggle }: TradeAccordionHeaderProps) {
  return (
    <div
      className="group relative flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-slate-800/30 transition-colors select-none"
      onClick={onToggle}
    >
      {/* Trade ID pill */}
      <span className="text-[10px] font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
        #{metrics.tradeId.slice(0, 6)}
      </span>

      {/* Status pill */}
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
        {metrics.status}
      </span>

      {/* Duration badge */}
      <span className={`text-[10px] ${durationClass(metrics.durationHours)}`}>
        {formatDuration(metrics.durationHours)}
      </span>

      {/* MAE tooltip */}
      <div className="relative group/mae">
        <TrendingDown className="w-3.5 h-3.5 text-rose-400 cursor-pointer" aria-label="MAE" />
        <div
          data-testid="mae-tooltip"
          className="hidden group-hover/mae:block absolute bottom-full left-1/2 -translate-x-1/2
                     mb-2 px-2 py-1 bg-[#0d1117] border border-slate-700 rounded text-[10px]
                     text-slate-300 whitespace-nowrap z-50 pointer-events-none"
        >
          MAE: {formatCurrency(metrics.mae)}
        </div>
      </div>

      {/* Capital deployed tooltip */}
      <div className="relative group/capital">
        <PieChart className="w-3.5 h-3.5 text-blue-400 cursor-pointer" aria-label="Capital Deployed" />
        <div
          data-testid="capital-tooltip"
          className="hidden group-hover/capital:block absolute bottom-full left-1/2 -translate-x-1/2
                     mb-2 px-2 py-1 bg-[#0d1117] border border-slate-700 rounded text-[10px]
                     text-slate-300 whitespace-nowrap z-50 pointer-events-none"
        >
          Capital: {formatCurrency(metrics.maxCapitalDeployed)}
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Gross / Fees / Net */}
      <div className="flex items-center gap-3 text-xs">
        <span className="text-slate-400">
          {metrics.grossProfit >= 0 ? '+' : ''}{formatCurrency(metrics.grossProfit)}
        </span>
        <span className="text-rose-400">{formatCurrency(-metrics.totalFees)}</span>
        <span className="text-emerald-400">
          {metrics.netProfit >= 0 ? '+' : ''}{formatCurrency(metrics.netProfit)}
        </span>
      </div>

      {/* Chevron */}
      <span className={`text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
    </div>
  )
}
