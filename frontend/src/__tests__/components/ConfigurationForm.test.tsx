import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigurationForm } from '../../components/ConfigurationForm'
import type { BacktestFormState } from '../../services/types'

/** Fully-valid configuration used across submission and reset tests */
const validValues: BacktestFormState = {
  tradingPair: 'BTC/USDT',
  startDate: '2024-01-01',
  endDate: '2024-01-31',
  priceEntry: '50000',
  priceScale: '1.10',
  amountScale: '2.0',
  numberOfOrders: '5',
  amountPerTrade: '0.10',
  marginType: 'cross',
  multiplier: '1',
  takeProfitDistancePercent: '2.5',
  accountBalance: '1000.00',
  exitOnLastOrder: false,
}

describe('ConfigurationForm', () => {
  const mockOnSubmit = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ─── Rendering ───────────────────────────────────────────────────────────────

  describe('Rendering', () => {
    it('should render all 13 input fields', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      expect(screen.getByLabelText(/trading pair/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/start date/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/end date/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/price entry/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/price scale/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/amount scale/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/number of orders/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/amount per trade/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/margin type/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/multiplier/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/take profit distance/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/account balance/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/exit on last order/i)).toBeInTheDocument()
    })

    it('should render Submit button', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      expect(screen.getByRole('button', { name: /submit|send/i })).toBeInTheDocument()
    })

    it('should render Clear button', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      expect(screen.getByRole('button', { name: /clear|reset/i })).toBeInTheDocument()
    })

    it('should NOT render +Add or Remove buttons (amounts array deleted)', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      expect(screen.queryByRole('button', { name: /^\+$|^add$/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^-$|^remove$/i })).not.toBeInTheDocument()
    })

    it('should render marginType as a <select> with cross/isolated options', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const select = screen.getByLabelText(/margin type/i) as HTMLSelectElement
      expect(select.tagName).toBe('SELECT')
      expect(select).toContainElement(screen.getByRole('option', { name: /cross/i }))
      expect(select).toContainElement(screen.getByRole('option', { name: /isolated/i }))
    })

    it('should render exitOnLastOrder as a checkbox', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const checkbox = screen.getByLabelText(/exit on last order/i) as HTMLInputElement
      expect(checkbox.type).toBe('checkbox')
    })
  })

  // ─── Initial Values ───────────────────────────────────────────────────────────

  describe('Initial Values', () => {
    it('should pre-populate all text fields from initialValues prop', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} initialValues={validValues} />)

      expect(screen.getByDisplayValue('BTC/USDT')).toBeInTheDocument()
      expect(screen.getByDisplayValue('2024-01-01')).toBeInTheDocument()
      expect(screen.getByDisplayValue('2024-01-31')).toBeInTheDocument()
      expect(screen.getByDisplayValue('50000')).toBeInTheDocument()
      expect(screen.getByDisplayValue('1.10')).toBeInTheDocument()
      expect(screen.getByDisplayValue('2.0')).toBeInTheDocument()
      expect(screen.getByDisplayValue('5')).toBeInTheDocument()
      expect(screen.getByDisplayValue('0.10')).toBeInTheDocument()
      expect(screen.getByDisplayValue('1')).toBeInTheDocument()
      expect(screen.getByDisplayValue('2.5')).toBeInTheDocument()
      expect(screen.getByDisplayValue('1000.00')).toBeInTheDocument()
    })

    it('should pre-populate marginType select', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} initialValues={validValues} />)

      const select = screen.getByLabelText(/margin type/i) as HTMLSelectElement
      expect(select.value).toBe('cross')
    })

    it('should pre-populate exitOnLastOrder checkbox', () => {
      render(
        <ConfigurationForm
          onSubmit={mockOnSubmit}
          initialValues={{ ...validValues, exitOnLastOrder: true }}
        />,
      )

      const checkbox = screen.getByLabelText(/exit on last order/i) as HTMLInputElement
      expect(checkbox.checked).toBe(true)
    })
  })

  // ─── Input Changes & Validation ───────────────────────────────────────────────

  describe('Input Changes & Validation', () => {
    it('should update priceEntry on text input', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const input = screen.getByLabelText(/price entry/i)
      await user.type(input, '50000')

      expect(input).toHaveValue('50000')
    })

    it('should show validation error for negative priceEntry on blur', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const input = screen.getByLabelText(/price entry/i)
      await user.type(input, '-5')
      fireEvent.blur(input)

      await waitFor(() => {
        expect(screen.getByText(/price entry must be greater than 0/i)).toBeInTheDocument()
      })
    })

    it('should clear validation error when priceEntry becomes valid', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const input = screen.getByLabelText(/price entry/i)
      await user.type(input, '-5')
      fireEvent.blur(input)

      await waitFor(() => {
        expect(screen.getByText(/price entry must be greater than 0/i)).toBeInTheDocument()
      })

      await user.clear(input)
      await user.type(input, '50000')
      fireEvent.blur(input)

      await waitFor(() => {
        expect(screen.queryByText(/price entry must be greater than 0/i)).not.toBeInTheDocument()
      })
    })

    it('should show error when amountPerTrade > 1', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const input = screen.getByLabelText(/amount per trade/i)
      await user.type(input, '1.5')
      fireEvent.blur(input)

      await waitFor(() => {
        expect(screen.getByText(/amount per trade must be between 0 and 1/i)).toBeInTheDocument()
      })
    })

    it('should show error when multiplier < 1', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const input = screen.getByLabelText(/multiplier/i)
      await user.type(input, '0')
      fireEvent.blur(input)

      await waitFor(() => {
        expect(screen.getByText(/multiplier must be >= 1/i)).toBeInTheDocument()
      })
    })

    it('should update marginType select to isolated', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const select = screen.getByLabelText(/margin type/i)
      await user.selectOptions(select, 'isolated')

      expect((select as HTMLSelectElement).value).toBe('isolated')
    })

    it('should toggle exitOnLastOrder checkbox', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const checkbox = screen.getByLabelText(/exit on last order/i) as HTMLInputElement
      expect(checkbox.checked).toBe(false)

      await user.click(checkbox)
      expect(checkbox.checked).toBe(true)

      await user.click(checkbox)
      expect(checkbox.checked).toBe(false)
    })
  })

  // ─── Form Submission ──────────────────────────────────────────────────────────

  describe('Form Submission', () => {
    it('should disable Submit button when form is empty', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      expect(screen.getByRole('button', { name: /submit|send/i })).toBeDisabled()
    })

    it('should call onSubmit with correct BacktestFormState when all fields are valid', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} initialValues={validValues} />)

      const submitButton = screen.getByRole('button', { name: /submit|send/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            tradingPair: 'BTC/USDT',
            startDate: '2024-01-01',
            priceEntry: '50000',
            priceScale: '1.10',
            numberOfOrders: '5',
            amountPerTrade: '0.10',
            marginType: 'cross',
            multiplier: '1',
            exitOnLastOrder: false,
          }),
        )
      })
    })

    it('should disable Submit button while isSubmitting is true', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} isSubmitting={true} />)

      expect(screen.getByRole('button', { name: /submit|send/i })).toBeDisabled()
    })

    it('should show "Submitting..." text on Submit button during submission', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} isSubmitting={true} />)

      expect(screen.getByRole('button', { name: /submitting/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled()
    })

    it('should show required-field errors when empty form is submitted', async () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const form = screen
        .getByRole('button', { name: /submit|send/i })
        .closest('form') as HTMLFormElement
      fireEvent.submit(form)

      await waitFor(() => {
        expect(screen.getByText(/trading pair is required/i)).toBeInTheDocument()
        expect(screen.getByText(/price entry is required/i)).toBeInTheDocument()
        expect(screen.getByText(/account balance is required/i)).toBeInTheDocument()
      })
    })
  })

  // ─── Clear Button ─────────────────────────────────────────────────────────────

  describe('Clear Button', () => {
    it('should reset form to empty state (no initialValues)', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const priceInput = screen.getByLabelText(/price entry/i) as HTMLInputElement
      await user.type(priceInput, '50000')

      const clearButton = screen.getByRole('button', { name: /clear|reset/i })
      await user.click(clearButton)

      await waitFor(() => {
        expect(priceInput).toHaveValue('')
      })
    })

    it('should reset form to initialValues when Clear is clicked', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} initialValues={validValues} />)

      const priceInput = screen.getByLabelText(/price entry/i) as HTMLInputElement
      await user.clear(priceInput)
      await user.type(priceInput, '99999')

      const clearButton = screen.getByRole('button', { name: /clear|reset/i })
      await user.click(clearButton)

      await waitFor(() => {
        expect(priceInput).toHaveValue('50000')
      })
    })
  })

  // ─── TailwindCSS Styling ──────────────────────────────────────────────────────

  describe('TailwindCSS Styling', () => {
    it('should use TailwindCSS classes for form layout', () => {
      const { container } = render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const form = container.querySelector('form')
      expect(form).toHaveClass(/p-|m-|border|rounded/i)
    })

    it('should render a 2-column grid layout', () => {
      const { container } = render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const grid = container.querySelector('.grid')
      expect(grid).toBeInTheDocument()
      expect(grid).toHaveClass('grid-cols-2')
    })

    it('should style error messages in red', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const input = screen.getByLabelText(/price entry/i)
      await user.type(input, '-5')
      fireEvent.blur(input)

      await waitFor(() => {
        const errorEl = screen.getByText(/price entry must be greater than 0/i)
        expect(errorEl).toHaveClass(/text-red/i)
      })
    })

    it('should style text inputs with TailwindCSS border classes', () => {
      const { container } = render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const textInputs = container.querySelectorAll('input[type="text"]')
      textInputs.forEach((input) => {
        expect(input).toHaveClass(/border|rounded|px|py/i)
      })
    })
  })

  // ─── Edge Cases ───────────────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should accept decimal values for priceEntry', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const input = screen.getByLabelText(/price entry/i)
      await user.type(input, '50000.99')

      expect(input).toHaveValue('50000.99')
    })

    it('should accept amountPerTrade exactly equal to 1 (boundary)', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const input = screen.getByLabelText(/amount per trade/i)
      await user.type(input, '1')
      fireEvent.blur(input)

      await waitFor(() => {
        expect(screen.queryByText(/amount per trade must be between 0 and 1/i)).not.toBeInTheDocument()
      })
    })

    it('should default marginType to "cross"', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const select = screen.getByLabelText(/margin type/i) as HTMLSelectElement
      expect(select.value).toBe('cross')
    })

    it('should default exitOnLastOrder to false', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const checkbox = screen.getByLabelText(/exit on last order/i) as HTMLInputElement
      expect(checkbox.checked).toBe(false)
    })
  })
})

