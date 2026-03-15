import { renderHook } from '@testing-library/react'
import { useRunPolling } from '../../hooks/useRunPolling'

// CONSTITUTION GATE: mock useBacktestPolling at module boundary, NOT setInterval
jest.mock('../../hooks/useBacktestPolling', () => ({
  useBacktestPolling: jest.fn(),
}))

import { useBacktestPolling } from '../../hooks/useBacktestPolling'
const mockUseBacktestPolling = useBacktestPolling as jest.MockedFunction<typeof useBacktestPolling>

describe('useRunPolling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default: pending status, not yet complete
    mockUseBacktestPolling.mockReturnValue({
      isPolling: true,
      status: 'pending',
      elapsedSeconds: 0,
      progress: 0,
      retryAttempt: 0,
    })
  })

  it('hook accepts all required callback props and returns void', () => {
    const onComplete = jest.fn()
    const onFail = jest.fn()
    const onLogUpdate = jest.fn()
    const onProgressUpdate = jest.fn()

    const { result } = renderHook(() =>
      useRunPolling({
        backtestId: 'test-id-001',
        onComplete,
        onFail,
        onLogUpdate,
        onProgressUpdate,
      })
    )

    // Architecture gate: must return void
    expect(result.current).toBeUndefined()
  })

  it('passes backtestId unchanged to useBacktestPolling', () => {
    renderHook(() =>
      useRunPolling({
        backtestId: 'my-backtest-id',
        onComplete: jest.fn(),
        onFail: jest.fn(),
        onLogUpdate: jest.fn(),
        onProgressUpdate: jest.fn(),
      })
    )

    expect(mockUseBacktestPolling).toHaveBeenCalledWith(
      expect.objectContaining({ backtestId: 'my-backtest-id' })
    )
  })

  it('does NOT override pollInterval or timeoutThreshold from outside', () => {
    renderHook(() =>
      useRunPolling({
        backtestId: 'test',
        onComplete: jest.fn(),
        onFail: jest.fn(),
        onLogUpdate: jest.fn(),
        onProgressUpdate: jest.fn(),
      })
    )
    expect(mockUseBacktestPolling).toHaveBeenCalledWith(
      expect.objectContaining({ pollInterval: 2000, timeoutThreshold: 300000 })
    )
  })

  it('fires onProgressUpdate with 100 and onComplete on completion', async () => {
    const onComplete = jest.fn()
    const onProgressUpdate = jest.fn()

    // Capture the onComplete callback passed to useBacktestPolling
    let capturedOnComplete: ((results: any) => void) | undefined
    mockUseBacktestPolling.mockImplementation((props) => {
      capturedOnComplete = props.onComplete
      return { isPolling: false, status: 'completed', elapsedSeconds: 30, progress: 100, retryAttempt: 0 }
    })

    renderHook(() =>
      useRunPolling({
        backtestId: 'test',
        onComplete,
        onFail: jest.fn(),
        onLogUpdate: jest.fn(),
        onProgressUpdate,
      })
    )

    const mockResults = { backtestId: 'test', pnlSummary: { roi: 5, maxDrawdown: -1, totalFees: 0 }, safetyOrderUsage: [], tradeEvents: [] }
    capturedOnComplete!(mockResults)

    expect(onProgressUpdate).toHaveBeenCalledWith('test', 100)
    expect(onComplete).toHaveBeenCalledWith(mockResults)
  })

  it('fires onFail when useBacktestPolling reports error callback', () => {
    const onFail = jest.fn()
    let capturedOnError: ((err: Error) => void) | undefined
    mockUseBacktestPolling.mockImplementation((props) => {
      capturedOnError = props.onError
      return { isPolling: false, status: 'failed', elapsedSeconds: 30, progress: 0, retryAttempt: 0 }
    })

    renderHook(() =>
      useRunPolling({
        backtestId: 'test',
        onComplete: jest.fn(),
        onFail,
        onLogUpdate: jest.fn(),
        onProgressUpdate: jest.fn(),
      })
    )

    capturedOnError!(new Error('Backend failed'))
    expect(onFail).toHaveBeenCalledWith('Backend failed')
  })

  it('fires onFail with timeout message on onTimeout callback', () => {
    const onFail = jest.fn()
    let capturedOnTimeout: (() => void) | undefined
    mockUseBacktestPolling.mockImplementation((props) => {
      capturedOnTimeout = props.onTimeout
      return { isPolling: false, status: 'timeout', elapsedSeconds: 300, progress: 0, retryAttempt: 0 }
    })

    renderHook(() =>
      useRunPolling({
        backtestId: 'test',
        onComplete: jest.fn(),
        onFail,
        onLogUpdate: jest.fn(),
        onProgressUpdate: jest.fn(),
      })
    )

    capturedOnTimeout!()
    expect(onFail).toHaveBeenCalledWith(expect.stringMatching(/timeout/i))
  })

  it('calls onLogUpdate + onProgressUpdate on each poll cycle status update', () => {
    const onLogUpdate = jest.fn()
    const onProgressUpdate = jest.fn()

    mockUseBacktestPolling.mockReturnValue({
      isPolling: true,
      status: 'downloading',
      elapsedSeconds: 10,
      progress: 3,
      retryAttempt: 0,
    })

    renderHook(() =>
      useRunPolling({
        backtestId: 'test-poll',
        onComplete: jest.fn(),
        onFail: jest.fn(),
        onLogUpdate,
        onProgressUpdate,
      })
    )

    // useEffect fires after render
    expect(onLogUpdate).toHaveBeenCalledWith('test-poll', expect.stringContaining('Downloading'))
    expect(onProgressUpdate).toHaveBeenCalledWith('test-poll', expect.any(Number))
  })
})
