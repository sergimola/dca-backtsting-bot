/**
 * T066: US10 Cancellation integration tests.
 *
 * Tests that SweepPersistenceService correctly handles session finalisation
 * with status="cancelled" at various points:
 *   (a) cancel before first result -> status=cancelled, totalRuns=0, 0 summaries
 *   (b) cancel after N results -> N summaries, status=cancelled
 *   (c) concurrent persist + cancel -> all writes complete (no race condition)
 *
 * Requires DATABASE_URL pointing to a running Postgres instance.
 */
import { SweepPersistenceService } from '../services/SweepPersistenceService.js'
import type { BatchRunResult, SweepDefinition, FixedParams } from '../types/optimizer.js'
import { randomUUID } from 'crypto'

const DB_AVAILABLE = !!process.env.DATABASE_URL
const describeIfDb = DB_AVAILABLE ? describe : describe.skip

const testDefinition: SweepDefinition = {
  symbol: 'T066/USDT',
  startDate: '2025-01-01T00:00:00Z',
  endDate: '2025-01-31T00:00:00Z',
  accountBalance: '1000',
  parameters: [],
  fixedParams: {
    trading_pair: 'T066/USDT',
    start_date: '2025-01-01',
    end_date: '2025-01-31',
    margin_type: 'cross',
    exit_on_last_order: false,
    clickhouse_addr: '', clickhouse_db: '', clickhouse_user: '', clickhouse_password: '',
  } as FixedParams,
}

function makeRunResult(runId: string, i: number): BatchRunResult {
  return {
    type: 'result',
    run_id: runId,
    pnlSummary: { roi: i * 0.5, maxDrawdown: -1, totalFees: 0.1 },
    winRate: 0.5,
    totalPositionsClosed: 2,
    executionTimeMs: 100,
  } as BatchRunResult
}

describeIfDb('T066: Cancellation integration tests', () => {
  const service = new SweepPersistenceService()
  let sessionId: string

  beforeEach(() => {
    sessionId = randomUUID()
  })

  afterEach(async () => {
    try {
      await service.deleteSession(sessionId)
    } catch { /* ignore */ }
  })

  it('T066-AC1: cancel before first result - status=cancelled, totalRuns=0, 0 summaries', async () => {
    await service.createSession(sessionId, testDefinition, 'T066/USDT', '2025-01-01', '2025-01-31')
    await service.finalizeSession(sessionId, 'cancelled', null, 0, 0)

    const page = await service.getSessions(1, 100)
    const sess = page.sessions.find((s: any) => s.id === sessionId)
    expect(sess?.status).toBe('cancelled')
    expect(sess?.totalRuns).toBe(0)

    const summaries = await service.getRunSummaries(sessionId)
    expect(summaries.length).toBe(0)
  })

  it('T066-AC2: cancel after N results - exactly N summaries, status=cancelled', async () => {
    const N = 5
    await service.createSession(sessionId, testDefinition, 'T066/USDT', '2025-01-01', '2025-01-31')

    for (let i = 0; i < N; i++) {
      const runId = randomUUID()
      await service.persistRunSummary(sessionId, makeRunResult(runId, i), { run_id: runId }, '500')
    }

    await service.finalizeSession(sessionId, 'cancelled', null, N, 0)

    const page2 = await service.getSessions(1, 100)
    const sess2 = page2.sessions.find((s: any) => s.id === sessionId)
    expect(sess2?.status).toBe('cancelled')
    expect(sess2?.totalRuns).toBe(N)

    const summaries = await service.getRunSummaries(sessionId)
    expect(summaries.length).toBe(N)
  })

  it('T066-AC3: concurrent writes + cancel - all writes complete (no race condition)', async () => {
    const N = 10
    await service.createSession(sessionId, testDefinition, 'T066/USDT', '2025-01-01', '2025-01-31')

    const runIds = Array.from({ length: N }, () => randomUUID())
    const writes = runIds.map((runId, i) =>
      service.persistRunSummary(sessionId, makeRunResult(runId, i), { run_id: runId }, '500')
    )

    // Cancel concurrently with all writes.
    await Promise.all([...writes, service.finalizeSession(sessionId, 'cancelled', null, N, 0)])

    const summaries = await service.getRunSummaries(sessionId)
    expect(summaries.length).toBe(N)
  })
})
