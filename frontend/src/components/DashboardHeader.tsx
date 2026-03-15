import React from 'react'
import { Calendar, Clock, Hash } from 'lucide-react'
import type { Run } from '../services/types'

interface DashboardHeaderProps {
  run: Run
  executionMs?: number
}

export function DashboardHeader({ run, executionMs }: DashboardHeaderProps) {
  const startMs = new Date(run.config.startDate).getTime()
  const endMs   = new Date(run.config.endDate).getTime()
  const durationDays = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24))

  const startFormatted = run.config.startDate?.slice(0, 10) ?? '—'
  const endFormatted   = run.config.endDate?.slice(0, 10) ?? '—'

  return (
    <div className="flex items-center gap-6 px-6 py-4 border-b border-slate-800">
      <div className="flex items-center gap-1.5 text-slate-400 text-xs">
        <Hash className="w-3.5 h-3.5" />
        <span className="font-mono text-slate-300">{run.shortId}</span>
      </div>
      <div className="flex items-center gap-1.5 text-slate-400 text-xs">
        <Calendar className="w-3.5 h-3.5" />
        <span>{startFormatted} – {endFormatted}</span>
        <span className="text-slate-500">({durationDays} days)</span>
      </div>
      {executionMs != null && executionMs > 0 && (
        <div className="flex items-center gap-1.5 text-slate-400 text-xs">
          <Clock className="w-3.5 h-3.5" />
          <span className="text-slate-500">Engine</span>
          <span>{executionMs >= 1000 ? `${(executionMs / 1000).toFixed(1)}s` : `${executionMs}ms`}</span>
        </div>
      )}
    </div>
  )
}
