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

jest.mock('../../hooks/useResultsMetrics', () => ({
  useResultsMetrics: jest.fn(() => ({
    netProfit: 60,
    totalFees: 6,
    roi: 6,
    winRate: 80,
    profitFactor: 2.5,
    capitalUtilized: 45,
    maxDrawdown: -2,
    accountEquity: 1060,
    tradeGroups: [],
    safetyOrderUsage: [],
  })),
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

describe('App state machine — sidebar navigation (T033)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseRunPolling.mockReturnValue(undefined as any)
  })

  it('initial state shows ConfigFormView (no runs)', () => {
    render(<App />)
    expect(screen.getByText(/new backtest/i)).toBeInTheDocument()
  })

  it('sidebar shows QuantDCA header', () => {
    render(<App />)
    expect(screen.getByText(/quantdca/i)).toBeInTheDocument()
  })

  it('clicking + from any view shows ConfigFormView', async () => {
    mockSubmit.mockResolvedValue({ backtestId: 'nav-run-001' })
    render(<App />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /run backtest|start|submit/i }))

    await waitFor(() => {
      expect(screen.queryAllByText(/nav-run-/i).length).toBeGreaterThan(0)
    })

    const plusBtn = screen.getByRole('button', { name: /\+|new backtest/i })
    fireEvent.click(plusBtn)
    expect(screen.getByText(/new backtest/i)).toBeInTheDocument()
  })

  it('runs remain in sidebar when clicking +', async () => {
    mockSubmit.mockResolvedValue({ backtestId: 'persist-run-001' })
    render(<App />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /run backtest|start|submit/i }))

    await waitFor(() => {
      expect(screen.queryAllByText(/persist-/i).length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: /\+|new backtest/i }))
    // Run card still in sidebar
    expect(screen.queryAllByText(/persist-/i).length).toBeGreaterThan(0)
  })
})
