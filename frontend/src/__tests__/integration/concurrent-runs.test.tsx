import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../../App'

// Mock submitBacktest and useRunPolling at module boundaries
jest.mock('../../services/backtest-api', () => ({
  submitBacktest: jest.fn(),
  getStatus: jest.fn(),
  listBacktests: jest.fn().mockResolvedValue([]),
  getResults: jest.fn(),
}))

jest.mock('../../hooks/useRunPolling', () => ({
  useRunPolling: jest.fn(),
}))

// Mock useResultsMetrics to avoid Decimal.js computation in integration tests
jest.mock('../../hooks/useResultsMetrics', () => ({
  useResultsMetrics: jest.fn(() => ({
    netProfit: 50,
    totalFees: 5,
    roi: 5,
    winRate: 100,
    profitFactor: 2,
    capitalUtilized: 50,
    maxDrawdown: -1,
    accountEquity: 1050,
    tradeGroups: [],
    safetyOrderUsage: [],
  })),
}))

import { submitBacktest } from '../../services/backtest-api'
import { useRunPolling } from '../../hooks/useRunPolling'
const mockSubmit = submitBacktest as jest.MockedFunction<typeof submitBacktest>
const mockUseRunPolling = useRunPolling as jest.MockedFunction<typeof useRunPolling>

const mockResults = {
  backtestId: 'run-a-001',
  pnlSummary: { roi: 5.0, maxDrawdown: -1.0, totalFees: 5.0 },
  safetyOrderUsage: [],
  tradeEvents: [],
}

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

describe('Concurrent runs integration (T031)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseRunPolling.mockReturnValue(undefined as any)
  })

  it('submitting Run A shows one running RunCard in sidebar', async () => {
    mockSubmit.mockResolvedValue({ backtestId: 'run-a-001' })
    render(<App />)

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /run backtest|start|submit/i }))

    await waitFor(() => {
      // Sidebar shows the run short ID (first 8 chars of 'run-a-001' = 'run-a-00')
      expect(screen.queryAllByText(/run-a-0/i).length).toBeGreaterThan(0)
    })
  })

  it('clicking + while Run A is running shows ConfigFormView without clearing runs', async () => {
    mockSubmit.mockResolvedValue({ backtestId: 'run-a-001' })
    render(<App />)

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /run backtest|start|submit/i }))

    await waitFor(() => {
      expect(screen.queryAllByText(/run-a-0/i).length).toBeGreaterThan(0)
    })

    // Click + to start another run
    const plusBtn = screen.getByRole('button', { name: /\+|new backtest/i })
    fireEvent.click(plusBtn)

    // ConfigFormView should show again
    expect(screen.getByText(/new backtest/i)).toBeInTheDocument()
    // Run A still in sidebar
    expect(screen.queryAllByText(/run-a-0/i).length).toBeGreaterThan(0)
  })

  it('submitting Run B shows two running RunCards in sidebar', async () => {
    mockSubmit
      .mockResolvedValueOnce({ backtestId: 'run-a-001' })
      .mockResolvedValueOnce({ backtestId: 'run-b-002' })

    render(<App />)

    // Submit Run A
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /run backtest|start|submit/i }))
    await waitFor(() => {
      expect(screen.queryAllByText(/run-a-0/i).length).toBeGreaterThan(0)
    })

    // Click + to open config form again
    fireEvent.click(screen.getByRole('button', { name: /\+|new backtest/i }))

    // Submit Run B
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /run backtest|start|submit/i }))
    await waitFor(() => {
      expect(screen.queryAllByText(/run-b-0/i).length).toBeGreaterThan(0)
    })

    // Both runs should be in sidebar
    expect(screen.queryAllByText(/run-a-0/i).length).toBeGreaterThan(0)
    expect(screen.queryAllByText(/run-b-0/i).length).toBeGreaterThan(0)
  })

  it('RunPollingController is rendered per running run — useRunPolling called independently', async () => {
    mockSubmit
      .mockResolvedValueOnce({ backtestId: 'run-a-001' })
      .mockResolvedValueOnce({ backtestId: 'run-b-002' })

    render(<App />)

    // Submit Run A
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /run backtest|start|submit/i }))
    await waitFor(() => {
      expect(screen.queryAllByText(/run-a-0/i).length).toBeGreaterThan(0)
    })

    // Each running run gets its own RunPollingController which calls useRunPolling once
    expect(mockUseRunPolling).toHaveBeenCalledWith(
      expect.objectContaining({ backtestId: 'run-a-001' })
    )
  })
})
