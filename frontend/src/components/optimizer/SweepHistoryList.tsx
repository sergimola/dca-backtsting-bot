/**
 * SweepHistoryList (T040) — Lists past sweep sessions in the sidebar.
 *
 * FR-004: Shows date, trading pair, total runs, max ROI (or N/A), status badge.
 * FR-014: Clicking a row loads the Quant Matrix for that session.
 * US2: Empty state shown when no sweeps yet.
 */

import React from 'react'
import { Trash2 } from 'lucide-react'

export interface SweepHistoryEntry {
  id: string
  tradingPair: string
  startDate: string
  endDate: string
  totalRuns: number
  maxRoi: number | null
  status: 'completed' | 'cancelled' | 'running'
  createdAt: string
}

interface Props {
  entries: SweepHistoryEntry[]
  onSelect?: (id: string) => void
  onDelete?: (id: string) => void
  hasMore?: boolean
  onLoadMore?: () => void
}

export function SweepHistoryList({ entries, onSelect, onDelete, hasMore, onLoadMore }: Props) {
  if (entries.length === 0) {
    return (
      <div className="text-slate-500 text-xs text-center mt-6 px-3">
        No sweeps yet. Configure and launch your first sweep.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-px">
      {entries.map(entry => (
        <div
          key={entry.id}
          className="group flex items-start justify-between px-3 py-2 hover:bg-slate-800/60 cursor-pointer rounded-sm"
          onClick={() => onSelect?.(entry.id)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter') onSelect?.(entry.id) }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-medium text-slate-200 truncate">{entry.tradingPair}</span>
              {entry.status === 'cancelled' && (
                <span className="text-[9px] font-semibold px-1 py-px rounded bg-amber-900/60 text-amber-400 shrink-0">
                  (cancelled)
                </span>
              )}
              {entry.status === 'running' && (
                <span className="text-[9px] font-semibold px-1 py-px rounded bg-blue-900/60 text-blue-400 shrink-0">
                  running
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-slate-500">{entry.totalRuns} runs</span>
              <span className="text-[10px] text-slate-600">·</span>
              <span className={`text-[10px] font-medium ${entry.maxRoi != null ? (entry.maxRoi >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'}`}>
                {entry.maxRoi != null ? `${entry.maxRoi.toFixed(2)}% max ROI` : 'N/A'}
              </span>
            </div>
            <div className="text-[9px] text-slate-600 mt-0.5">
              {new Date(entry.createdAt).toLocaleDateString()}
            </div>
          </div>
          {onDelete && (
            <button
              className="ml-1 p-1 opacity-0 group-hover:opacity-100 hover:text-red-400 text-slate-600 transition-opacity shrink-0"
              onClick={e => { e.stopPropagation(); onDelete(entry.id) }}
              aria-label={`Delete sweep ${entry.id}`}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
      {hasMore && (
        <button
          onClick={onLoadMore}
          className="w-full py-1.5 text-[10px] text-slate-500 hover:text-slate-400 hover:bg-slate-800/40 rounded-sm transition-colors mt-1"
        >
          Load More
        </button>
      )}
    </div>
  )
}
