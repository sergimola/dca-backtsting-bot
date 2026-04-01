/**
 * CombinatorialFooter — Sticky footer with Generated/Pruned/Valid counts + Launch button.
 */
import React from 'react'
import type { SweepCounts } from '../../hooks/useOptimizer'

interface Props {
  sweepCounts: SweepCounts | null
  onLaunch: () => void
  isLoading?: boolean
}

export function CombinatorialFooter({ sweepCounts, onLaunch, isLoading }: Props) {
  const valid = sweepCounts?.valid ?? sweepCounts?.count ?? 0
  const canLaunch = Boolean(sweepCounts && !sweepCounts.overLimit && valid > 0)

  return (
    <div className="sticky bottom-0 px-4 py-3 bg-slate-900/95 border-t border-slate-700 backdrop-blur-sm">
      {sweepCounts && (
        <div className="flex items-center gap-3 text-xs mb-2">
          <span className="text-slate-400">
            Generated: <span className="text-slate-200 font-medium">{sweepCounts.generated ?? sweepCounts.count}</span>
          </span>
          {sweepCounts.pruned != null && (
            <span className="text-slate-400">
              Pruned: <span className="text-amber-400 font-medium">{sweepCounts.pruned}</span>
            </span>
          )}
          <span className="text-slate-400">
            Valid: <span className="text-emerald-400 font-medium">{valid}</span>
          </span>
          {sweepCounts.overLimit && (
            <span className="text-red-400 font-medium">⚠ Over 10,000 limit</span>
          )}
        </div>
      )}
      <button
        onClick={onLaunch}
        disabled={!canLaunch || isLoading}
        className={`w-full py-2 rounded font-medium text-sm transition-colors ${
          canLaunch && !isLoading
            ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
            : 'bg-slate-700 text-slate-500 cursor-not-allowed'
        }`}
      >
        {isLoading ? 'Launching...' : 'Launch Sweep'}
      </button>
    </div>
  )
}
