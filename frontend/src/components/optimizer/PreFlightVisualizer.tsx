/**
 * PreFlightVisualizer — Idle state right panel showing drawdown coverage zone.
 */
import React from 'react'
import type { SweepSummary } from '../../hooks/useOptimizer'

interface Props {
  sweepSummary: SweepSummary | null
}

export function PreFlightVisualizer({ sweepSummary }: Props) {
  if (!sweepSummary) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <div className="text-center space-y-3">
          <div className="text-4xl">📊</div>
          <p className="text-lg font-medium">Pre-Flight Analysis</p>
          <p className="text-sm">Configure parameters and launch a sweep to see risk analysis</p>
        </div>
      </div>
    )
  }

  const { minDrawdown, maxDrawdown, maxCapital } = sweepSummary
  const entryLine = 20           // Y position of entry price line (% from top)
  const chartHeight = 300
  const minY = entryLine + Math.abs(minDrawdown) * 2.5
  const maxY = entryLine + Math.abs(maxDrawdown) * 2.5

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 space-y-6">
      <h2 className="text-lg font-semibold text-slate-200">Pre-Flight Risk Analysis</h2>

      {/* SVG visualization */}
      <div className="relative w-full max-w-lg">
        <svg viewBox={`0 0 400 ${chartHeight}`} className="w-full" role="img">
          {/* Background */}
          <rect x="0" y="0" width="400" height={chartHeight} fill="#0f172a" rx="8" />

          {/* Entry price line */}
          <line x1="40" y1={entryLine * 3} x2="360" y2={entryLine * 3} stroke="#64748b" strokeWidth="1" strokeDasharray="4,4" />
          <text x="35" y={entryLine * 3 - 5} fill="#94a3b8" fontSize="10" textAnchor="end">Entry</text>

          {/* Drawdown zone gradient */}
          <defs>
            <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,165,0,0.15)" />
              <stop offset="100%" stopColor="rgba(255,0,0,0.25)" />
            </linearGradient>
          </defs>
          <rect
            x="40"
            y={Math.min(minY, maxY) * 3}
            width="320"
            height={Math.abs(maxY - minY) * 3 + 20}
            fill="url(#ddGrad)"
            rx="4"
          >
            <title>Drawdown zone: {minDrawdown}% to {maxDrawdown}%</title>
          </rect>

          {/* Min drawdown line */}
          <line x1="40" y1={minY * 3} x2="360" y2={minY * 3} stroke="#f59e0b" strokeWidth="1" />
          <text x="365" y={minY * 3 + 4} fill="#f59e0b" fontSize="9">{minDrawdown.toFixed(1)}%</text>

          {/* Max drawdown line */}
          <line x1="40" y1={maxY * 3} x2="360" y2={maxY * 3} stroke="#ef4444" strokeWidth="1" />
          <text x="365" y={maxY * 3 + 4} fill="#ef4444" fontSize="9">{maxDrawdown.toFixed(1)}%</text>
        </svg>
      </div>

      {/* Text readouts */}
      <div className="grid grid-cols-2 gap-4 w-full max-w-md">
        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
          <p className="text-xs text-slate-400 mb-1">Max Drawdown Covered</p>
          <p className="text-lg font-semibold text-amber-400">
            {minDrawdown.toFixed(2)}% to {maxDrawdown.toFixed(2)}%
          </p>
        </div>
        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
          <p className="text-xs text-slate-400 mb-1">Max Capital Required</p>
          <p className="text-lg font-semibold text-emerald-400">
            ${parseFloat(maxCapital).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>
    </div>
  )
}
