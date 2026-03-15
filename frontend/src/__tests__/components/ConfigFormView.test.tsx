import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConfigFormView } from '../../components/ConfigFormView'

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
    // exitOnLastOrder toggle (role=switch)
    expect(screen.getByRole('switch')).toBeInTheDocument()
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
    const toggle = screen.getByRole('switch')
    expect(toggle.tagName).not.toBe('INPUT')
    expect(toggle).toHaveAttribute('aria-checked')
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
