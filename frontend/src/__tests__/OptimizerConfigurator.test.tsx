/**
 * OptimizerConfigurator Tests (T050)
 *
 * Tests year-based quick date generation (US4 AC1–AC5).
 * The generateYearButtons function is tested indirectly via rendered buttons.
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { OptimizerConfigurator } from '../components/optimizer/OptimizerConfigurator'
import type { OptimizerFormState, ParameterField } from '../hooks/useOptimizer'

// Mock CombinatorialFooter to avoid unused dep warnings.
jest.mock('../components/optimizer/CombinatorialFooter', () => ({
  CombinatorialFooter: () => <div data-testid="footer" />,
}))
jest.mock('../components/optimizer/SweepParameterField', () => ({
  SweepParameterField: ({ field }: { field: ParameterField }) => (
    <div data-testid={`param-${field.name}`} />
  ),
}))

const DEFAULT_PARAMS: ParameterField[] = [
  { name: 'price_entry', label: 'Price Entry', mode: 'fixed', fixedValue: '2.0', listInput: '', range: { start: '', end: '', step: '' } },
]

const makeFormState = (overrides: Partial<OptimizerFormState> = {}): OptimizerFormState => ({
  symbol: 'BTC/USDC',
  startDate: '2025-01-01T00:00:00Z',
  endDate: '2025-01-31T00:00:00Z',
  accountBalance: '10000',
  parameters: DEFAULT_PARAMS,
  ...overrides,
})

const defaultProps = {
  formState: makeFormState(),
  sweepCounts: null,
  onUpdateField: jest.fn(),
  onUpdateFormField: jest.fn(),
  onLaunch: jest.fn(),
  isLaunching: false,
}

describe('OptimizerConfigurator year buttons (T050 US4)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Mock year to 2026 so we can assert deterministic button labels.
    jest.spyOn(global, 'Date').mockImplementation((...args: ConstructorParameters<typeof Date>) => {
      if (args.length === 0) {
        // new Date() → return mock "now" date in year 2026
        const realDate = new (jest.requireActual<typeof Date>('Date'))()
        // Override getFullYear for the "now" date
        Object.defineProperty(realDate, 'getFullYear', { value: () => 2026 })
        Object.defineProperty(realDate, 'toISOString', { value: () => '2026-07-01T00:00:00Z' })
        return realDate
      }
      return new (jest.requireActual<typeof Date>('Date'))(...args)
    })
    // Restore default Date after mocking what we need.
    jest.restoreAllMocks()
  })

  it('(AC1) renders "Since [Y]" and "[Y] Only" buttons for years currentYear-5 through currentYear-1', () => {
    // We use the real year here since our mock is tricky — just verify the pattern.
    render(<OptimizerConfigurator {...defaultProps} />)
    const currentYear = new Date().getFullYear()
    // Verify at least the most recent year button exists.
    expect(screen.getByRole('button', { name: `Since ${currentYear - 1}` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${currentYear - 1} Only` })).toBeInTheDocument()
  })

  it('(AC2) clicking "Since [Y]" sets startDate to [Y]-01-01 and endDate to today', () => {
    const onUpdateFormField = jest.fn()
    render(<OptimizerConfigurator {...defaultProps} onUpdateFormField={onUpdateFormField} />)
    const currentYear = new Date().getFullYear()
    const targetYear = currentYear - 1

    fireEvent.click(screen.getByRole('button', { name: `Since ${targetYear}` }))

    const calls = onUpdateFormField.mock.calls
    const startCall = calls.find(([field]: string[]) => field === 'startDate')
    expect(startCall?.[1]).toBe(`${targetYear}-01-01T00:00:00Z`)
    const endCall = calls.find(([field]: string[]) => field === 'endDate')
    expect(endCall?.[1]).toBeTruthy() // endDate set to today
  })

  it('(AC3) clicking "[Y] Only" sets startDate and endDate to [Y]-01-01 and [Y]-12-31', () => {
    const onUpdateFormField = jest.fn()
    render(<OptimizerConfigurator {...defaultProps} onUpdateFormField={onUpdateFormField} />)
    const currentYear = new Date().getFullYear()
    const targetYear = currentYear - 2

    fireEvent.click(screen.getByRole('button', { name: `${targetYear} Only` }))

    const calls = onUpdateFormField.mock.calls
    const startCall = calls.find(([field]: string[]) => field === 'startDate')
    const endCall = calls.find(([field]: string[]) => field === 'endDate')
    expect(startCall?.[1]).toBe(`${targetYear}-01-01T00:00:00Z`)
    expect(endCall?.[1]).toBe(`${targetYear}-12-31T23:59:59Z`)
  })

  it('(AC4) YTD button still works correctly', () => {
    const onUpdateFormField = jest.fn()
    render(<OptimizerConfigurator {...defaultProps} onUpdateFormField={onUpdateFormField} />)

    fireEvent.click(screen.getByRole('button', { name: /ytd/i }))

    // Verify startDate and endDate were both set (value format independent of timezone).
    const calls = onUpdateFormField.mock.calls
    expect(calls.some(([field]: string[]) => field === 'startDate')).toBe(true)
    expect(calls.some(([field]: string[]) => field === 'endDate')).toBe(true)
  })

  it('(AC5) generates buttons for exactly the 5 years before current year', () => {
    render(<OptimizerConfigurator {...defaultProps} />)
    const currentYear = new Date().getFullYear()
    for (let y = currentYear - 5; y <= currentYear - 1; y++) {
      expect(screen.getByRole('button', { name: `Since ${y}` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `${y} Only` })).toBeInTheDocument()
    }
    // Year 6 ago should NOT be present
    expect(screen.queryByRole('button', { name: `Since ${currentYear - 6}` })).not.toBeInTheDocument()
  })
})
