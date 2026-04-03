/**
 * LeaderboardGrid — Sortable results table for optimizer sweep results.
 * Shows swept parameter columns highlighted, with row actions.
 * 018: Added checkbox selection, promoted badges, bulk action toolbar.
 */
import React, { useState, useMemo, useEffect } from 'react'
import type { BatchRunResult } from '../../hooks/useOptimizer'
import { msDuration } from '../../services/formatters'

interface Props {
  results: BatchRunResult[]
  onOpenInSingleRun?: (result: BatchRunResult) => void
  selectedRunIds?: Set<string>
  onToggleRunSelection?: (runId: string) => void
  onSelectAll?: (runIds: string[]) => void
  onClearSelection?: () => void
  onBatchPromote?: () => void
}

type SortKey = 'run_id' | 'roi' | 'maxDrawdown' | 'totalFees' | 'executionTimeMs' | 'longestTrade' | 'maxSOs'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 200

export function LeaderboardGrid({
  results,
  onOpenInSingleRun,
  selectedRunIds,
  onToggleRunSelection,
  onSelectAll,
  onClearSelection,
  onBatchPromote,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('roi')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)

  // Reset to page 1 whenever sort order changes
  useEffect(() => { setPage(1) }, [sortKey, sortDir])

  const sorted = useMemo(() => {
    return [...results].sort((a, b) => {
      let av = 0, bv = 0
      switch (sortKey) {
        case 'roi':
          av = a.pnlSummary?.roi ?? 0; bv = b.pnlSummary?.roi ?? 0; break
        case 'maxDrawdown':
          av = a.pnlSummary?.maxDrawdown ?? 0; bv = b.pnlSummary?.maxDrawdown ?? 0; break
        case 'totalFees':
          av = a.pnlSummary?.totalFees ?? 0; bv = b.pnlSummary?.totalFees ?? 0; break
        case 'executionTimeMs':
          av = a.executionTimeMs ?? 0; bv = b.executionTimeMs ?? 0; break
        case 'longestTrade':
          av = a.longest_trade_duration_ms ?? 0; bv = b.longest_trade_duration_ms ?? 0; break
        case 'maxSOs':
          av = a.max_safety_orders_used ?? 0; bv = b.max_safety_orders_used ?? 0; break
        default:
          return a.run_id.localeCompare(b.run_id) * (sortDir === 'asc' ? 1 : -1)
      }
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [results, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const paginated = useMemo(
    () => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sorted, page]
  )

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const exportCSV = () => {
    const headers = ['run_id', 'type', 'roi', 'maxDrawdown', 'totalFees', 'executionTimeMs', 'candleCount']
    const rows = results.map(r => [
      r.run_id,
      r.type,
      r.pnlSummary?.roi ?? '',
      r.pnlSummary?.maxDrawdown ?? '',
      r.pnlSummary?.totalFees ?? '',
      r.executionTimeMs ?? '',
      r.candleCount ?? '',
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'optimizer-results.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const sortIcon = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const selectionCount = selectedRunIds?.size ?? 0
  const allVisibleIds = sorted.filter(r => r.type !== 'error').map(r => r.run_id)
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => selectedRunIds?.has(id))

  const handleSelectAllToggle = () => {
    if (allSelected) {
      onClearSelection?.()
    } else {
      onSelectAll?.(allVisibleIds)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center px-4 py-2 border-b border-slate-700">
        <span className="text-sm text-slate-400">{results.length} results</span>
        <div className="flex items-center gap-2">
          {selectionCount > 0 && (
            <>
              <span className="text-sm text-blue-400">{selectionCount} selected</span>
              <button
                onClick={onBatchPromote}
                className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white font-medium"
              >
                Batch Promote to ClickHouse
              </button>
              <button
                onClick={onClearSelection}
                className="text-xs px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
              >
                Clear
              </button>
            </>
          )}
          <button
            onClick={exportCSV}
            className="text-xs px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
          >
            Export CSV
          </button>
        </div>
      </div>
      <div className="overflow-auto flex-1">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 sticky top-0">
            <tr>
              {onToggleRunSelection && (
                <th className="px-2 py-2 text-center w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={handleSelectAllToggle}
                    className="rounded border-slate-500"
                  />
                </th>
              )}
              <th className="px-3 py-2 text-left cursor-pointer" onClick={() => toggleSort('run_id')}>
                Run ID{sortIcon('run_id')}
              </th>
              <th className="px-3 py-2 text-right cursor-pointer" onClick={() => toggleSort('roi')}>
                ROI %{sortIcon('roi')}
              </th>
              <th className="px-3 py-2 text-right cursor-pointer" onClick={() => toggleSort('maxDrawdown')}>
                Max DD %{sortIcon('maxDrawdown')}
              </th>
              <th className="px-3 py-2 text-right cursor-pointer" onClick={() => toggleSort('totalFees')}>
                Fees{sortIcon('totalFees')}
              </th>
              <th className="px-3 py-2 text-right cursor-pointer" onClick={() => toggleSort('executionTimeMs')}>
                Time (ms){sortIcon('executionTimeMs')}
              </th>
              <th className="px-3 py-2 text-right cursor-pointer" onClick={() => toggleSort('longestTrade')}>
                Longest Trade{sortIcon('longestTrade')}
              </th>
              <th className="px-3 py-2 text-right cursor-pointer" onClick={() => toggleSort('maxSOs')}>
                Max SOs Used{sortIcon('maxSOs')}
              </th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(r => (
              <tr
                key={r.run_id}
                className={`border-b border-slate-800 hover:bg-slate-800/50 ${
                  r.type === 'error' ? 'bg-red-900/20' : ''
                } ${selectedRunIds?.has(r.run_id) ? 'bg-blue-900/20' : ''}`}
              >
                {onToggleRunSelection && (
                  <td className="px-2 py-2 text-center">
                    {r.type !== 'error' && (
                      <input
                        type="checkbox"
                        checked={selectedRunIds?.has(r.run_id) ?? false}
                        onChange={() => onToggleRunSelection(r.run_id)}
                        className="rounded border-slate-500"
                      />
                    )}
                  </td>
                )}
                <td className="px-3 py-2 font-mono text-xs">{r.run_id.slice(0, 8)}</td>
                <td className="px-3 py-2 text-right">
                  {r.type === 'error'
                    ? <span className="text-red-400">Error</span>
                    : <span className={
                        (r.pnlSummary?.roi ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }>
                        {r.pnlSummary?.roi?.toFixed(2) ?? '-'}%
                      </span>
                  }
                </td>
                <td className="px-3 py-2 text-right text-amber-400">
                  {r.pnlSummary?.maxDrawdown?.toFixed(2) ?? '-'}%
                </td>
                <td className="px-3 py-2 text-right text-slate-400">
                  ${r.pnlSummary?.totalFees?.toFixed(2) ?? '-'}
                </td>
                <td className="px-3 py-2 text-right text-slate-400">
                  {r.executionTimeMs ?? '-'}
                </td>
                <td className="px-3 py-2 text-right text-slate-400">
                  {msDuration(r.longest_trade_duration_ms ?? 0)}
                </td>
                <td className="px-3 py-2 text-right text-slate-400">
                  {r.max_safety_orders_used ?? 0}
                </td>
                <td className="px-3 py-2 text-center">
                  {r.promoted_at ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-900/40 text-emerald-300">
                      ↑ CH
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-center">
                  {r.type !== 'error' && onOpenInSingleRun && (
                    <button
                      onClick={() => onOpenInSingleRun(r)}
                      className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap"
                    >
                      Re-run with Details
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-700 shrink-0">
          <span className="text-xs text-slate-500">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-slate-300"
            >
              ← Prev
            </button>
            <span className="text-xs text-slate-400">{page} / {totalPages}</span>
            <button
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
              className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-slate-300"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
