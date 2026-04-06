/**
 * QuantMatrix — Composes HeatmapGrid (when ≥2 swept vars) + LeaderboardGrid always.
 * Shows cancelled banner and "New Sweep" button when sweep is done/cancelled.
 */
import React from 'react'
import { HeatmapGrid } from './HeatmapGrid'
import { LeaderboardGrid } from './LeaderboardGrid'
import { BatchPromotionPanel } from './BatchPromotionPanel'
import type { EnrichedResult, SweepPhase, BatchPromotionStatus } from '../../hooks/useOptimizer'

interface Props {
  results: EnrichedResult[]
  sweptParams: string[]
  phase: SweepPhase
  totalRuns?: number
  onNewSweep: () => void
  onOpenInSingleRun?: (result: EnrichedResult) => void
  // 018: Selection & promotion
  selectedRunIds?: Set<string>
  onToggleRunSelection?: (runId: string) => void
  onSelectAll?: (runIds: string[]) => void
  onClearSelection?: () => void
  onBatchPromote?: () => void
  promotionStatus?: BatchPromotionStatus | null
  onCancelPromotion?: (sessionId: string) => void
  onDismissPromotion?: () => void
}

export function QuantMatrix({ results, sweptParams, phase, totalRuns, onNewSweep, onOpenInSingleRun, selectedRunIds, onToggleRunSelection, onSelectAll, onClearSelection, onBatchPromote, promotionStatus, onCancelPromotion, onDismissPromotion }: Props) {
  return (
    <div className="flex flex-col h-full">
      {/* Promotion panel */}
      {promotionStatus && onCancelPromotion && onDismissPromotion && (
        <BatchPromotionPanel
          status={promotionStatus}
          onCancel={onCancelPromotion}
          onDismiss={onDismissPromotion}
        />
      )}

      {/* Banner */}
      {phase === 'cancelled' && (
        <div role="status" className="mx-4 mt-3 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-400">
          Cancelled ({results.length} / {totalRuns ?? '?'} runs)
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Header + New Sweep */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">
            Results — {results.length} run{results.length !== 1 ? 's' : ''}
          </h2>
          <button
            onClick={onNewSweep}
            className="text-xs px-3 py-1 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded border border-blue-600/30"
          >
            New Sweep
          </button>
        </div>

        {/* Heatmap (only if ≥2 swept params and results exist) */}
        {sweptParams.length >= 2 && results.length > 0 && (
          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
            <p className="text-xs text-slate-500 font-medium mb-2 uppercase tracking-wider">Heatmap</p>
            <HeatmapGrid results={results} sweptParams={sweptParams} />
          </div>
        )}

        {/* Leaderboard always */}
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
          <p className="text-xs text-slate-500 font-medium mb-2 uppercase tracking-wider">Leaderboard</p>
          <LeaderboardGrid
            results={results}
            onOpenInSingleRun={onOpenInSingleRun}
            selectedRunIds={selectedRunIds}
            onToggleRunSelection={onToggleRunSelection}
            onSelectAll={onSelectAll}
            onClearSelection={onClearSelection}
            onBatchPromote={onBatchPromote}
          />
        </div>
      </div>
    </div>
  )
}
