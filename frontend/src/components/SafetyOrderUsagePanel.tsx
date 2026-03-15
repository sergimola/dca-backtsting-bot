import React from 'react'
import type { SafetyOrderUsage } from '../services/types'

interface SafetyOrderUsagePanelProps {
  safetyOrderUsage: SafetyOrderUsage[]
  totalTrades: number
}

export function SafetyOrderUsagePanel({ safetyOrderUsage, totalTrades }: SafetyOrderUsagePanelProps) {
  return (
    <div className="bg-[#0d1117] border border-slate-800 rounded p-4">
      <h3 className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
        Safety Order Usage
      </h3>
      <div className="space-y-2">
        {safetyOrderUsage.map((so, i) => {
          const pct = totalTrades > 0 ? Math.min((so.count / totalTrades) * 100, 100) : 0
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-10 text-slate-400 shrink-0">SO {so.level}</span>
              <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-slate-500 text-[10px] w-14 text-right shrink-0">
                {so.count}/{totalTrades}
              </span>
            </div>
          )
        })}
        {safetyOrderUsage.length === 0 && (
          <p className="text-slate-500 text-xs">No safety order data</p>
        )}
      </div>
    </div>
  )
}
