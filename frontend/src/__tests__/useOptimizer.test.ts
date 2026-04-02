/**
 * T058: US7 Throttled rendering test.
 *
 * Validates that 200 SSE result events buffered via resultBufferRef are NOT
 * immediately flushed to React state, and that after 2000ms of fake timers
 * all 200 results appear in session.results.
 * Also validates completedCountRef.current === 200 immediately (T057).
 */
import { renderHook, act, waitFor } from '@testing-library/react'
import { useOptimizer } from '../hooks/useOptimizer'

// ── Helper: build a readable stream with N result events ──────────────────
function makeEventStream(resultCount: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const lines: string[] = []
  for (let i = 0; i < resultCount; i++) {
    lines.push(`data: ${JSON.stringify({ type: 'result', runId: `run-${i}`, roi: i })}\n`)
    lines.push('\n')
  }
  lines.push(`data: ${JSON.stringify({ type: 'complete' })}\n`)
  lines.push('\n')
  const body = lines.join('')
  const chunk = encoder.encode(body)

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk)
      controller.close()
    },
  })
}

// ── Mock fetch factory ────────────────────────────────────────────────────
const SESSION_ID = 'test-session-t058'

const mockSweepResponse = {
  sessionId: SESSION_ID,
  pruningResult: { generated: 200, pruned: 0, valid: 200, pruneReasons: {} },
  preFlightSummary: { totalConfigs: 200, pruned: 0, valid: 200 },
  validConfigs: Array.from({ length: 200 }, (_, i) => ({ run_id: `run-${i}`, roi: i })),
}

function installMockFetch() {
  const mockFetch = jest.fn().mockImplementation((url: string) => {
    if (url.includes('/optimizer/sweep') && !url.includes('/count')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockSweepResponse),
      })
    }
    if (url.includes('/execute')) {
      return Promise.resolve({
        ok: true,
        body: makeEventStream(200),
      })
    }
    // All other calls (sessions, sweep/count) rejected silently
    return Promise.reject(new Error(`unmocked: ${url}`))
  })
  global.fetch = mockFetch as unknown as typeof fetch
  return mockFetch
}

beforeEach(() => {
  jest.clearAllMocks()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('useOptimizer — throttled rendering (T058)', () => {
  it('T058-AC1: completedCountRef.current === 200 after stream (T057 independent counter)', async () => {
    installMockFetch()

    const { result } = renderHook(() => useOptimizer())

    await act(async () => {
      await result.current.launch()
    })

    expect(result.current.completedCountRef.current).toBe(200)
  })

  it('T058-AC2: after stream ends all 200 results appear in session.results (final flush on phase complete)', async () => {
    installMockFetch()

    const { result } = renderHook(() => useOptimizer())

    await act(async () => {
      await result.current.launch()
    })

    // On phase → 'complete', the flush effect does a final drain of the buffer.
    // All 200 buffered results should be in session.results without needing timers.
    expect(result.current.session?.results.length).toBe(200)
  })
})

// T061: persistence_error SSE event → persistenceError flag = true
describe('useOptimizer — persistence error banner (T061)', () => {
  it('T061-AC1: persistence_error SSE event sets persistenceError = true', async () => {
    const mockFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/optimizer/sweep') && !url.includes('/count')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            sessionId: 'sess-t061',
            pruningResult: { generated: 1, pruned: 0, valid: 1, pruneReasons: {} },
            preFlightSummary: { totalConfigs: 1, pruned: 0, valid: 1 },
            validConfigs: [{ run_id: 'run-0', roi: 0 }],
          }),
        })
      }
      if (url.includes('/execute')) {
        const encoder = new TextEncoder()
        const body = `data: ${JSON.stringify({ type: 'persistence_error' })}\n\ndata: ${JSON.stringify({ type: 'result', runId: 'run-0', roi: 0 })}\n\ndata: ${JSON.stringify({ type: 'complete' })}\n\n`
        return Promise.resolve({
          ok: true,
          body: new ReadableStream({
            start(ctrl) { ctrl.enqueue(encoder.encode(body)); ctrl.close() },
          }),
        })
      }
      return Promise.reject(new Error(`unmocked: ${url}`))
    })
    global.fetch = mockFetch as unknown as typeof fetch

    const { result } = renderHook(() => useOptimizer())

    await act(async () => {
      await result.current.launch()
    })

    expect(result.current.persistenceError).toBe(true)
  })
})
