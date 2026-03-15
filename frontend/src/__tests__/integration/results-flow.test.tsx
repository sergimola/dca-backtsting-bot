import React from 'react'
import { render, screen } from '@testing-library/react'
import App from '../../App'

jest.mock('../../services/backtest-api', () => ({
  submitBacktest: jest.fn(),
  getStatus: jest.fn(),
  getResults: jest.fn(),
}))

jest.mock('../../hooks/useRunPolling', () => ({
  useRunPolling: jest.fn(),
}))

// Smoke tests: verify the new App shell (replaces old ResultsPage tests)
describe('App shell smoke tests (replaces results-flow)', () => {
  it('renders the sidebar and new backtest button', () => {
    render(<App />)
    expect(screen.getByText(/quantdca/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\+|new backtest/i })).toBeInTheDocument()
  })

  it('renders ConfigFormView on initial load', () => {
    render(<App />)
    expect(screen.getByText(/new backtest/i)).toBeInTheDocument()
  })
})

