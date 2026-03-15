import React, { useState } from 'react'
import { Plus } from 'lucide-react'
import type { Run } from '../services/types'
import { RunCard } from './RunCard'

interface LeftSidebarProps {
  runs: Run[]
  selectedRunId: string | null
  onNewBacktest: () => void
  onSelectRun: (backtestId: string) => void
  onViewDashboard: (backtestId: string) => void
}

export function LeftSidebar({ runs, selectedRunId, onNewBacktest, onSelectRun, onViewDashboard }: LeftSidebarProps) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  const handleCardClick = (backtestId: string) => {
    onSelectRun(backtestId)
    setExpandedRunId(prev => prev === backtestId ? null : backtestId)
  }

  return (
    <aside className="w-80 h-full flex flex-col border-r border-slate-800 bg-[#080b14]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <span className="text-sm font-semibold tracking-widest uppercase text-slate-300">QuantDCA</span>
        <button
          onClick={onNewBacktest}
          className="flex items-center justify-center w-7 h-7 rounded bg-blue-500 hover:bg-blue-400 text-white text-lg font-bold leading-none"
          aria-label="New backtest"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Run list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {runs.map(run => (
          <RunCard
            key={run.backtestId}
            run={run}
            isSelected={run.backtestId === selectedRunId}
            isExpanded={run.backtestId === expandedRunId}
            onSelect={() => handleCardClick(run.backtestId)}
            onViewDashboard={() => onViewDashboard(run.backtestId)}
          />
        ))}
        {runs.length === 0 && (
          <p className="text-slate-500 text-xs text-center mt-8 px-4">
            No runs yet. Click&nbsp;+ to start.
          </p>
        )}
      </div>
    </aside>
  )
}
