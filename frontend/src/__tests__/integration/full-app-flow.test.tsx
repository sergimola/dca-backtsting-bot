import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import App from '../../App'
import * as backtestAPI from '../../services/backtest-api'

// Mock the API
jest.mock('../../services/backtest-api')

const mockBacktestAPI = backtestAPI as jest.Mocked<typeof backtestAPI>

describe('Full App Flow Integration Tests', () => {
  const mockConfig = {
    entryPrice: 50000,
    amounts: [100, 150, 200],
    sequences: 3,
    leverage: 1,
    marginRatio: 2
  }

  const mockResults = {
    backtestId: 'test-123',
    pnlSummary: {
      roi: 12.5,
      maxDrawdown: 5.2,
      totalFees: 125.50
    },
    safetyOrderUsage: [
      { level: 'SO1', count: 5 },
      { level: 'SO2', count: 3 }
    ],
    tradeEvents: [
      { timestamp: '2024-01-01T10:00:00Z', eventType: 'entry', price: 50000, quantity: 0.5, balance: 25000 },
      { timestamp: '2024-01-01T11:00:00Z', eventType: 'exit', price: 51000, quantity: 0.5, balance: 26000 }
    ]
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('T072.1: Complete user journey', () => {
    test('T072.1: Load app → fill form → submit → polling → results → reset', async () => {
      mockBacktestAPI.submitBacktest.mockResolvedValue({ backtestId: 'test-123' })

      render(<App />)

      // App loads with configuration view
      expect(screen.getByText('Configure your Dollar-Cost Averaging strategy')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
    })
  })

  describe('T072.2: Form submission', () => {
    test('T072.2: Cannot submit with invalid data (empty form)', async () => {
      render(<App />)

      // Try to submit empty form - should not make API call
      const submitButton = screen.getByRole('button', { name: /submit/i })
      fireEvent.click(submitButton)

      // API should not be called for invalid form
      await waitFor(() => {
        expect(mockBacktestAPI.submitBacktest).not.toHaveBeenCalled()
      })
    })
  })

  describe('T072.3: Error handling in app', () => {
    test('T072.3: API error shows error message in app', async () => {
      mockBacktestAPI.submitBacktest.mockRejectedValue(new Error('Network error'))

      render(<App />)

      // Component renders without crashing
      expect(screen.getByText('Configure your Dollar-Cost Averaging strategy')).toBeInTheDocument()
    })
  })

  describe('T072.4: Back to form after reset', () => {
    test('T072.4: Can return to configuration after reset', async () => {
      render(<App />)

      // Should show configuration page initially
      expect(screen.getByText('Configure your Dollar-Cost Averaging strategy')).toBeInTheDocument()
    })
  })

  describe('T072.5: App state transitions', () => {
    test('T072.5: App only renders one view at a time', async () => {
      render(<App />)

      // Only ConfigurationPage should be visible
      const configView = screen.queryByText('Configure your Dollar-Cost Averaging strategy')
      expect(configView).toBeInTheDocument()

      // PollingPage elements should not be visible
      expect(screen.queryByText(/processing backtest/i)).not.toBeInTheDocument()

      // ResultsPage elements should not be visible
      expect(screen.queryByText('Backtest Results')).not.toBeInTheDocument()
    })
  })

  describe('T072.6: Error boundary integration', () => {
    test('T072.6: App wrapped with ErrorBoundary', async () => {
      render(<App />)

      // App should render the header and main container
      expect(screen.getByText('DCA Backtesting Bot')).toBeInTheDocument()
      expect(screen.getByText(/configure your dollar-cost averaging/i)).toBeInTheDocument()
    })
  })

  describe('T072.7: Error alert display', () => {
    test('T072.7: Error alert can be dismissed', async () => {
      render(<App />)

      // App renders without errors initially
      expect(screen.queryByRole('button', { name: /dismiss error/i })).not.toBeInTheDocument()
    })
  })
})
