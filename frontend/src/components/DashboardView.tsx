import React from 'react'
import type { Run } from '../services/types'
import { useResultsMetrics } from '../hooks/useResultsMetrics'
import { DashboardHeader } from './DashboardHeader'
import { KpiGrid } from './KpiGrid'
import { SafetyOrderUsagePanel } from './SafetyOrderUsagePanel'
import { ConfigSummaryPanel } from './ConfigSummaryPanel'
import { TradeAccordion } from './TradeAccordion'

interface DashboardViewProps {
  run: Run
}

export function DashboardView({ run }: DashboardViewProps) {
  const metrics = useResultsMetrics(run.results!, run.config)

  return (
    <div className="flex flex-col h-full overflow-y-auto custom-scrollbar">
      <DashboardHeader run={run} />
      <KpiGrid metrics={metrics} />

      <div className="flex gap-4 px-6 pb-6">
        {/* Trade history — left 3/4 */}
        <section className="flex-1 min-w-0">
          <h2 className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
            Trade History
          </h2>
          {metrics.tradeGroups.map(tg => (
            <TradeAccordion key={tg.tradeId} metrics={tg} />
          ))}
        </section>

        {/* Right column — 1/4 */}
        <aside className="w-64 shrink-0 space-y-4">
          <SafetyOrderUsagePanel
            safetyOrderUsage={metrics.safetyOrderUsage}
            totalTrades={metrics.tradeGroups.length}
          />
          <ConfigSummaryPanel config={run.config} />
        </aside>
      </div>
    </div>
  )
}
