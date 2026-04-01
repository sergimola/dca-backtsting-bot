/**
 * OptimizerPage — Main page layout: left panel (configurator) + right panel
 * (phase-based: PreFlight idle → ExecutionDashboard running → QuantMatrix complete).
 */
import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useOptimizer } from '../hooks/useOptimizer'
import type { BatchRunResult } from '../hooks/useOptimizer'
import { OptimizerConfigurator } from '../components/optimizer/OptimizerConfigurator'
import { PreFlightVisualizer } from '../components/optimizer/PreFlightVisualizer'
import { ExecutionDashboard } from '../components/optimizer/ExecutionDashboard'
import { QuantMatrix } from '../components/optimizer/QuantMatrix'

export function OptimizerPage() {
  const navigate = useNavigate()
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
  } = useOptimizer()

  const handleOpenInSingleRun = (result: BatchRunResult) => {
    navigate('/', { state: { prefillConfig: result } })
  }

  const renderRightPanel = () => {
    switch (phase) {
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
            onNewSweep={resetPhase}
            onOpenInSingleRun={handleOpenInSingleRun}
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
    <div className="flex h-full">
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
  )
}
