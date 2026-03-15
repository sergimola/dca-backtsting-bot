import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'

// Mock submitBacktest at module boundary (constitution requirement)
jest.mock('../services/backtest-api', () => ({
  submitBacktest: jest.fn(),
  getStatus: jest.fn(),
  getResults: jest.fn(),
}))

// Ensure RunPollingController never actually polls in unit tests
jest.mock('../hooks/useRunPolling', () => ({
  useRunPolling: jest.fn(),
}))

import { submitBacktest } from '../services/backtest-api'
const mockSubmit = submitBacktest as jest.MockedFunction<typeof submitBacktest>

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

describe('App shell state machine', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows ConfigFormView on initial render (no runs)', () => {
    render(<App />)
    expect(screen.getByText(/new backtest/i)).toBeInTheDocument()
  })

  it('shows QuantDCA sidebar header', () => {
    render(<App />)
    expect(screen.getByText(/quantdca/i)).toBeInTheDocument()
  })

  it('clicking + when a run is running shows ConfigFormView without clearing runs', async () => {
    mockSubmit.mockResolvedValue({ backtestId: 'abc-123-def-456' })
    render(<App />)

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /run backtest|start|submit/i }))

    await waitFor(() => {
      // After submit, sidebar should have one RunCard
      expect(screen.queryAllByText(/abc-123/i).length).toBeGreaterThan(0)
    })

    // Click + again
    const plusBtn = screen.getByRole('button', { name: /\+|new backtest/i })
    fireEvent.click(plusBtn)

    // ConfigFormView should be visible again
    expect(screen.getByText(/new backtest/i)).toBeInTheDocument()

    // Run card still in sidebar
    expect(screen.queryAllByText(/abc-123/i).length).toBeGreaterThan(0)
  })

  it('selectedRunId is set to new run after successful submit', async () => {
    mockSubmit.mockResolvedValue({ backtestId: 'run-id-001' })
    render(<App />)

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /run backtest|start|submit/i }))

    await waitFor(() => {
      // run.shortId = 'run-id-0' (first 8 chars), shown in RunCard sidebar
      expect(screen.queryAllByText(/run-id-0/i).length).toBeGreaterThan(0)
    })
  })

  it('when submitBacktest rejects, runs[] stays empty and error is shown', async () => {
    mockSubmit.mockRejectedValue(new Error('Network error'))
    render(<App />)

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /run backtest|start|submit/i }))

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    })

    // No run cards should appear
    expect(screen.queryByText(/processing/i)).not.toBeInTheDocument()
  })
})
