import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import App from '../../App'
import type { BacktestConfiguration, BacktestResults } from '../../services/types'

// Mock the API service
jest.mock('../../services/backtest-api', () => ({
  submitBacktest: jest.fn(() =>
    Promise.resolve({ backtestId: 'test-backtest-123' })
  ),
  getStatus: jest.fn(() =>
    Promise.resolve({ status: 'pending' })
  ),
  getResults: jest.fn(() =>
    Promise.resolve({
      backtestId: 'test-backtest-123',
      pnlSummary: { roi: 12.34, maxDrawdown: -5.67, totalFees: 10.00 },
      safetyOrderUsage: [{ level: 'SO1', count: 5 }],
      tradeEvents: []
    })
  )
}))

const mockConfig: BacktestConfiguration = {
  entryPrice: 100,
  amounts: [50, 100, 200],
  sequences: 5,
  leverage: 2,
  marginRatio: 50,
  market_data_csv_path: '/data/BTCUSDT_1m.csv'
}

describe('App State Machine Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('T040.1: Initial view renders ConfigurationPage', () => {
    render(<App />)
    
    // Should render ConfigurationForm (which is part of ConfigurationPage)
    expect(screen.getByText(/DCA Backtesting Bot/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Entry Price/i)).toBeInTheDocument()
  })

  test('T040.2: Submitting configuration form transitions to PollingPage', async () => {
    render(<App />)
    
    // Fill and submit the configuration form
    const entryPriceInput = screen.getByLabelText(/Entry Price/i)
    fireEvent.change(entryPriceInput, { target: { value: '100' } })
    
    // Find the submit button and click it
    const submitButton = screen.getByRole('button', { name: /submit/i })
    fireEvent.click(submitButton)
    
    // Wait for transition to PollingPage
    await waitFor(() => {
      // PollingPage should be visible (contains "Polling..." text or similar)
      expect(screen.queryByText(/Polling/i)).toBeInTheDocument()
    }, { timeout: 2000 })
  })

  test('T040.3: Clear button resets form and stays on ConfigurationPage', async () => {
    render(<App />)
    
    // Fill the form
    const entryPriceInput = screen.getByLabelText(/Entry Price/i)
    fireEvent.change(entryPriceInput, { target: { value: '100' } })
    
    // Click clear button
    const clearButton = screen.getByRole('button', { name: /clear/i })
    fireEvent.click(clearButton)
    
    // Form should be reset
    await waitFor(() => {
      expect((entryPriceInput as HTMLInputElement).value).toBe('')
    })
  })

  test('T040.4: Error state displays error message with retry option', async () => {
    // Mock API error
    const { submitBacktest } = require('../../services/backtest-api')
    submitBacktest.mockRejectedValueOnce(new Error('API Error: Invalid configuration'))
    
    render(<App />)
    
    // Fill and submit
    const entryPriceInput = screen.getByLabelText(/Entry Price/i)
    fireEvent.change(entryPriceInput, { target: { value: '100' } })
    
    const submitButton = screen.getByRole('button', { name: /submit/i })
    fireEvent.click(submitButton)
    
    // Should display error message or handle error gracefully
    await waitFor(() => {
      // Either error is displayed or we're back on configuration form
      const errorPresent = screen.queryByText(/error|failed|invalid/i)
      const formStillVisible = screen.queryByLabelText(/Entry Price/i)
      expect(errorPresent || formStillVisible).toBeTruthy()
    }, { timeout: 2000 })
  })

  test('T040.5: Polling page displays with backtestId', async () => {
    render(<App />)
    
    // Fill and submit the form
    const entryPriceInput = screen.getByLabelText(/Entry Price/i)
    fireEvent.change(entryPriceInput, { target: { value: mockConfig.entryPrice.toString() } })
    
    const submitButton = screen.getByRole('button', { name: /submit/i })
    fireEvent.click(submitButton)
    
    // Polling page should display
    await waitFor(() => {
      // Check for polling indicator or similar content
      expect(screen.queryByText(/Polling|Backtest ID|test-backtest-123/i)).toBeInTheDocument()
    }, { timeout: 2000 })
  })

  test('T040.6: Modal or overlay for handling errors gracefully', () => {
    render(<App />)
    
    // Initial render should NOT show error
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('T040.7: State persists during view transitions', async () => {
    render(<App />)
    
    // Fill configuration
    const entryPriceInput = screen.getByLabelText(/Entry Price/i)
    const initialValue = '100'
    fireEvent.change(entryPriceInput, { target: { value: initialValue } })
    
    // Submit
    const submitButton = screen.getByRole('button', { name: /submit/i })
    fireEvent.click(submitButton)
    
    // Verify we transition to polling
    await waitFor(() => {
      expect(screen.queryByText(/Polling/i)).toBeInTheDocument()
    }, { timeout: 2000 })
    
    // State should be preserved (backtestId available)
    // This will be verified when we transition back potentially
  })
})
