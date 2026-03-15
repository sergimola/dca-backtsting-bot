import React, { useState } from 'react'
import type { BacktestFormState, BacktestResults, Run } from './services/types'
import { submitBacktest } from './services/backtest-api'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LeftSidebar } from './components/LeftSidebar'
import { ConfigFormView } from './components/ConfigFormView'
import { LiveTerminalView } from './components/LiveTerminalView'
import { DashboardView } from './components/DashboardView'
import { RunPollingController } from './components/RunPollingController'

export default function App() {
  const [runs, setRuns] = useState<Run[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<'history' | 'config'>('config')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ── State mutators ────────────────────────────────────────────────────────

  const handleNewBacktest = () => {
    setActiveView('config')
    setSelectedRunId(null)
    setSubmitError(null)
  }

  const handleSubmit = async (config: BacktestFormState) => {
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const { backtestId } = await submitBacktest(config)
      const shortId = backtestId.slice(0, 8)
      const newRun: Run = {
        backtestId,
        shortId,
        status: 'running',
        config,
        logs: [],
        progress: 0,
        createdAt: new Date().toISOString(),
      }
      setRuns(prev => [newRun, ...prev])
      setSelectedRunId(backtestId)
      setActiveView('history')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit backtest')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRunComplete = (backtestId: string, results: BacktestResults) => {
    setRuns(prev =>
      prev.map(r =>
        r.backtestId === backtestId
          ? { ...r, status: 'completed' as const, results, progress: 100 }
          : r
      )
    )
  }

  const handleRunFail = (backtestId: string, errorMsg: string) => {
    setRuns(prev =>
      prev.map(r =>
        r.backtestId === backtestId
          ? { ...r, status: 'failed' as const, logs: [...r.logs, errorMsg] }
          : r
      )
    )
  }

  const handleLogsUpdate = (backtestId: string, newLog: string) => {
    setRuns(prev =>
      prev.map(r =>
        r.backtestId === backtestId ? { ...r, logs: [...r.logs, newLog] } : r
      )
    )
  }

  const handleProgressUpdate = (backtestId: string, progress: number) => {
    setRuns(prev =>
      prev.map(r =>
        r.backtestId === backtestId ? { ...r, progress } : r
      )
    )
  }

  const handleSelectRun = (backtestId: string) => {
    setSelectedRunId(backtestId)
    setActiveView('history')
  }

  const handleViewDashboard = (backtestId: string) => {
    setSelectedRunId(backtestId)
    setActiveView('history')
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const selectedRun = runs.find(r => r.backtestId === selectedRunId) ?? null

  const renderMainPane = () => {
    if (activeView === 'config') {
      return (
        <ConfigFormView
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          error={submitError}
        />
      )
    }
    if (!selectedRun) {
      return (
        <ConfigFormView
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          error={submitError}
        />
      )
    }
    if (selectedRun.status === 'running' || selectedRun.status === 'failed') {
      return <LiveTerminalView run={selectedRun} />
    }
    return <DashboardView run={selectedRun} />
  }

  return (
    <ErrorBoundary>
      {/* Invisible polling controllers — one per running run */}
      {runs.filter(r => r.status === 'running').map(r => (
        <RunPollingController
          key={r.backtestId}
          backtestId={r.backtestId}
          onComplete={handleRunComplete}
          onFail={handleRunFail}
          onLogsUpdate={handleLogsUpdate}
          onProgressUpdate={handleProgressUpdate}
        />
      ))}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
        @keyframes shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>

      <div className="h-screen overflow-hidden bg-[#050810] text-slate-200 font-sans flex">
        <LeftSidebar
          runs={runs}
          selectedRunId={selectedRunId}
          onNewBacktest={handleNewBacktest}
          onSelectRun={handleSelectRun}
          onViewDashboard={handleViewDashboard}
        />

        <main className="flex-1 overflow-y-auto custom-scrollbar">
          {renderMainPane()}
        </main>
      </div>
    </ErrorBoundary>
  )
}

