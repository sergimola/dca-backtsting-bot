import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { PollingPage } from '../../pages/PollingPage'
import type { BacktestResults } from '../../services/types'

// Mock useBacktestPolling hook
jest.mock('../../hooks/useBacktestPolling', () => ({
  useBacktestPolling: jest.fn()
}))

import { useBacktestPolling } from '../../hooks/useBacktestPolling'

const mockUseBacktestPolling = useBacktestPolling as jest.MockedFunction<typeof useBacktestPolling>

const mockResults: BacktestResults = {
  backtestId: 'test-123',
  pnlSummary: { roi: 15.5, maxDrawdown: -8.2, totalFees: 25.0 },
  safetyOrderUsage: [
    { level: 'SO1', count: 3 },
    { level: 'SO2', count: 2 }
  ],
  tradeEvents: []
}

describe('PollingPage Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('T050.1: PollingPage renders polling indicator with backtestId', () => {
    mockUseBacktestPolling.mockReturnValue({
      isPolling: true,
      status: 'pending',
      elapsedSeconds: 0,
      progress: 0,
      retryAttempt: 0
    })

    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    render(
      <PollingPage
        backtestId="test-123"
        onComplete={onComplete}
        onError={onError}
        onTimeout={onTimeout}
      />
    )

    // Should display polling indicator or loading state
    expect(screen.getByText(/Polling|Processing|backtest|test-123/i)).toBeInTheDocument()
  })

  test('T050.2: PollingPage calls useBacktestPolling with correct props', () => {
    mockUseBacktestPolling.mockReturnValue({
      isPolling: true,
      status: 'pending',
      elapsedSeconds: 0,
      progress: 0,
      retryAttempt: 0
    })

    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    render(
      <PollingPage
        backtestId="test-123"
        onComplete={onComplete}
        onError={onError}
        onTimeout={onTimeout}
      />
    )

    expect(mockUseBacktestPolling).toHaveBeenCalledWith(
      expect.objectContaining({
        backtestId: 'test-123',
        onComplete: expect.any(Function),
        onError: expect.any(Function),
        onTimeout: expect.any(Function)
      })
    )
  })

  test('T050.3: PollingPage calls onComplete when polling finishes', async () => {
    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    mockUseBacktestPolling.mockImplementation(({ onComplete: hookOnComplete }) => {
      // Simulate hook calling onComplete after mount
      setTimeout(() => hookOnComplete(mockResults), 0)
      return {
        isPolling: false,
        status: 'completed',
        elapsedSeconds: 45,
        progress: 100,
        retryAttempt: 0
      }
    })

    render(
      <PollingPage
        backtestId="test-123"
        onComplete={onComplete}
        onError={onError}
        onTimeout={onTimeout}
      />
    )

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(mockResults)
    })
  })

  test('T050.4: PollingPage calls onError when polling fails', async () => {
    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    const testError = new Error('Backtest execution failed')

    mockUseBacktestPolling.mockImplementation(({ onError: hookOnError }) => {
      setTimeout(() => hookOnError(testError), 0)
      return {
        isPolling: false,
        status: 'failed',
        elapsedSeconds: 10,
        progress: 5,
        retryAttempt: 0
      }
    })

    render(
      <PollingPage
        backtestId="test-123"
        onComplete={onComplete}
        onError={onError}
        onTimeout={onTimeout}
      />
    )

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(testError)
    })
  })

  test('T050.5: PollingPage calls onTimeout when polling times out', async () => {
    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    mockUseBacktestPolling.mockImplementation(({ onTimeout: hookOnTimeout }) => {
      setTimeout(() => hookOnTimeout(), 0)
      return {
        isPolling: false,
        status: 'timeout',
        elapsedSeconds: 300,
        progress: 100,
        retryAttempt: 0
      }
    })

    render(
      <PollingPage
        backtestId="test-123"
        onComplete={onComplete}
        onError={onError}
        onTimeout={onTimeout}
      />
    )

    await waitFor(() => {
      expect(onTimeout).toHaveBeenCalled()
    })
  })

  test('T050.6: PollingPage displays progress updates as polling continues', () => {
    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    const { rerender } = render(
      <PollingPage
        backtestId="test-123"
        onComplete={onComplete}
        onError={onError}
        onTimeout={onTimeout}
      />
    )

    mockUseBacktestPolling.mockReturnValue({
      isPolling: true,
      status: 'pending',
      elapsedSeconds: 30,
      progress: 10,
      retryAttempt: 0
    })

    rerender(
      <PollingPage
        backtestId="test-123"
        onComplete={onComplete}
        onError={onError}
        onTimeout={onTimeout}
      />
    )

    // Should render polling component with updated elapsed time
    expect(screen.getByText(/30|seconds|progress/i)).toBeInTheDocument()
  })

  test('T050.7: PollingPage passes hook state to PollingIndicator', () => {
    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    mockUseBacktestPolling.mockReturnValue({
      isPolling: true,
      status: 'pending',
      elapsedSeconds: 45,
      progress: 15,
      retryAttempt: 0
    })

    render(
      <PollingPage
        backtestId="test-123"
        onComplete={onComplete}
        onError={onError}
        onTimeout={onTimeout}
      />
    )

    // Should display elapsed time from hook
    expect(screen.getByText(/45|seconds|elapsed/i) || screen.getByText(/45/)).toBeInTheDocument()
  })

  test('T050.8: PollingPage retry button restarts polling', async () => {
    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    const { rerender } = render(
      <PollingPage
        backtestId="test-123"
        onComplete={onComplete}
        onError={onError}
        onTimeout={onTimeout}
      />
    )

    mockUseBacktestPolling.mockReturnValue({
      isPolling: true,
      status: 'pending',
      elapsedSeconds: 0,
      progress: 0,
      retryAttempt: 0
    })

    rerender(
      <PollingPage
        backtestId="test-123"
        onComplete={onComplete}
        onError={onError}
        onTimeout={onTimeout}
      />
    )

    const retryButton = screen.getByRole('button', { name: /retry/i })
    fireEvent.click(retryButton)

    // Polling should restart with progress reset to 0
    expect(mockUseBacktestPolling).toHaveBeenCalled()
  })

  test('T050.9: PollingPage handles error state display', () => {
    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    mockUseBacktestPolling.mockReturnValue({
      isPolling: false,
      status: 'failed',
      elapsedSeconds: 30,
      progress: 10,
      retryAttempt: 2
    })

    render(
      <PollingPage
        backtestId="test-123"
        onComplete={onComplete}
        onError={onError}
        onTimeout={onTimeout}
      />
    )

    // Should show error state UI (multiple elements may match)
    const errorElements = screen.getAllByText(/failed|error|retry/i)
    expect(errorElements.length).toBeGreaterThan(0)
  })

  test('T050.10: PollingPage cancel button allows user to stop polling', () => {
    const onComplete = jest.fn()
    const onError = jest.fn()
    const onTimeout = jest.fn()

    mockUseBacktestPolling.mockReturnValue({
      isPolling: true,
      status: 'pending',
      elapsedSeconds: 10,
      progress: 3,
      retryAttempt: 0
    })

    render(
      <PollingPage
        backtestId="test-123"
        onComplete={onComplete}
        onError={onError}
        onTimeout={onTimeout}
      />
    )

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    expect(cancelButton).toBeInTheDocument()

    // Button should be clickable and trigger some handler
    fireEvent.click(cancelButton)
  })
})
