/**
 * useOptimizer — State machine hook for the Optimizer Workspace.
 *
 * Manages: formState, phase transitions, sweep launch/cancel, SSE streaming,
 *          combinatorial count debounce, and Pre-Flight summary.
 */

import { useState, useCallback, useRef, useEffect } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export type SweepPhase = 'idle' | 'validating' | 'running' | 'complete' | 'cancelled' | 'partial'

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
}

export interface SweepCounts {
  count: number
  overLimit: boolean
  generated?: number
  pruned?: number
  valid?: number
}

export interface BatchRunResult {
  run_id: string
  type: 'result' | 'error'
  error?: string
  pnlSummary?: { roi: number; maxDrawdown: number; totalFees: number }
  executionTimeMs?: number
  candleCount?: number
  eventCount?: number
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
  })

  const [phase, setPhase] = useState<SweepPhase>('idle')
  const [sweepCounts, setSweepCounts] = useState<SweepCounts | null>(null)
  const [sweepSummary, setSweepSummary] = useState<SweepSummary | null>(null)
  const [session, setSession] = useState<OptimizerSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [configMap, setConfigMap] = useState<Map<string, Record<string, string | number>>>(new Map())

  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // ── beforeunload warning when sweep is running ────────────────────────────
  useEffect(() => {
    if (phase !== 'running') return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [phase])

  // ── Field update + debounced count ────────────────────────────────────────

  const updateField = useCallback((name: string, patch: Partial<ParameterField>) => {
    setFormState(prev => ({
      ...prev,
      parameters: prev.parameters.map(p =>
        p.name === name ? { ...p, ...patch } : p
      ),
    }))
  }, [])

  const updateFormField = useCallback((field: string, value: string) => {
    setFormState(prev => ({ ...prev, [field]: value }))
  }, [])

  // Debounced count fetch.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const params = formState.parameters.map(p => ({
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

    try {
      const params = formState.parameters.map(p => ({
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
          margin_type: 'cross',
          exit_on_last_order: false,
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
            if (event.type === 'result' || event.type === 'error') {
              setSession(prev => prev ? {
                ...prev,
                results: [...prev.results, event as unknown as BatchRunResult],
              } : prev)
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
  }, [])

  // ── Derived values ────────────────────────────────────────────────────────

  const enrichedResults: EnrichedResult[] = (session?.results ?? []).map(r => ({
    ...r,
    config: configMap.get(r.run_id) ?? {},
  }))

  const sweptParams = formState.parameters
    .filter(p => p.mode === 'sweep')
    .map(p => p.name)

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
  }
}
