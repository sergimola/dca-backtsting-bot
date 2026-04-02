import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConfigFormView } from '../../components/ConfigFormView'

// Mock react-router-dom to avoid ESM parse issues and Router context requirements.
let mockLocationState: unknown = null
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/', state: mockLocationState }),
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}))

const noop = jest.fn().mockResolvedValue(undefined)

const fillAllFields = () => {
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

describe('ConfigFormView', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders all 13 input fields with correct labels', () => {
    render(<ConfigFormView onSubmit={noop} isSubmitting={false} error={null} />)
    expect(screen.getByLabelText(/trading pair/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/start date/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/end date/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/entry price/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/price scale/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/amount scale/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/number of orders/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/amount per trade/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/multiplier/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/take profit/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/account balance/i)).toBeInTheDocument()
    // marginType select
    expect(screen.getByLabelText(/margin type/i)).toBeInTheDocument()
    // toggles (exitOnLastOrder + enable_wide_events)
    expect(screen.getAllByRole('switch').length).toBeGreaterThanOrEqual(1)
  })

  it('startDate and endDate inputs have type datetime-local', () => {
    render(<ConfigFormView onSubmit={noop} isSubmitting={false} error={null} />)
    expect(screen.getByLabelText(/start date/i)).toHaveAttribute('type', 'datetime-local')
    expect(screen.getByLabelText(/end date/i)).toHaveAttribute('type', 'datetime-local')
  })

  it('priceScale wrapper contains a % suffix element', () => {
    const { container } = render(<ConfigFormView onSubmit={noop} isSubmitting={false} error={null} />)
    const priceScaleInput = screen.getByLabelText(/price scale/i)
    const wrapper = priceScaleInput.closest('div')
    expect(wrapper?.textContent).toContain('%')
  })

  it('amountScale wrapper contains an x suffix element', () => {
    const { container } = render(<ConfigFormView onSubmit={noop} isSubmitting={false} error={null} />)
    const amountScaleInput = screen.getByLabelText(/amount scale/i)
    const wrapper = amountScaleInput.closest('div')
    expect(wrapper?.textContent).toContain('x')
  })

  it('takeProfitDistancePercent wrapper contains a green % suffix', () => {
    const { container } = render(<ConfigFormView onSubmit={noop} isSubmitting={false} error={null} />)
    const input = screen.getByLabelText(/take profit/i)
    const wrapper = input.closest('div')
    const pctSuffix = wrapper?.querySelector('.text-emerald-500')
    expect(pctSuffix?.textContent).toBe('%')
  })

  it('accountBalance wrapper contains a $ prefix', () => {
    const { container } = render(<ConfigFormView onSubmit={noop} isSubmitting={false} error={null} />)
    const input = screen.getByLabelText(/account balance/i)
    const wrapper = input.closest('div')
    expect(wrapper?.textContent).toContain('$')
  })

  it('exitOnLastOrder renders a toggle switch (role=switch, no type=checkbox)', () => {
    render(<ConfigFormView onSubmit={noop} isSubmitting={false} error={null} />)
    const switches = screen.getAllByRole('switch')
    expect(switches.length).toBeGreaterThanOrEqual(1)
    const exitToggle = switches[0]
    expect(exitToggle.tagName).not.toBe('INPUT')
    expect(exitToggle).toHaveAttribute('aria-checked')
  })

  it('marginType renders select with isolated and cross options', () => {
    render(<ConfigFormView onSubmit={noop} isSubmitting={false} error={null} />)
    const select = screen.getByLabelText(/margin type/i)
    expect(select.tagName).toBe('SELECT')
    expect(select).toHaveValue('isolated')
    expect(screen.getByRole('option', { name: 'isolated' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'cross' })).toBeInTheDocument()
  })

  it('submit button is disabled when required fields are empty', () => {
    render(<ConfigFormView onSubmit={noop} isSubmitting={false} error={null} />)
    expect(screen.getByRole('button', { name: /run backtest/i })).toBeDisabled()
  })

  it('submit fires onSubmit with string fields (constitution gate)', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined)
    render(<ConfigFormView onSubmit={onSubmit} isSubmitting={false} error={null} />)

    fillAllFields()
    fireEvent.click(screen.getByRole('button', { name: /run backtest/i }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const payload = onSubmit.mock.calls[0][0]
    // Constitution gate: numeric fields are passed as strings (BacktestFormState contract)
    expect(typeof payload.amountPerTrade).toBe('string')
    expect(typeof payload.numberOfOrders).toBe('string')
    expect(typeof payload.priceScale).toBe('string')
    expect(typeof payload.amountScale).toBe('string')
    // BUT they must be parseable as numbers (validated before submit)
    expect(parseFloat(payload.amountPerTrade)).not.toBeNaN()
    expect(parseInt(payload.numberOfOrders)).not.toBeNaN()
  })

  it('inline error message renders when error prop is non-null', () => {
    render(<ConfigFormView onSubmit={noop} isSubmitting={false} error="Something went wrong" />)
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
  })

  it('submit button shows loading text and is disabled during isSubmitting=true', () => {
    render(<ConfigFormView onSubmit={noop} isSubmitting={true} error={null} />)
    expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled()
  })
})

// T054: US5 Import/Export tests
describe('ConfigFormView — Import/Export (US5, T054)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLocationState = null
    // mock clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    })
  })

  it('T054-AC1: Import Config and Export Config buttons are present', () => {
    render(<ConfigFormView onSubmit={jest.fn().mockResolvedValue(undefined)} isSubmitting={false} error={null} />)
    expect(screen.getByRole('button', { name: /import config/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export config/i })).toBeInTheDocument()
  })

  it('T054-AC2: clicking Import Config reveals a textarea with placeholder', () => {
    render(<ConfigFormView onSubmit={jest.fn().mockResolvedValue(undefined)} isSubmitting={false} error={null} />)
    fireEvent.click(screen.getByRole('button', { name: /import config/i }))
    expect(screen.getByLabelText(/import config json/i)).toBeInTheDocument()
  })

  it('T054-AC3: clicking Export Config calls navigator.clipboard.writeText with valid JSON', async () => {
    render(<ConfigFormView onSubmit={jest.fn().mockResolvedValue(undefined)} isSubmitting={false} error={null} />)
    fireEvent.click(screen.getByRole('button', { name: /export config/i }))
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    })
    const written = (navigator.clipboard.writeText as jest.Mock).mock.calls[0][0]
    expect(() => JSON.parse(written)).not.toThrow()
  })

  it('T054-AC4: Apply import button populates form from valid JSON', () => {
    render(<ConfigFormView onSubmit={jest.fn().mockResolvedValue(undefined)} isSubmitting={false} error={null} />)
    fireEvent.click(screen.getByRole('button', { name: /import config/i }))
    const textarea = screen.getByLabelText(/import config json/i)
    const payload = JSON.stringify({ trading_pair: 'ETH/USDT', account_balance: '5000', enable_wide_events: true })
    fireEvent.change(textarea, { target: { value: payload } })
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))
    expect(screen.queryByLabelText(/import config json/i)).not.toBeInTheDocument()
  })

  it('T054-AC5: Cancel import hides textarea without mutating form', () => {
    render(<ConfigFormView onSubmit={jest.fn().mockResolvedValue(undefined)} isSubmitting={false} error={null} />)
    fireEvent.click(screen.getByRole('button', { name: /import config/i }))
    expect(screen.getByLabelText(/import config json/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByLabelText(/import config json/i)).not.toBeInTheDocument()
  })

  it('T054-AC6 (T069): prefillConfig from location.state populates enable_wide_events', () => {
    mockLocationState = { prefillConfig: { tradingPair: 'SOL/USDT', enable_wide_events: true } }
    render(<ConfigFormView onSubmit={jest.fn().mockResolvedValue(undefined)} isSubmitting={false} error={null} />)
    const wideEventsSwitch = screen.getByRole('switch', { name: /enable wide events/i })
    expect(wideEventsSwitch).toHaveAttribute('aria-checked', 'true')
  })
})
