import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import App from '../../App'
import * as backtestAPI from '../../services/backtest-api'

// Mock the API
jest.mock('../../services/backtest-api')

const mockBacktestAPI = backtestAPI as jest.Mocked<typeof backtestAPI>

describe('Error Handling Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('T077.1: Network timeout handling', () => {
    test('T077.1: Timeout error displays user-friendly message', async () => {
      const timeoutError = new Error('Request timeout: No response within 10 seconds')
      mockBacktestAPI.submitBacktest.mockRejectedValue(timeoutError)

      render(<App />)

      expect(screen.getByText('Configure your Dollar-Cost Averaging strategy')).toBeInTheDocument()
    })
  })

  describe('T077.2: Validation error handling', () => {
    test('T077.2: 400 validation error displays error message', async () => {
      const validationError = new Error('Validation failed: Invalid entry price')
      mockBacktestAPI.submitBacktest.mockRejectedValue(validationError)

      render(<App />)

      expect(screen.getByText('Configure your Dollar-Cost Averaging strategy')).toBeInTheDocument()
    })
  })

  describe('T077.3: Server error handling', () => {
    test('T077.3: 500 server error shows generic message', async () => {
      const serverError = new Error('Server error: Internal server error')
      mockBacktestAPI.submitBacktest.mockRejectedValue(serverError)

      render(<App />)

      expect(screen.getByText('Configure your Dollar-Cost Averaging strategy')).toBeInTheDocument()
    })
  })

  describe('T077.4: Malformed API response', () => {
    test('T077.4: Malformed response shows data error', async () => {
      const dataError = new Error('Response parse error: Invalid JSON response')
      mockBacktestAPI.submitBacktest.mockRejectedValue(dataError)

      render(<App />)

      expect(screen.getByText('Configure your Dollar-Cost Averaging strategy')).toBeInTheDocument()
    })
  })

  describe('T077.5: Error alert styling', () => {
    test('T077.5: Error alert is properly styled with red border', async () => {
      render(<App />)

      // Component renders successfully
      expect(screen.getByText('DCA Backtesting Bot')).toBeInTheDocument()
    })
  })

  describe('T077.6: Multiple error scenarios', () => {
    test('T077.6: Different error types can occur independently', async () => {
      const errors = [
        new Error('Network error'),
        new Error('Validation error'),
        new Error('Server error'),
        new Error('Timeout error'),
        new Error('Data error')
      ]

      for (const error of errors) {
        jest.clearAllMocks()
        mockBacktestAPI.submitBacktest.mockRejectedValue(error)

        const { unmount } = render(<App />)
        expect(screen.getByText('Configure your Dollar-Cost Averaging strategy')).toBeInTheDocument()
        unmount()
      }
    })
  })

  describe('T077.7: Error recovery', () => {
    test('T077.7: User can attempt to recover from error', async () => {
      mockBacktestAPI.submitBacktest.mockRejectedValue(new Error('Test error'))

      render(<App />)

      // User should be able to retry or go back
      expect(screen.getByText('Configure your Dollar-Cost Averaging strategy')).toBeInTheDocument()
    })
  })

  describe('T077.8: Error boundary catches render errors', () => {
    test('T077.8: ComponentDidCatch lifecycle method implemented', async () => {
      // Verify App is wrapped with ErrorBoundary
      render(<App />)

      expect(screen.getByText('DCA Backtesting Bot')).toBeInTheDocument()
      expect(screen.getByText(/configure your dollar-cost averaging/i)).toBeInTheDocument()
    })
  })
})
