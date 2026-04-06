/**
 * useOptimizer — State machine hook for the Optimizer Workspace.
 *
 * Manages: formState, phase transitions, sweep launch/cancel, SSE streaming,
 *          combinatorial count debounce, and Pre-Flight summary.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export type SweepPhase = 'idle' | 'validating' | 'loading' | 'running' | 'complete' | 'cancelled' | 'partial'

export interface ParameterField {
  name: string
  label: string
  mode: 'fixed' | 'sweep'
  fixedValue: string
  listInput: string        // comma-separated sweep values
  range: { start: string; end: string; step: string }
}

export interface OptimizerFormState {
  symbol: string
  startDate: string
  endDate: string
  accountBalance: string
  parameters: ParameterField[]
  stop_loss_enabled: boolean
  stop_loss_baseline: 'first_entry' | 'average_entries'
  marginType: 'cross' | 'isolated'
}

export interface PruneBreakdown {
  capital_exceeds_balance: number
  base_order_below_minimum: number
  guaranteed_fee_loss: number
  exceeds_100_percent_drawdown: number
  tick_size_violation: number
}

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

export interface SweepCounts {
  count: number
  overLimit: boolean
  generated?: number
  pruned?: number
  valid?: number
  pruneReasons?: PruneBreakdown
}

export interface BatchRunResult {
  run_id: string
  type: 'result' | 'error'
  error?: string
  pnlSummary?: { roi: number; maxDrawdown: number; totalFees: number; winRate?: number; annualizedReturn?: number | null }
  executionTimeMs?: number
  candleCount?: number
  eventCount?: number
  longest_trade_duration_ms?: number
  max_safety_orders_used?: number
  total_stops_triggered?: number
  total_take_profits?: number
  promoted_at?: string | null
}

export interface SweepSummary {
  minDrawdown: number
  maxDrawdown: number
  maxCapital: string
}

export interface OptimizerSession {
  sessionId: string
  results: BatchRunResult[]
  totalRuns: number
}

/** BatchRunResult enriched with original config params for heatmap/leaderboard display. */
export interface EnrichedResult extends BatchRunResult {
  config: Record<string, string | number>
}

export interface BatchPromotionStatus {
  session_id: string
  total: number
  completed: number
  failed: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  errors: Array<{ run_id: string; error: string }>
}

const ENV_API_BASE = String(import.meta.env.VITE_API_URL || '').trim()
const DEFAULT_API_BASES = [
  ENV_API_BASE,
  'http://localhost:4000',
  'http://localhost:3000',
].filter(Boolean)

const DEFAULT_PARAMS: ParameterField[] = [
  { name: 'price_entry', label: 'Price Entry (%)', mode: 'fixed', fixedValue: '2.0', listInput: '', range: { start: '', end: '', step: '' } },
  { name: 'price_scale', label: 'Price Scale', mode: 'fixed', fixedValue: '1.1', listInput: '', range: { start: '', end: '', step: '' } },
  { name: 'amount_scale', label: 'Amount Scale', mode: 'fixed', fixedValue: '2.0', listInput: '', range: { start: '', end: '', step: '' } },
  { name: 'amount_per_trade', label: 'Amount Per Trade', mode: 'fixed', fixedValue: '1000', listInput: '', range: { start: '', end: '', step: '' } },
  { name: 'monthly_addition', label: 'Monthly Addition', mode: 'fixed', fixedValue: '0', listInput: '', range: { start: '', end: '', step: '' } },
  { name: 'number_of_orders', label: 'Number of Orders', mode: 'fixed', fixedValue: '10', listInput: '', range: { start: '', end: '', step: '' } },
  { name: 'take_profit_distance_percent', label: 'Take Profit (%)', mode: 'fixed', fixedValue: '0.5', listInput: '', range: { start: '', end: '', step: '' } },
  { name: 'multiplier', label: 'Multiplier', mode: 'fixed', fixedValue: '1', listInput: '', range: { start: '', end: '', step: '' } },
  { name: 'stop_loss_percent', label: 'Stop Loss (%)', mode: 'fixed', fixedValue: '5', listInput: '', range: { start: '', end: '', step: '' } },
  { name: 'stop_loss_timeout_minutes', label: 'SL Timeout (min)', mode: 'fixed', fixedValue: '0', listInput: '', range: { start: '', end: '', step: '' } },
]

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useOptimizer() {
  const [apiBase, setApiBase] = useState<string>(DEFAULT_API_BASES[0] || 'http://localhost:4000')

  const [formState, setFormState] = useState<OptimizerFormState>({
    symbol: 'BTC/USDC',
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-01-31T00:00:00Z',
    accountBalance: '10000',
    parameters: DEFAULT_PARAMS,
    stop_loss_enabled: false,
    stop_loss_baseline: 'average_entries',
    marginType: 'isolated',
  })

  const [phase, setPhase] = useState<SweepPhase>('idle')
  const [sweepCounts, setSweepCounts] = useState<SweepCounts | null>(null)
  const [sweepSummary, setSweepSummary] = useState<SweepSummary | null>(null)
  const [session, setSession] = useState<OptimizerSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [configMap, setConfigMap] = useState<Map<string, Record<string, string | number>>>(new Map())
  // T059: persistence error flag
  const [persistenceError, setPersistenceError] = useState(false)

  // 018: Row selection state for batch promotion
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set())
  // Swept params inferred from history load (empty = derive from formState)
  const [inferredSweptParams, setInferredSweptParams] = useState<string[]>([])

  // 018: Promotion status
  const [promotionStatus, setPromotionStatus] = useState<BatchPromotionStatus | null>(null)

  // T044: Sweep history state.
  const [sweepHistory, setSweepHistory] = useState<SweepHistoryEntry[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // T055: throttle result rendering
  const resultBufferRef = useRef<BatchRunResult[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // T057: independent completed count ref (no re-render)
  const completedCountRef = useRef(0)

  const fetchOptimizer = useCallback(async (path: string, init?: RequestInit): Promise<Response> => {
    const candidates = [apiBase, ...DEFAULT_API_BASES.filter(base => base !== apiBase)]
    let lastError: unknown

    for (const base of candidates) {
      try {
        const response = await fetch(`${base}${path}`, init)
        if (base !== apiBase && response.ok) {
          setApiBase(base)
        }
        return response
      } catch (err) {
        lastError = err
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Optimizer API unreachable')
  }, [apiBase])

  // T056: 250ms flush interval — batch buffer into state only when running
  useEffect(() => {
    if (phase !== 'running') {
      if (flushTimerRef.current != null) {
        clearInterval(flushTimerRef.current)
        flushTimerRef.current = null
      }
      // Final flush: drain any remaining buffer when sweep ends/cancels.
      const remaining = resultBufferRef.current.splice(0)
      if (remaining.length > 0) {
        setSession(prev => prev ? { ...prev, results: [...prev.results, ...remaining] } : prev)
      }
      return
    }
    flushTimerRef.current = setInterval(() => {
      const buffered = resultBufferRef.current.splice(0)
      if (buffered.length > 0) {
        setSession(prev => prev ? { ...prev, results: [...prev.results, ...buffered] } : prev)
      }
    }, 250)
    return () => {
      if (flushTimerRef.current != null) {
        clearInterval(flushTimerRef.current)
        flushTimerRef.current = null
      }
    }
  }, [phase])

  // ── beforeunload warning when sweep is running ────────────────────────────
  useEffect(() => {
    if (phase !== 'running') return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [phase])

  // T044: Load sweep history on mount.
  const loadHistory = useCallback(async (page = 1) => {
    try {
      const res = await fetchOptimizer(`/optimizer/sessions?page=${page}&limit=50`)
      if (!res.ok) return
      const data = await res.json()
      const entries: SweepHistoryEntry[] = (data.sessions ?? []).map((s: any) => ({
        id: s.id,
        tradingPair: s.tradingPair ?? s.trading_pair,
        startDate: s.startDate ?? s.start_date,
        endDate: s.endDate ?? s.end_date,
        totalRuns: s.totalRuns ?? s.total_runs ?? 0,
        maxRoi: s.maxRoi ?? s.max_roi ?? null,
        status: s.status,
        createdAt: s.createdAt ?? s.created_at,
      }))
      if (page === 1) {
        setSweepHistory(entries)
      } else {
        setSweepHistory(prev => [...prev, ...entries])
      }
      setHasMoreHistory(Boolean(data.hasMore))
      setHistoryPage(page)
    } catch { /* silently ignore */ }
  }, [fetchOptimizer])

  useEffect(() => { loadHistory(1) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMoreHistory = useCallback(() => loadHistory(historyPage + 1), [loadHistory, historyPage])

  // T045: Select a past sweep — load its run summaries and show Quant Matrix.
  const selectHistorySweep = useCallback(async (id: string) => {
    setPhase('loading')
    try {
      const res = await fetchOptimizer(`/optimizer/sessions/${id}/results`)
      if (!res.ok) { setPhase('idle'); return }
      const data = await res.json()
      const results: BatchRunResult[] = (data.results ?? []).map((r: any) => ({
        run_id: r.runId ?? r.run_id,
        type: 'result' as const,
        pnlSummary: {
          roi: parseFloat(r.roi ?? '0'),
          maxDrawdown: parseFloat(r.maxDrawdown ?? r.max_drawdown ?? '0'),
          totalFees: parseFloat(r.totalFees ?? r.total_fees ?? '0'),
          annualizedReturn: r.annualizedReturn != null ? parseFloat(r.annualizedReturn)
            : (r.annualized_return != null ? parseFloat(r.annualized_return) : null),
        },
        winRate: r.winRate ?? r.win_rate,
        totalPositionsClosed: r.totalPositionsClosed ?? 0,
        executionTimeMs: r.executionTimeMs ?? r.execution_time_ms ?? 0,
        longest_trade_duration_ms: r.longestTradeDurationMs ?? r.longest_trade_duration_ms ?? 0,
        max_safety_orders_used: r.maxSafetyOrdersUsed ?? r.max_safety_orders_used ?? 0,
        promoted_at: r.promotedAt ?? r.promoted_at ?? null,
      }))

      // Rebuild configMap from persisted configJson so EnrichedResult has config data
      const cfgMap = new Map<string, Record<string, string | number>>()
      for (const r of data.results ?? []) {
        const runId = r.runId ?? r.run_id
        if (r.configJson && typeof r.configJson === 'object') {
          cfgMap.set(runId, r.configJson as Record<string, string | number>)
        }
      }
      setConfigMap(cfgMap)

      // Infer swept params: params whose values vary across configs
      const SWEEP_CANDIDATES = [
        'price_entry', 'price_scale', 'amount_scale', 'number_of_orders',
        'amount_per_trade', 'multiplier', 'take_profit_distance_percent', 'monthly_addition',
      ]
      const allConfigs = Array.from(cfgMap.values())
      const inferred = allConfigs.length >= 2
        ? SWEEP_CANDIDATES.filter(p => {
            const vals = new Set(allConfigs.map(c => String(c[p] ?? '')))
            return vals.size > 1
          })
        : []
      setInferredSweptParams(inferred)

      const loadedSession: OptimizerSession = {
        sessionId: id,
        results,
        totalRuns: results.length,
      }
      setSession(loadedSession)
      setPhase('complete')
    } catch { setPhase('idle') }
  }, [fetchOptimizer])

  // ── Field update + debounced count ────────────────────────────────────────

  const updateField = useCallback((name: string, patch: Partial<ParameterField>) => {
    setFormState(prev => ({
      ...prev,
      parameters: prev.parameters.map(p =>
        p.name === name ? { ...p, ...patch } : p
      ),
    }))
  }, [])

  const updateFormField = useCallback((field: string, value: string | boolean) => {
    setFormState(prev => ({ ...prev, [field]: value }))
  }, [])

  // Debounced count fetch.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const slNames = ['stop_loss_percent', 'stop_loss_timeout_minutes']
        const params = formState.parameters
          .filter(p => formState.stop_loss_enabled || !slNames.includes(p.name))
          .map(p => ({
          name: p.name,
          mode: p.mode,
          fixedValue: p.fixedValue,
          values: p.mode === 'sweep' && p.listInput
            ? p.listInput.split(',').map(v => v.trim()).filter(Boolean)
            : undefined,
          range: p.mode === 'sweep' && p.range.start
            ? p.range
            : undefined,
        }))
        const res = await fetchOptimizer('/optimizer/sweep/count', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parameters: params }),
        })
        const data = await res.json()
        const normalizedCount = Number(data?.count ?? 0)
        setSweepCounts({
          count: normalizedCount,
          overLimit: Boolean(data?.overLimit),
          generated: Number(data?.generated ?? normalizedCount),
          pruned: Number(data?.pruned ?? 0),
          valid: Number(data?.valid ?? normalizedCount),
        })
      } catch {
        // Silently ignore count errors.
      }
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [formState.parameters, fetchOptimizer])

  // ── Launch ────────────────────────────────────────────────────────────────

  const launch = useCallback(async () => {
    setPhase('validating')
    setError(null)
    setInferredSweptParams([])

    try {
      const slParamNames = ['stop_loss_percent', 'stop_loss_timeout_minutes']
      const params = formState.parameters
        .filter(p => formState.stop_loss_enabled || !slParamNames.includes(p.name))
        .map(p => ({
        name: p.name,
        mode: p.mode,
        fixedValue: p.fixedValue,
        values: p.mode === 'sweep' && p.listInput
          ? p.listInput.split(',').map(v => v.trim()).filter(Boolean)
          : undefined,
        range: p.mode === 'sweep' && p.range.start ? p.range : undefined,
      }))

      const sweepDef = {
        symbol: formState.symbol,
        startDate: formState.startDate,
        endDate: formState.endDate,
        accountBalance: formState.accountBalance,
        parameters: params,
        fixedParams: {
          trading_pair: formState.symbol,
          start_date: formState.startDate,
          end_date: formState.endDate,
          margin_type: formState.marginType,
          exit_on_last_order: false,
          stop_loss_enabled: formState.stop_loss_enabled,
          stop_loss_baseline: formState.stop_loss_baseline,
          // Server-side .env is the source of truth for infrastructure credentials.
          clickhouse_addr: '',
          clickhouse_db: '',
          clickhouse_user: '',
          clickhouse_password: '',
        },
      }

      // POST /optimizer/sweep
      const sweepRes = await fetchOptimizer('/optimizer/sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sweepDef),
      })

      if (!sweepRes.ok) {
        const err = await sweepRes.json()
        throw new Error(err.error || `Sweep failed: ${sweepRes.status}`)
      }

      const sweepData = await sweepRes.json()
      const { sessionId, pruningResult, preFlightSummary, validConfigs } = sweepData

      // Build run_id → config map for enriching results
      const cfgMap = new Map<string, Record<string, string | number>>()
      if (Array.isArray(validConfigs)) {
        for (const cfg of validConfigs) {
          cfgMap.set(cfg.run_id, cfg)
        }
      }
      setConfigMap(cfgMap)

      setSweepSummary(preFlightSummary)
      setSweepCounts({
        count: pruningResult.generated,
        overLimit: false,
        generated: pruningResult.generated,
        pruned: pruningResult.pruned,
        valid: pruningResult.valid,
        pruneReasons: pruningResult.pruneReasons,
      })

      if (Number(pruningResult.valid ?? 0) <= 0) {
        setSession(null)
        setPhase('idle')
        setError(
          'No valid runs after pre-flight pruning. Base order may be below $10 or required capital may exceed account balance.'
        )
        return
      }

      const newSession: OptimizerSession = {
        sessionId,
        results: [],
        totalRuns: pruningResult.valid,
      }
      setSession(newSession)
      setPhase('running')

      // POST /optimizer/session/:sessionId/execute — SSE stream
      const abortController = new AbortController()
      abortRef.current = abortController

      const execRes = await fetchOptimizer(
        `/optimizer/session/${sessionId}/execute`,
        { method: 'POST', signal: abortController.signal }
      )

      if (!execRes.ok || !execRes.body) {
        throw new Error('Execute stream failed')
      }

      const reader = execRes.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const json = line.slice(6).trim()
          if (!json) continue

          try {
            const event: Record<string, unknown> = JSON.parse(json)
            if (event.type === 'complete') {
              setPhase('complete')
              break
            }
            if (event.type === 'persistence_error') {
              // T059: DB layer dropped — results are in-memory only
              setPersistenceError(true)
            }
            if (event.type === 'result' || event.type === 'error') {
              // T055: push to buffer; flush interval handles setSession
              resultBufferRef.current.push(event as unknown as BatchRunResult)
              // T057: increment independent counter
              completedCountRef.current += 1
            }
          } catch { /* skip malformed lines */ }
        }
      }

      setPhase(prev => prev === 'running' ? 'complete' : prev)
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setPhase('cancelled')
      } else {
        setError(err.message)
        setPhase('idle')
      }
    }
  }, [formState, fetchOptimizer])

  // ── Cancel ────────────────────────────────────────────────────────────────

  const cancel = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    if (session) {
      try {
        await fetchOptimizer(`/optimizer/session/${session.sessionId}`, {
          method: 'DELETE',
        })
      } catch { /* best effort */ }
    }
    setPhase('cancelled')
  }, [session, fetchOptimizer])

  // ── Reset ─────────────────────────────────────────────────────────────────

  const resetPhase = useCallback(() => {
    setPhase('idle')
    setSession(null)
    setSweepSummary(null)
    setConfigMap(new Map())
    setError(null)
    setInferredSweptParams([])
  }, [])

  // ── Derived values ────────────────────────────────────────────────────────

  const enrichedResults: EnrichedResult[] = useMemo(
    () => (session?.results ?? []).map(r => ({
      ...r,
      config: configMap.get(r.run_id) ?? {},
    })),
    // session.results is a new array ref on every flush, configMap only changes at sweep start/history load
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.results, configMap],
  )

  const sweptParams = inferredSweptParams.length > 0
    ? inferredSweptParams
    : formState.parameters
        .filter(p => p.mode === 'sweep')
        .map(p => p.name)

  // 018: Selection helpers
  const toggleRunSelection = useCallback((runId: string) => {
    setSelectedRunIds(prev => {
      const next = new Set(prev)
      if (next.has(runId)) next.delete(runId)
      else next.add(runId)
      return next
    })
  }, [])

  const selectAllRuns = useCallback((runIds: string[]) => {
    setSelectedRunIds(new Set(runIds))
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedRunIds(new Set())
  }, [])

  // 018: Promotion
  const promotionEventSourceRef = useRef<EventSource | null>(null)

  const startPromotion = useCallback(async (sessionId: string, runIds: string[]) => {
    clearSelection()
    setPromotionStatus({
      session_id: sessionId,
      total: runIds.length,
      completed: 0,
      failed: 0,
      status: 'running',
      errors: [],
    })

    try {
      const resp = await fetchOptimizer(`/optimizer/session/${sessionId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_ids: runIds }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }))
        setPromotionStatus(prev => prev ? { ...prev, status: 'failed', errors: [{ run_id: '', error: err.error || resp.statusText }] } : null)
        return
      }

      const reader = resp.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'promotion_progress') {
              setPromotionStatus(prev => prev ? { ...prev, completed: event.completed, total: event.total } : null)
            } else if (event.type === 'promotion_error') {
              setPromotionStatus(prev => prev ? { ...prev, failed: prev.failed + 1, errors: [...prev.errors, { run_id: event.run_id, error: event.error }] } : null)
            } else if (event.type === 'promotion_complete') {
              setPromotionStatus(prev => prev ? { ...prev, status: 'completed', completed: event.completed, failed: event.failed } : null)
            } else if (event.type === 'promotion_cancelled') {
              setPromotionStatus(prev => prev ? { ...prev, status: 'cancelled' } : null)
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch (err) {
      setPromotionStatus(prev => prev ? { ...prev, status: 'failed', errors: [{ run_id: '', error: String(err) }] } : null)
    }

    // Re-fetch summaries to update promoted_at badges
    if (session?.sessionId) {
      try {
        const resp = await fetchOptimizer(`/optimizer/sessions/${session.sessionId}/results`)
        if (resp.ok) {
          const data = await resp.json()
          const results: BatchRunResult[] = (data.results ?? []).map((r: any) => ({
            run_id: r.runId ?? r.run_id,
            type: 'result' as const,
            pnlSummary: r.roi != null ? {
              roi: Number(r.roi),
              maxDrawdown: Number(r.maxDrawdown),
              totalFees: Number(r.totalFees),
              annualizedReturn: r.annualizedReturn != null ? parseFloat(r.annualizedReturn)
                : (r.annualized_return != null ? parseFloat(r.annualized_return) : null),
            } : undefined,
            executionTimeMs: r.executionTimeMs,
            longest_trade_duration_ms: r.longestTradeDurationMs ?? 0,
            max_safety_orders_used: r.maxSafetyOrdersUsed ?? 0,
            promoted_at: r.promotedAt ?? null,
          }))
          setSession(prev => prev ? { ...prev, results } : null)
        }
      } catch { /* best effort */ }
    }
  }, [fetchOptimizer, session?.sessionId, clearSelection])

  const cancelPromotion = useCallback(async (sessionId: string) => {
    try {
      await fetchOptimizer(`/optimizer/session/${sessionId}/promote`, { method: 'DELETE' })
    } catch { /* best effort */ }
  }, [fetchOptimizer])

  return {
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
    // T059: persistence error flag
    persistenceError,
    // T044/T045/T046: Sweep history
    sweepHistory,
    hasMoreSweeps: hasMoreHistory,
    onLoadMoreSweeps: loadMoreHistory,
    selectHistorySweep,
    // T057: Independent progress counter ref
    completedCountRef,
    // 018: Selection & promotion
    selectedRunIds,
    toggleRunSelection,
    selectAllRuns,
    clearSelection,
    promotionStatus,
    startPromotion,
    cancelPromotion,
  }
}
