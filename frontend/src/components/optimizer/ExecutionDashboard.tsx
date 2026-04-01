/**
 * ExecutionDashboard — Master progress bar + live leaderboard.
 * Shown during the 'running' phase.
 */
import React from 'react'
import { LeaderboardGrid } from './LeaderboardGrid'
import type { OptimizerSession, BatchRunResult } from '../../hooks/useOptimizer'

interface Props {
  session: OptimizerSession
  onCancel: () => void
  isCancelled?: boolean
}

export function ExecutionDashboard({ session, onCancel, isCancelled }: Props) {
  const completed = session.results.length
  const total = session.totalRuns
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="flex flex-col h-full">
      {/* Progress bar */}
      <div className="px-6 py-4 border-b border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-300">
            {isCancelled
              ? `Cancelled (${completed}/${total})`
              : `${completed} / ${total} Runs Completed (${pct}%)`}
          </span>
          {!isCancelled && (
            <button
              onClick={onCancel}
              className="text-xs px-3 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded border border-red-600/30"
            >
              Cancel Sweep
            </button>
          )}
        </div>
        <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              isCancelled ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Banner for cancelled */}
      {isCancelled && (
        <div className="mx-6 mt-3 px-4 py-2 bg-amber-900/30 border border-amber-600/30 rounded text-amber-400 text-sm">
          Sweep was cancelled. Showing {completed} of {total} completed results.
        </div>
      )}

      {/* Leaderboard */}
      <div className="flex-1 overflow-hidden">
        <LeaderboardGrid results={session.results} />
      </div>
    </div>
  )
}
