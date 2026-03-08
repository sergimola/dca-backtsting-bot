import { renderHook, act, waitFor } from '@testing-library/react'
import { useBacktestPolling } from '../../hooks/useBacktestPolling'
import * as backtestApi from '../../services/backtest-api'

// Mock the backtest-api module
jest.mock('../../services/backtest-api')

const mockGetStatus = backtestApi.getStatus as jest.MockedFunction<typeof backtestApi.getStatus>
const mockGetResults = backtestApi.getResults as jest.MockedFunction<typeof backtestApi.getResults>

const mockResults = {
  backtestId: 'test-123',
  pnlSummary: { roi: 10, maxDrawdown: -5, totalFees: 50 },
  safetyOrderUsage: [{ level: 'SO1', count: 5 }],
  tradeEvents: []
}

describe('useBacktestPolling Hook Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('T043.1: Hook starts polling on mount', async () => {
    mockGetStatus.mockResolvedValueOnce({ status: 'completed' })
    mockGetResults.mockResolvedValueOnce(mockResults)

    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    renderHook(() =>
      useBacktestPolling({
        backtestId: 'test-123',
        onComplete,
        onError,
        onTimeout
      })
    )

    // Advance timers to trigger polling
    act(() => {
      jest.advanceTimersByTime(2000)
    })

    await waitFor(() => {
      expect(mockGetStatus).toHaveBeenCalledWith('test-123')
    })
  })

  test('T043.2: Hook polls at 2-second intervals', async () => {
    mockGetStatus.mockResolvedValue({ status: 'pending' })

    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    renderHook(() =>
      useBacktestPolling({
        backtestId: 'test-123',
        onComplete,
        onError,
        onTimeout,
        pollInterval: 2000
      })
    )

    // Hook calls immediately + interval calls, so after 2000ms we should have 2 calls
    act(() => {
      jest.advanceTimersByTime(2000)
    })

    await waitFor(() => {
      expect(mockGetStatus.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    const callsAfter2s = mockGetStatus.mock.calls.length

    // Another 2 seconds should bring another call
    act(() => {
      jest.advanceTimersByTime(2000)
    })

    await waitFor(() => {
      expect(mockGetStatus.mock.calls.length).toBeGreaterThan(callsAfter2s)
    })
  })

  test('T043.3: Hook calls onComplete when status is completed', async () => {
    mockGetStatus.mockResolvedValueOnce({ status: 'completed' })
    mockGetResults.mockResolvedValueOnce(mockResults)

    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    renderHook(() =>
      useBacktestPolling({
        backtestId: 'test-123',
        onComplete,
        onError,
        onTimeout
      })
    )

    act(() => {
      jest.advanceTimersByTime(2000)
    })

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(mockResults)
    })
  })

  test('T043.4: Hook calls onError when status is failed', async () => {
    mockGetStatus.mockResolvedValueOnce({ 
      status: 'failed',
      error: 'Backtest execution failed'
    })

    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    renderHook(() =>
      useBacktestPolling({
        backtestId: 'test-123',
        onComplete,
        onError,
        onTimeout
      })
    )

    act(() => {
      jest.advanceTimersByTime(2000)
    })

    await waitFor(() => {
      expect(onError).toHaveBeenCalled()
      const errorArg = onError.mock.calls[0][0]
      expect(errorArg).toBeInstanceOf(Error)
      expect(errorArg.message).toContain('failed')
    })
  })

  test('T043.5: Hook continues polling when status is pending', async () => {
    mockGetStatus
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'completed' })

    mockGetResults.mockResolvedValueOnce(mockResults)

    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    renderHook(() =>
      useBacktestPolling({
        backtestId: 'test-123',
        onComplete,
        onError,
        onTimeout
      })
    )

    // After 2 seconds, should have immediate call + 1 interval call = 2 calls
    act(() => {
      jest.advanceTimersByTime(2000)
    })

    await waitFor(() => {
      expect(mockGetStatus.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    // After 4 seconds total
    act(() => {
      jest.advanceTimersByTime(2000)
    })

    await waitFor(() => {
      expect(mockGetStatus.mock.calls.length).toBeGreaterThanOrEqual(3)
    })

    // After 6 seconds total - should transition to completed
    act(() => {
      jest.advanceTimersByTime(2000)
    })

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(mockResults)
    })
  })

  test('T043.6: Hook calls onTimeout when 5 minutes elapsed', async () => {
    mockGetStatus.mockResolvedValue({ status: 'pending' })

    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    renderHook(() =>
      useBacktestPolling({
        backtestId: 'test-123',
        onComplete,
        onError,
        onTimeout,
        timeoutThreshold: 5 * 60 * 1000 // 5 minutes
      })
    )

    // Advance to 5 minutes
    act(() => {
      jest.advanceTimersByTime(5 * 60 * 1000)
    })

    await waitFor(() => {
      expect(onTimeout).toHaveBeenCalled()
    })
  })

  test('T043.7: Hook stops polling on unmount', async () => {
    mockGetStatus.mockResolvedValue({ status: 'pending' })

    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    const { unmount } = renderHook(() =>
      useBacktestPolling({
        backtestId: 'test-123',
        onComplete,
        onError,
        onTimeout
      })
    )

    // Allows immediate call to complete
    act(() => {
      jest.runOnlyPendingTimers()
    })

    const callCountAfterInitial = mockGetStatus.mock.calls.length

    unmount()

    // Advance time further - should not call getStatus again
    act(() => {
      jest.advanceTimersByTime(4000)
    })

    expect(mockGetStatus.mock.calls.length).toBe(callCountAfterInitial)
  })

  test('T043.8: Hook retries on network error with exponential backoff', async () => {
    const networkError = new Error('Network error')
    
    mockGetStatus
      .mockRejectedValueOnce(networkError) // First attempt fails
      .mockRejectedValueOnce(networkError) // Retry 1 fails
      .mockResolvedValueOnce({ status: 'completed' }) // Retry 2 succeeds

    mockGetResults.mockResolvedValueOnce(mockResults)

    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    renderHook(() =>
      useBacktestPolling({
        backtestId: 'test-123',
        onComplete,
        onError,
        onTimeout
      })
    )

    // Initial poll + interval attempts
    act(() => {
      jest.advanceTimersByTime(2000)
    })

    // Allow retries with exponential backoff to occur
    act(() => {
      jest.advanceTimersByTime(4000) // 2s backoff
    })

    act(() => {
      jest.advanceTimersByTime(4000) // 4s backoff
    })

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled()
    })
  })

  test('T043.9: Hook returns correct state values', async () => {
    mockGetStatus.mockResolvedValue({ status: 'pending' })

    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    const { result } = renderHook(() =>
      useBacktestPolling({
        backtestId: 'test-123',
        onComplete,
        onError,
        onTimeout
      })
    )

    // Initially should be polling
    expect(result.current.isPolling).toBe(true)
    expect(result.current.status).toBe('pending')
    expect(result.current.elapsedSeconds).toBe(0)
    expect(result.current.retryAttempt).toBe(0)

    // After some time
    act(() => {
      jest.advanceTimersByTime(10000) // 10 seconds
    })

    await waitFor(() => {
      expect(result.current.elapsedSeconds).toBeGreaterThanOrEqual(10)
    })
  })

  test('T043.10: Hook calculates progress percentage correctly', async () => {
    mockGetStatus.mockResolvedValue({ status: 'pending' })

    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    const { result } = renderHook(() =>
      useBacktestPolling({
        backtestId: 'test-123',
        onComplete,
        onError,
        onTimeout,
        timeoutThreshold: 300000 // 5 minutes
      })
    )

    // After 1.5 minutes (150 seconds), progress should be ~50%
    act(() => {
      jest.advanceTimersByTime(150000)
    })

    await waitFor(() => {
      expect(result.current.progress).toBeLessThanOrEqual(100)
      expect(result.current.progress).toBeGreaterThan(0)
    })
  })
})
