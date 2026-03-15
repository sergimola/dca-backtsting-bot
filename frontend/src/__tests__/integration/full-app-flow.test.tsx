import React from 'react'
import { render, screen } from '@testing-library/react'
import App from '../../App'

jest.mock('../../services/backtest-api', () => ({
  submitBacktest: jest.fn(),
  getStatus: jest.fn(),
  listBacktests: jest.fn().mockResolvedValue([]),
  getResults: jest.fn(),
}))

jest.mock('../../hooks/useRunPolling', () => ({
  useRunPolling: jest.fn(),
}))

describe('App shell smoke tests (replaces full-app-flow)', () => {
  it('renders QuantDCA sidebar header', () => {
    render(<App />)
    expect(screen.getByText(/quantdca/i)).toBeInTheDocument()
  })

  it('renders ConfigFormView on initial load', () => {
    render(<App />)
    expect(screen.getByText(/new backtest/i)).toBeInTheDocument()
  })
})
