import React from 'react'
import {
  Wallet, TrendingUp, Percent, BarChart2, Receipt, PieChart, TrendingDown, Target, Activity
} from 'lucide-react'
import type { DashboardMetrics } from '../services/types'
import { formatCurrency, formatPercentage } from '../services/formatters'

interface KpiGridProps {
  metrics: DashboardMetrics
}

interface KpiCardProps {
  label: string
  value: string
  subtitle?: string
  Icon: React.FC<{ className?: string }>
  valueClass?: string
}

function KpiCard({ label, value, subtitle, Icon, valueClass = 'text-slate-100' }: KpiCardProps) {
  return (
    <div aria-label="kpi-card" className="bg-[#0d1117] border border-slate-800 rounded p-4 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-[10px] uppercase tracking-widest text-slate-500">{label}</span>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${valueClass}`}>{value}</div>
      {subtitle && <div className="text-[10px] text-slate-500">{subtitle}</div>}
    </div>
  )
}

export function KpiGrid({ metrics }: KpiGridProps) {
  const roiClass = metrics.roi > 0 ? 'text-emerald-400' : metrics.roi < 0 ? 'text-rose-400' : 'text-slate-100'

  return (
    <div className="grid grid-cols-4 gap-3 p-6">
      <KpiCard
        label="Account Equity"
        Icon={Wallet}
        value={formatCurrency(metrics.accountEquity)}
      />
      <KpiCard
        label="Net Profit"
        Icon={TrendingUp}
        value={formatCurrency(metrics.netProfit)}
        valueClass={metrics.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}
      />
      <KpiCard
        label="ROI"
        Icon={Percent}
        value={formatPercentage(metrics.roi)}
        valueClass={roiClass}
      />
      <KpiCard
        label="Profit Factor"
        Icon={BarChart2}
        value={isFinite(metrics.profitFactor) ? metrics.profitFactor.toFixed(2) : '∞'}
      />
      <KpiCard
        label="Total Fees"
        Icon={Receipt}
        value={formatCurrency(metrics.totalFees)}
        valueClass="text-rose-300"
      />
      <KpiCard
        label="Capital Utilized"
        Icon={PieChart}
        value={formatPercentage(metrics.capitalUtilized)}
      />
      <KpiCard
        label="Max Drawdown"
        Icon={TrendingDown}
        value={formatPercentage(metrics.maxDrawdown)}
        valueClass="text-rose-300"
      />
      <KpiCard
        label="Win Rate"
        Icon={Target}
        value={formatPercentage(metrics.winRate)}
        valueClass={metrics.winRate >= 50 ? 'text-emerald-400' : 'text-slate-100'}
      />
      <KpiCard
        label="Annualized Return (IRR)"
        Icon={Activity}
        value={metrics.annualizedReturn != null ? formatPercentage(metrics.annualizedReturn) : 'N/A'}
        valueClass={metrics.annualizedReturn != null
          ? (metrics.annualizedReturn >= 0 ? 'text-emerald-400' : 'text-rose-400')
          : 'text-slate-500'}
      />
    </div>
  )
}
