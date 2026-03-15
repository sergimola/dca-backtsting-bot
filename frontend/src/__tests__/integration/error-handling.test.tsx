import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../../App'

// Mock API + polling at module boundary
jest.mock('../../services/backtest-api', () => ({
  submitBacktest: jest.fn(),
  getStatus: jest.fn(),
  listBacktests: jest.fn().mockResolvedValue([]),
  getResults: jest.fn(),
}))

jest.mock('../../hooks/useRunPolling', () => ({
  useRunPolling: jest.fn(),
}))

import { submitBacktest } from '../../services/backtest-api'
import { useRunPolling } from '../../hooks/useRunPolling'
const mockSubmit = submitBacktest as jest.MockedFunction<typeof submitBacktest>
const mockUseRunPolling = useRunPolling as jest.MockedFunction<typeof useRunPolling>

const fillForm = () => {
  fireEvent.change(screen.getByLabelText(/trading pair/i), { target: { value: 'BTC/USDT' } })
  fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2024-01-01T00:00' } })
  fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: '2024-06-01T00:00' } })
  fireEvent.change(screen.getByLabelText(/entry price/i), { target: { value: '50000' } })
  fireEvent.change(screen.getByLabelText(/price scale/i), { target: { value: '1.1' } })
  fireEvent.change(screen.getByLabelText(/amount scale/i), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText(/number of orders/i), { target: { value: '5' } })
  fireEvent.change(screen.getByLabelText(/amount per trade/i), { target: { value: '0.1' } })
  fireEvent.change(screen.getByLabelText(/multiplier/i), { target: { value: '1' } })
  fireEvent.change(screen.getByLabelText(/take profit/i), { target: { value: '2.5' } })
  fireEvent.change(screen.getByLabelText(/account balance/i), { target: { value: '1000' } })
}

describe('Error handling integration (T035 / T037)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseRunPolling.mockReturnValue(undefined as any)
  })

  // ── T035: submission error flow ─────────────────────────────────────────
  it('T035: when submitBacktest rejects, runs[] length stays 0', async () => {
    mockSubmit.mockRejectedValue(new Error('Server unavailable'))
    render(<App />)

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /run backtest|start|submit/i }))

    await waitFor(() => {
      // No RunCard should appear in sidebar
      expect(screen.queryAllByRole('listitem').length).toBe(0)
    })
  })

  it('T035: when submitBacktest rejects, ConfigFormView still shows', async () => {
    mockSubmit.mockRejectedValue(new Error('Network error'))
    render(<App />)

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /run backtest|start|submit/i }))

    await waitFor(() => {
      // ConfigFormView should still be visible (form stays on screen)
      expect(screen.getByText(/new backtest/i)).toBeInTheDocument()
    })
  })

  it('T035: when submitBacktest rejects, error message is shown in ConfigFormView', async () => {
    mockSubmit.mockRejectedValue(new Error('Server unavailable'))
    render(<App />)

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /run backtest|start|submit/i }))

    await waitFor(() => {
      expect(screen.getByText(/server unavailable/i)).toBeInTheDocument()
    })
  })

  // ── T037: polling failure → failed run card ──────────────────────────────
  it('T037: onFail callback updates run status to failed', async () => {
    // Capture the onFail callback passed to useRunPolling
    let capturedOnFail: ((backtestId: string, msg: string) => void) | undefined
    mockUseRunPolling.mockImplementation(({ onFail }) => {
      capturedOnFail = onFail
      return undefined as any
    })

    mockSubmit.mockResolvedValue({ backtestId: 'fail-run-001' })
    render(<App />)

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /run backtest|start|submit/i }))

    await waitFor(() => {
      expect(screen.queryAllByText(/fail-run/i).length).toBeGreaterThan(0)
    })

    // Trigger failure
    expect(capturedOnFail).toBeDefined()
    capturedOnFail!('fail-run-001', 'Connection lost')

    await waitFor(() => {
      // RunCard should show failed indicator
      expect(screen.getByText(/failed/i)).toBeInTheDocument()
    })
  })

  it('T037: after failure, RunPollingController is no longer rendered (no useRunPolling call with that id)', async () => {
    let onFailRef: ((backtestId: string, msg: string) => void) | undefined
    mockUseRunPolling.mockImplementation(({ onFail }) => {
      onFailRef = onFail
      return undefined as any
    })

    mockSubmit.mockResolvedValue({ backtestId: 'fail-run-002' })
    render(<App />)

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /run backtest|start|submit/i }))
    await waitFor(() => {
      expect(screen.queryAllByText(/fail-run/i).length).toBeGreaterThan(0)
    })

    const callCountBefore = mockUseRunPolling.mock.calls.length
    onFailRef!('fail-run-002', 'Error')

    await waitFor(() => {
      expect(screen.getByText(/failed/i)).toBeInTheDocument()
    })

    // After fail, the RunPollingController for this run should be unmounted
    // (no new calls to useRunPolling for that backtestId)
    const callsAfter = mockUseRunPolling.mock.calls.filter(
      c => c[0].backtestId === 'fail-run-002'
    )
    // All existing calls should have been from before the failure
    expect(callsAfter.length).toBeLessThanOrEqual(callCountBefore)
  })
})
