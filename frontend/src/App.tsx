import React, { useState, useEffect, useCallback } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import type { BacktestFormState, BacktestResults, Run } from './services/types'
import { submitBacktest, listBacktests, getResults } from './services/backtest-api'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LeftSidebar } from './components/LeftSidebar'
import type { SweepHistoryEntry } from './components/optimizer/SweepHistoryList'
import { ConfigFormView } from './components/ConfigFormView'
import { LiveTerminalView } from './components/LiveTerminalView'
import { DashboardView } from './components/DashboardView'
import { RunPollingController } from './components/RunPollingController'
import { OptimizerPage } from './pages/OptimizerPage'

const API_BASE = String(import.meta.env['VITE_API_URL'] || 'http://localhost:4000').trim()

export default function App() {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<Run[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<'history' | 'config'>('config')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // T072: Sweep history state at App level so LeftSidebar has access.
  const [sweepHistory, setSweepHistory] = useState<SweepHistoryEntry[]>([])
  const [hasMoreSweeps, setHasMoreSweeps] = useState(false)
  const [sweepHistoryPage, setSweepHistoryPage] = useState(1)

  const loadSweepHistory = useCallback(async (page = 1) => {
    try {
      const res = await fetch(`${API_BASE}/optimizer/sessions?page=${page}&limit=50`)
      if (!res.ok) return
      const data = await res.json()
      const entries: SweepHistoryEntry[] = (data.sessions ?? []).map((s: Record<string, unknown>) => ({
        id: String(s['id'] ?? ''),
        tradingPair: String(s['tradingPair'] ?? s['trading_pair'] ?? ''),
        startDate: String(s['startDate'] ?? s['start_date'] ?? ''),
        endDate: String(s['endDate'] ?? s['end_date'] ?? ''),
        totalRuns: Number(s['totalRuns'] ?? s['total_runs'] ?? 0),
        maxRoi: s['maxRoi'] != null ? Number(s['maxRoi']) : s['max_roi'] != null ? Number(s['max_roi']) : null,
        status: (s['status'] as 'completed' | 'cancelled' | 'running'),
        createdAt: String(s['createdAt'] ?? s['created_at'] ?? ''),
      }))
      if (page === 1) setSweepHistory(entries)
      else setSweepHistory(prev => [...prev, ...entries])
      setHasMoreSweeps(Boolean(data.hasMore))
      setSweepHistoryPage(page)
    } catch { /* silently ignore on startup */ }
  }, [])

  const handleLoadMoreSweeps = useCallback(() => loadSweepHistory(sweepHistoryPage + 1), [loadSweepHistory, sweepHistoryPage])

  const handleDeleteSweep = useCallback(async (id: string) => {
    try {
      await fetch(`${API_BASE}/optimizer/session/${id}`, { method: 'DELETE' })
      setSweepHistory(prev => prev.filter(e => e.id !== id))
    } catch { /* best effort */ }
  }, [])

  const handleSelectSweep = useCallback((id: string) => {
    navigate(`/optimizer?session=${id}`)
  }, [navigate])

  // Load existing backtests from server on mount
  useEffect(() => {
    listBacktests()
      .then(loaded => {
        if (loaded.length > 0) setRuns(loaded)
      })
      .catch(() => { /* silently ignore network errors on startup */ })
  }, [])

  // T072: Load sweep history on mount.
  useEffect(() => { loadSweepHistory(1) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-fetch full results when a completed run with no trade events is selected
  useEffect(() => {
    if (!selectedRunId) return
    const run = runs.find(r => r.backtestId === selectedRunId)
    if (!run || run.status !== 'completed') return
    if ((run.results?.tradeEvents?.length ?? 0) > 0) return
    getResults(selectedRunId)
      .then(results => {
        setRuns(prev =>
          prev.map(r => r.backtestId === selectedRunId ? { ...r, results } : r)
        )
      })
      .catch(() => { /* silently ignore fetch errors */ })
  }, [selectedRunId])

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
          sweepHistory={sweepHistory}
          onSelectSweep={handleSelectSweep}
          onLoadMoreSweeps={handleLoadMoreSweeps}
          hasMoreSweeps={hasMoreSweeps}
          onDeleteSweep={handleDeleteSweep}
        />

        <main className="flex-1 overflow-y-auto custom-scrollbar">
          <Routes>
            <Route path="/optimizer" element={<OptimizerPage />} />
            <Route path="*" element={renderMainPane()} />
          </Routes>
        </main>
      </div>
    </ErrorBoundary>
  )
}

