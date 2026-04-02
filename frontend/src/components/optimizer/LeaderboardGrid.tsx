/**
 * LeaderboardGrid — Sortable results table for optimizer sweep results.
 * Shows swept parameter columns highlighted, with row actions.
 */
import React, { useState, useMemo } from 'react'
import type { BatchRunResult } from '../../hooks/useOptimizer'

interface Props {
  results: BatchRunResult[]
  onOpenInSingleRun?: (result: BatchRunResult) => void
}

type SortKey = 'run_id' | 'roi' | 'maxDrawdown' | 'totalFees' | 'executionTimeMs'
type SortDir = 'asc' | 'desc'

export function LeaderboardGrid({ results, onOpenInSingleRun }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('roi')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

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
        default:
          return a.run_id.localeCompare(b.run_id) * (sortDir === 'asc' ? 1 : -1)
      }
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [results, sortKey, sortDir])

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

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center px-4 py-2 border-b border-slate-700">
        <span className="text-sm text-slate-400">{results.length} results</span>
        <button
          onClick={exportCSV}
          className="text-xs px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
        >
          Export CSV
        </button>
      </div>
      <div className="overflow-auto flex-1">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 sticky top-0">
            <tr>
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
              <th className="px-3 py-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr
                key={r.run_id}
                className={`border-b border-slate-800 hover:bg-slate-800/50 ${
                  r.type === 'error' ? 'bg-red-900/20' : ''
                }`}
              >
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
    </div>
  )
}
