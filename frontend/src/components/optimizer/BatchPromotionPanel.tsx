/**
 * BatchPromotionPanel — Shows progress bar, cancel button, and error list
 * during a batch promotion to ClickHouse.
 */
import React from 'react'
import type { BatchPromotionStatus } from '../../hooks/useOptimizer'

interface Props {
  status: BatchPromotionStatus
  onCancel: (sessionId: string) => void
  onDismiss: () => void
}

export function BatchPromotionPanel({ status, onCancel, onDismiss }: Props) {
  const pct = status.total > 0 ? Math.round((status.completed / status.total) * 100) : 0
  const isActive = status.status === 'running'
  const isDone = status.status === 'completed' || status.status === 'cancelled' || status.status === 'failed'

  return (
    <div className="mx-4 mt-3 px-4 py-3 bg-slate-800/80 border border-slate-700/50 rounded-lg space-y-2" data-testid="promotion-panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
          {isActive
            ? `Promoting ${status.completed}/${status.total} configs…`
            : status.status === 'completed'
              ? `Promotion complete — ${status.completed} promoted`
              : status.status === 'cancelled'
                ? 'Promotion cancelled'
                : 'Promotion failed'}
        </span>
        <div className="flex items-center gap-2">
          {isActive && (
            <button
              onClick={() => onCancel(status.session_id)}
              className="text-xs px-2 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded border border-red-600/30"
            >
              Cancel
            </button>
          )}
          {isDone && (
            <button
              onClick={onDismiss}
              className="text-xs px-2 py-1 text-slate-500 hover:text-slate-300"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            status.status === 'failed' ? 'bg-red-500' :
            status.status === 'cancelled' ? 'bg-amber-500' :
            'bg-emerald-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Error list */}
      {status.errors.length > 0 && (
        <details className="text-xs">
          <summary className="text-red-400 cursor-pointer">
            {status.errors.length} error{status.errors.length !== 1 ? 's' : ''}
          </summary>
          <ul className="mt-1 space-y-0.5 text-red-300/80 pl-3 max-h-24 overflow-y-auto">
            {status.errors.map((e, i) => (
              <li key={i}>
                {e.run_id ? <span className="text-slate-500">{e.run_id.slice(0, 8)}…</span> : null}{' '}
                {e.error}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Failed count */}
      {isDone && status.failed > 0 && status.errors.length === 0 && (
        <p className="text-xs text-amber-400">{status.failed} run{status.failed !== 1 ? 's' : ''} failed</p>
      )}
    </div>
  )
}
