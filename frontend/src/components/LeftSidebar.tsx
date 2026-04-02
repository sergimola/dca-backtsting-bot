import React, { useState } from 'react'
import { Plus, ChevronLeft, ChevronRight, BarChart2, TrendingUp } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { Run } from '../services/types'
import { RunCard } from './RunCard'
import { SweepHistoryList } from './optimizer/SweepHistoryList'
import type { SweepHistoryEntry } from './optimizer/SweepHistoryList'

interface LeftSidebarProps {
  runs: Run[]
  selectedRunId: string | null
  onNewBacktest: () => void
  onSelectRun: (backtestId: string) => void
  onViewDashboard: (backtestId: string) => void
  sweepHistory?: SweepHistoryEntry[]
  onSelectSweep?: (id: string) => void
  onLoadMoreSweeps?: () => void
  hasMoreSweeps?: boolean
  onDeleteSweep?: (id: string) => void
}

export function LeftSidebar({
  runs, selectedRunId, onNewBacktest, onSelectRun, onViewDashboard,
  sweepHistory = [], onSelectSweep, onLoadMoreSweeps, hasMoreSweeps, onDeleteSweep,
}: LeftSidebarProps) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const isOptimizer = location.pathname === '/optimizer'

  const handleCardClick = (backtestId: string) => {
    if (isOptimizer) navigate('/')
    onSelectRun(backtestId)
    setExpandedRunId(prev => prev === backtestId ? null : backtestId)
  }

  // Collapsed mode: w-14 with nav icons only.
  if (isCollapsed) {
    return (
      <aside className="w-14 h-full flex flex-col border-r border-slate-800 bg-[#080b14] transition-[width] duration-300">
        <div className="flex flex-col items-center py-3 gap-3 flex-1">
          <button
            onClick={() => navigate('/')}
            className={`p-2 rounded ${!isOptimizer ? 'text-blue-400 bg-blue-500/10' : 'text-slate-500 hover:text-slate-400'}`}
            title="Backtests"
            aria-label="Backtests"
          >
            <BarChart2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate('/optimizer')}
            className={`p-2 rounded ${isOptimizer ? 'text-blue-400 bg-blue-500/10' : 'text-slate-500 hover:text-slate-400'}`}
            title="Optimizer"
            aria-label="Optimizer"
          >
            <TrendingUp className="w-4 h-4" />
          </button>
        </div>
        <div className="flex justify-center py-2 border-t border-slate-800">
          <button
            onClick={() => setIsCollapsed(false)}
            className="p-1.5 text-slate-600 hover:text-slate-400 rounded"
            aria-label="Expand sidebar"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </aside>
    )
  }

  // Expanded mode: w-80 with full content.
  return (
    <aside className="w-80 h-full flex flex-col border-r border-slate-800 bg-[#080b14] transition-[width] duration-300">
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

      {/* Nav tabs */}
      <div className="flex border-b border-slate-800">
        <button
          onClick={() => navigate('/')}
          className={`flex-1 py-2 text-xs font-medium text-center ${!isOptimizer ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-400'}`}
        >
          Backtests
        </button>
        <button
          onClick={() => navigate('/optimizer')}
          className={`flex-1 py-2 text-xs font-medium text-center ${isOptimizer ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-400'}`}
        >
          Optimizer
        </button>
      </div>

      {/* Context-aware content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {isOptimizer ? (
          <SweepHistoryList
            entries={sweepHistory}
            onSelect={onSelectSweep}
            onDelete={onDeleteSweep}
            hasMore={hasMoreSweeps}
            onLoadMore={onLoadMoreSweeps}
          />
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* Collapse toggle */}
      <div className="flex justify-end px-3 py-2 border-t border-slate-800">
        <button
          onClick={() => setIsCollapsed(true)}
          className="p-1 text-slate-600 hover:text-slate-400 rounded"
          aria-label="Collapse sidebar"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    </aside>
  )
}
