import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigurationForm } from '../../components/ConfigurationForm'
import type { BacktestConfiguration } from '../../services/types'

describe('ConfigurationForm', () => {
  const mockOnSubmit = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render form with all 5 input fields', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      expect(screen.getByLabelText(/entry price/i)).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/e\.g\., 100/i)).toBeInTheDocument() // Amounts placeholder
      expect(screen.getByLabelText(/sequences/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/leverage/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/margin ratio/i)).toBeInTheDocument()
    })

    it('should render Submit button', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      expect(screen.getByRole('button', { name: /submit|send/i })).toBeInTheDocument()
    })

    it('should render Clear button', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      expect(screen.getByRole('button', { name: /clear|reset/i })).toBeInTheDocument()
    })

    it('should render +Add button for amounts array', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const addButton = screen.getByRole('button', { name: /\+|add/i })
      expect(addButton).toBeInTheDocument()
    })
  })

  describe('Initial Values', () => {
    it ('should pre-populate form with initialValues prop', () => {
      const initialValues: BacktestConfiguration = {
        entryPrice: 50000,
        amounts: [100, 200],
        sequences: 5,
        leverage: 2,
        marginRatio: 50,
      }

      render(<ConfigurationForm onSubmit={mockOnSubmit} initialValues={initialValues} />)

      expect(screen.getByDisplayValue('50000')).toBeInTheDocument()
      expect(screen.getByDisplayValue('100')).toBeInTheDocument()
      expect(screen.getByDisplayValue('200')).toBeInTheDocument()
      expect(screen.getByDisplayValue('5')).toBeInTheDocument()
      expect(screen.getByDisplayValue('2')).toBeInTheDocument()
      expect(screen.getByDisplayValue('50')).toBeInTheDocument()
    })
  })

  describe('Input Changes & Validation', () => {
    it('should update entryPrice on input change', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const entryPriceInput = screen.getByLabelText(/entry price/i)
      await user.type(entryPriceInput, '50000')

      expect(entryPriceInput).toHaveValue(50000)
    })

    it('should show validation error for invalid entryPrice', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const entryPriceInput = screen.getByLabelText(/entry price/i) as HTMLInputElement
      await user.type(entryPriceInput, '0')
      fireEvent.blur(entryPriceInput)

      await waitFor(() => {
        expect(screen.getByText(/entry price must be greater than 0/i)).toBeInTheDocument()
      })
    })

    it('should clear validation error when input becomes valid', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const entryPriceInput = screen.getByLabelText(/entry price/i) as HTMLInputElement
      
      // First make it invalid
      await user.type(entryPriceInput, '0')
      fireEvent.blur(entryPriceInput)

      await waitFor(() => {
        expect(screen.getByText(/entry price must be greater than 0/i)).toBeInTheDocument()
      })

      // Then fix it
      await user.clear(entryPriceInput)
      await user.type(entryPriceInput, '50000')
      fireEvent.blur(entryPriceInput)

      await waitFor(() => {
        expect(screen.queryByText(/entry price must be greater than 0/i)).not.toBeInTheDocument()
      })
    })

    it('should validate all fields on input', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const sequencesInput = screen.getByLabelText(/sequences/i) as HTMLInputElement
      await user.type(sequencesInput, '15')
      fireEvent.blur(sequencesInput)

      await waitFor(() => {
        expect(screen.getByText(/sequences must be between 1 and 10/i)).toBeInTheDocument()
      })
    })
  })

  describe('Dynamic Amounts Array (T032)', () => {
    it('should add new amount input when +Add button clicked', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const initialAmounts = screen.getAllByPlaceholderText(/e\.g\., 100/i)
      const initialCount = initialAmounts.length

      const addButton = screen.getByRole('button', { name: /\+|add/i })
      await user.click(addButton)

      await waitFor(() => {
        const updatedAmounts = screen.getAllByPlaceholderText(/e\.g\., 100/i)
        expect(updatedAmounts.length).toBe(initialCount + 1)
      })
    })

    it('should have Remove button for each amount > 1', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const addButton = screen.getByRole('button', { name: /\+|add/i })
      
      // Add second amount
      await user.click(addButton)

      await waitFor(() => {
        const removeButtons = screen.getAllByRole('button', { name: /-|remove/i })
        expect(removeButtons.length).toBeGreaterThan(0)
      })
    })

    it('should remove amount when Remove button clicked', async () => {
      const user = userEvent.setup()
      const initialValues: BacktestConfiguration = {
        entryPrice: 50000,
        amounts: [100, 200],
        sequences: 5,
        leverage: 2,
        marginRatio: 50,
      }

      render(<ConfigurationForm onSubmit={mockOnSubmit} initialValues={initialValues} />)

      const removeButtons = screen.getAllByRole('button', { name: /-|remove/i })
      expect(removeButtons.length).toBeGreaterThan(0)

      await user.click(removeButtons[0])

      await waitFor(() => {
        const amountInputs = screen.getAllByPlaceholderText(/e\.g\., 100/i)
        expect(amountInputs.length).toBe(1)
      })
    })

    it('should not allow removing the last amount', async () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const removeButtons = screen.queryAllByRole('button', { name: /-|remove/i })
      expect(removeButtons.length).toBe(0) // No remove button if only 1 amount
    })

    it('should allow adding multiple amounts', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const addButton = screen.getByRole('button', { name: /\+|add/i })

      for (let i = 0; i < 3; i++) {
        await user.click(addButton)
      }

      await waitFor(() => {
        const amountInputs = screen.getAllByPlaceholderText(/e\.g\., 100/i)
        expect(amountInputs.length).toBe(4) // 1 original + 3 added
      })
    })
  })

  describe('Form Submission', () => {
    it('should disable Submit button when form is invalid', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const submitButton = screen.getByRole('button', { name: /submit|send/i })
      expect(submitButton).toBeDisabled()
    })

    it('should call onSubmit with correct configuration when form submitted', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const entryPriceInput = screen.getByLabelText(/entry price/i)
      const amountsInputs = screen.getAllByPlaceholderText(/e\.g\., 100/i) // Use placeholder for amounts
      const sequencesInput = screen.getByLabelText(/sequences/i)
      const leverageInput = screen.getByLabelText(/leverage/i)
      const marginRatioInput = screen.getByLabelText(/margin ratio/i)

      await user.type(entryPriceInput, '50000')
      await user.type(amountsInputs[0], '100')
      await user.type(sequencesInput, '5')
      await user.type(leverageInput, '2')
      await user.type(marginRatioInput, '50')

      const submitButton = screen.getByRole('button', { name: /submit|send/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            entryPrice: 50000,
            sequences: 5,
            leverage: 2,
            marginRatio: 50,
          })
        )
      })
    })

    it('should disable Submit button while submitting', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} isSubmitting={true} />)

      const submitButton = screen.getByRole('button', { name: /submit|send/i })
      expect(submitButton).toBeDisabled()
    })

    it('should show spinner on Submit button during submission', () => {
      render(<ConfigurationForm onSubmit={mockOnSubmit} isSubmitting={true} />)

      const submitButton = screen.getByRole('button', { name: /submitting/i })
      expect(submitButton).toBeInTheDocument()
      expect(submitButton).toBeDisabled()
    })
  })

  describe('Clear Button', () => {
    it('should reset form to initial values when Clear button clicked', async () => {
      const user = userEvent.setup()
      const initialValues: BacktestConfiguration = {
        entryPrice: 50000,
        amounts: [100],
        sequences: 5,
        leverage: 2,
        marginRatio: 50,
      }

      render(<ConfigurationForm onSubmit={mockOnSubmit} initialValues={initialValues} />)

      const entryPriceInput = screen.getByLabelText(/entry price/i) as HTMLInputElement
      await user.clear(entryPriceInput)
      await user.type(entryPriceInput, '60000')

      const clearButton = screen.getByRole('button', { name: /clear|reset/i })
      await user.click(clearButton)

      await waitFor(() => {
        expect(entryPriceInput).toHaveValue(50000)
      })
    })
  })

  describe('TailwindCSS Styling', () => {
    it('should use TailwindCSS classes for form layout', () => {
      const { container } = render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const form = container.querySelector('form')
      expect(form).toHaveClass(/p-|m-|border|rounded/i)
    })

    it('should style error messages in red with TailwindCSS', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const entryPriceInput = screen.getByLabelText(/entry price/i) as HTMLInputElement
      await user.type(entryPriceInput, '0')
      fireEvent.blur(entryPriceInput)

      await waitFor(() => {
        const errorElement = screen.getByText(/entry price must be greater than 0/i)
        expect(errorElement).toHaveClass(/text-red|text-danger/i)
      })
    })

    it('should style inputs with TailwindCSS', () => {
      const { container } = render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const inputs = container.querySelectorAll('input')
      inputs.forEach((input) => {
        expect(input).toHaveClass(/border|rounded|px|py/i)
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle decimal values for entryPrice', async () => {
      const user = userEvent.setup()
      render(<ConfigurationForm onSubmit={mockOnSubmit} />)

      const entryPriceInput = screen.getByLabelText(/entry price/i)
      await user.type(entryPriceInput, '50000.99')

      expect(entryPriceInput).toHaveValue(50000.99)
    })

    it('should handle form with only 1 amount (minimum)', async () => {
      const initialValues: BacktestConfiguration = {
        entryPrice: 50000,
        amounts: [100],
        sequences: 1,
        leverage: 1,
        marginRatio: 50,
      }

      render(<ConfigurationForm onSubmit={mockOnSubmit} initialValues={initialValues} />)

      const amountInputs = screen.getAllByPlaceholderText(/e\.g\., 100/i)
      expect(amountInputs.length).toBe(1)
    })
  })
})

// Helper function (to be replaced with proper React Testing Library utilities)
function renderConfigurationForm(component: React.ReactElement) {
  return render(component)
}
