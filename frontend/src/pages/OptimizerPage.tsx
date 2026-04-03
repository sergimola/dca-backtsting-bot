/**
 * OptimizerPage — Main page layout: left panel (configurator) + right panel
 * (phase-based: PreFlight idle → ExecutionDashboard running → QuantMatrix complete).
 */
import React, { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useOptimizer } from '../hooks/useOptimizer'
import type { BatchRunResult } from '../hooks/useOptimizer'
import { OptimizerConfigurator } from '../components/optimizer/OptimizerConfigurator'
import { PreFlightVisualizer } from '../components/optimizer/PreFlightVisualizer'
import { ExecutionDashboard } from '../components/optimizer/ExecutionDashboard'
import { QuantMatrix } from '../components/optimizer/QuantMatrix'

export function OptimizerPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const {
    formState,
    updateField,
    updateFormField,
    phase,
    sweepCounts,
    sweepSummary,
    session,
    enrichedResults,
    sweptParams,
    error,
    launch,
    cancel,
    resetPhase,
    selectHistorySweep,
    persistenceError,
    // 018: Selection & promotion
    selectedRunIds,
    toggleRunSelection,
    selectAllRuns,
    clearSelection,
    promotionStatus,
    startPromotion,
    cancelPromotion,
  } = useOptimizer()

  // T045: Load history session when ?session=<id> query param is present.
  useEffect(() => {
    const sessionId = searchParams.get('session')
    if (sessionId) {
      selectHistorySweep(sessionId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenInSingleRun = (result: BatchRunResult) => {
    // T068: Navigate to single-run view with config + enable_wide_events:true prefilled.
    navigate('/', { state: { prefillConfig: { ...result.config, enable_wide_events: true } } })
  }

  const renderRightPanel = () => {
    switch (phase) {
      case 'loading':
        return (
          <div className="flex flex-col h-full items-center justify-center gap-3 text-slate-400">
            <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs">Loading session…</span>
          </div>
        )

      case 'running':
        return session ? (
          <ExecutionDashboard session={session} onCancel={cancel} />
        ) : null

      case 'complete':
      case 'cancelled':
        return (
          <QuantMatrix
            results={enrichedResults}
            sweptParams={sweptParams}
            phase={phase}
            totalRuns={session?.totalRuns}
            onNewSweep={resetPhase}
            onOpenInSingleRun={handleOpenInSingleRun}
            selectedRunIds={selectedRunIds}
            onToggleRunSelection={toggleRunSelection}
            onSelectAll={selectAllRuns}
            onClearSelection={clearSelection}
            onBatchPromote={session ? () => startPromotion(session.sessionId, [...selectedRunIds]) : undefined}
            promotionStatus={promotionStatus}
            onCancelPromotion={cancelPromotion}
            onDismissPromotion={() => {}}
          />
        )

      case 'idle':
      case 'validating':
      default:
        return (
          <div className="flex flex-col h-full px-4 py-3 space-y-4">
            <h2 className="text-sm font-semibold text-slate-200">Pre-Flight Preview</h2>
            <PreFlightVisualizer sweepSummary={sweepSummary} />
            {error && (
              <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                {error}
              </div>
            )}
            {phase === 'validating' && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                Validating sweep configuration...
              </div>
            )}
          </div>
        )
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* T060: Persistence error banner */}
      {persistenceError && (
        <div role="alert" className="px-4 py-2 bg-amber-900/60 border-b border-amber-600 text-amber-300 text-xs">
          Warning: Database connection lost. Results are in-memory and will be lost on refresh. Export your results to CSV immediately.
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — Configurator (25% width) */}
        <div className="w-80 flex-shrink-0 border-r border-slate-700 bg-[#0a0e1a]">
          <OptimizerConfigurator
            formState={formState}
            sweepCounts={sweepCounts}
            onUpdateField={updateField}
            onUpdateFormField={updateFormField}
            onLaunch={launch}
            isLaunching={phase === 'validating'}
          />
        </div>

        {/* Right panel — Phase-dependent content */}
        <div className="flex-1 overflow-hidden">
          {renderRightPanel()}
        </div>
      </div>
    </div>
  )
}
