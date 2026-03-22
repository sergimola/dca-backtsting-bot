import React from 'react'
import type { Run } from '../services/types'
import { useResultsMetrics } from '../hooks/useResultsMetrics'
import { DashboardHeader } from './DashboardHeader'
import { KpiGrid } from './KpiGrid'
import { SafetyOrderUsagePanel } from './SafetyOrderUsagePanel'
import { ConfigSummaryPanel } from './ConfigSummaryPanel'
import { TradingTimeline } from './TradingTimeline'

interface DashboardViewProps {
  run: Run
}

export function DashboardView({ run }: DashboardViewProps) {
  const metrics = useResultsMetrics(run.results!, run.config)
  const initialBalance = parseFloat(run.config.accountBalance) || 0

  return (
    // 1. Outer container: Full height, hidden overflow to prevent double scrollbars
    <div className="flex flex-col h-full overflow-hidden relative bg-[#05070a]">
      
      {/* 2. FIXED HEADER & METRICS: This area never scrolls */}
      <div className="shrink-0 z-30 pt-4 pb-5 px-6 border-b border-slate-800/80 shadow-md">
        <DashboardHeader run={run} executionMs={run.results?.executionTimeMs} />
        <div className="mt-4">
          <KpiGrid metrics={metrics} />
        </div>
      </div>

      {/* 3. SCROLLABLE CONTENT AREA: Only the timeline and sidebar scroll */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        
        {/* items-start prevents the sidebar from stretching to full height, which breaks sticky */}
        <div className="flex gap-4 p-6 items-start">
          
          {/* Left Column: The Timeline */}
          <section className="flex-1 min-w-0 rounded-xl border border-slate-800/60 pt-4 bg-[#0b0e14] shadow-sm">
            <TradingTimeline
              tradeEvents={run.results!.tradeEvents}
              tradeGroups={metrics.tradeGroups}
              initialBalance={initialBalance}
              maxOrders={parseInt(run.config.numberOfOrders) || 0}
              startDate={run.config.startDate}
            />
          </section>

          {/* Right Column: Sticky Sidebar */}
          {/* Because it is inside the scrolling container, top-0 perfectly stops it right under the KPI grid! */}
          <aside className="w-64 shrink-0 space-y-4 sticky top-0">
            <SafetyOrderUsagePanel
              safetyOrderUsage={metrics.safetyOrderUsage}
              totalTrades={metrics.tradeGroups.length}
            />
            <ConfigSummaryPanel config={run.config} />
          </aside>
          
        </div>
      </div>
    </div>
  )
}