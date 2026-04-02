/**
 * CombinatorialFooter — Sticky footer with Generated/Pruned/Valid counts + Launch button.
 */
import React, { useState } from 'react'
import type { SweepCounts, PruneBreakdown } from '../../hooks/useOptimizer'

const PRUNE_LABELS: Record<keyof PruneBreakdown, string> = {
  capital_exceeds_balance: 'Exceeded Account Balance',
  base_order_below_minimum: 'Base Order Below $10',
  guaranteed_fee_loss: 'Guaranteed Fee Loss (TP ≤ 0.2%)',
  exceeds_100_percent_drawdown: 'Exceeds 100% Drawdown',
  tick_size_violation: 'Tick Size Violation',
}

interface Props {
  sweepCounts: SweepCounts | null
  onLaunch: () => void
  isLoading?: boolean
}

export function CombinatorialFooter({ sweepCounts, onLaunch, isLoading }: Props) {
  const valid = sweepCounts?.valid ?? sweepCounts?.count ?? 0
  const canLaunch = Boolean(sweepCounts && valid > 0)
  const [showTooltip, setShowTooltip] = useState(false)

  const hasPruneReasons = sweepCounts?.pruneReasons != null
  const pruneReasons = sweepCounts?.pruneReasons

  return (
    <div className="sticky bottom-0 px-4 py-3 bg-slate-900/95 border-t border-slate-700 backdrop-blur-sm">
      {sweepCounts && (
        <div className="flex items-center gap-3 text-xs mb-2">
          <span className="text-slate-400">
            Generated: <span className="text-slate-200 font-medium">{sweepCounts.generated ?? sweepCounts.count}</span>
          </span>
          {sweepCounts.pruned != null && (
            <span
              className="relative text-slate-400 cursor-pointer"
              onMouseEnter={() => { if (hasPruneReasons) setShowTooltip(true) }}
              onMouseLeave={() => setShowTooltip(false)}
            >
              Pruned:{' '}
              <span className={`font-medium ${hasPruneReasons ? 'underline decoration-dotted text-amber-400' : 'text-amber-400'}`}>
                {sweepCounts.pruned}
              </span>
              {hasPruneReasons && showTooltip && pruneReasons && (
                <div className="absolute bottom-full left-0 mb-1 z-50 bg-slate-800 border border-slate-600 rounded p-2 w-64 shadow-lg">
                  <div className="text-slate-300 font-medium mb-1">Prune Breakdown</div>
                  {(Object.keys(PRUNE_LABELS) as Array<keyof PruneBreakdown>).map(key => (
                    <div key={key} className="flex justify-between text-xs text-slate-400 py-0.5">
                      <span>↳ {PRUNE_LABELS[key]}</span>
                      <span className={pruneReasons[key] > 0 ? 'text-amber-300' : 'text-slate-500'}>
                        {pruneReasons[key]}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </span>
          )}
          <span className="text-slate-400">
            Valid: <span className="text-emerald-400 font-medium">{valid}</span>
          </span>

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
