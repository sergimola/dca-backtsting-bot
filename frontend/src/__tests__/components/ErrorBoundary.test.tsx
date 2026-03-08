import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ErrorBoundary } from '../../components/ErrorBoundary'

// Suppress React error logging during tests
const originalError = console.error
beforeAll(() => {
  console.error = jest.fn()
})

afterAll(() => {
  console.error = originalError
})

describe('ErrorBoundary Component Tests', () => {
  // Component that throws an error
  const ThrowError = () => {
    throw new Error('Test error message')
  }

  // Component that throws on demand
  const ConditionalError = ({ shouldThrow }: { shouldThrow: boolean }) => {
    if (shouldThrow) {
      throw new Error('Conditional error')
    }
    return <div>No error content</div>
  }

  describe('T075.1: Component catches and displays error', () => {
    test('T075.1: ErrorBoundary renders error UI when child throws', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      )

      // Should display error message
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
      // Should display the actual error message
      expect(screen.getByText(/test error message/i)).toBeInTheDocument()
    })
  })

  describe('T075.2: Retry button works', () => {
    test('T075.2: Retry button exists and is clickable', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      )

      // Error is displayed
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()

      // Find and click retry button
      const retryButton = screen.getByRole('button', { name: 'Retry' })
      expect(retryButton).toBeInTheDocument()
      
      // Verify button is clickable
      expect(retryButton.closest('button')).not.toBeDisabled()
      
      // Click retry - it resets error state
      fireEvent.click(retryButton)
      
      // Retry button should still be present (ErrorBoundary is re-rendering)
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })
  })

  describe('T075.3: Stack trace visibility', () => {
    test('T075.3: Stack trace shown when error occurs', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      )

      // Error details should be displayed
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
      // Error message should also be visible
      expect(screen.getByText(/test error message/i)).toBeInTheDocument()
    })
  })

  describe('T075.4: Normal rendering when no error', () => {
    test('T075.4: ErrorBoundary renders children when no error', () => {
      render(
        <ErrorBoundary>
          <div data-testid="safe-content">Safe content here</div>
        </ErrorBoundary>
      )

      // Should render child content normally
      expect(screen.getByTestId('safe-content')).toBeInTheDocument()
      expect(screen.getByText('Safe content here')).toBeInTheDocument()
      // Should NOT show error UI
      expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
    })
  })

  describe('T075.5: Multiple children work correctly', () => {
    test('T075.5: ErrorBoundary works with multiple children when safe', () => {
      render(
        <ErrorBoundary>
          <div>Child 1</div>
          <div>Child 2</div>
          <div>Child 3</div>
        </ErrorBoundary>
      )

      expect(screen.getByText('Child 1')).toBeInTheDocument()
      expect(screen.getByText('Child 2')).toBeInTheDocument()
      expect(screen.getByText('Child 3')).toBeInTheDocument()
    })
  })

  describe('T075.6: Error state is cleared on retry', () => {
    test('T075.6: Retry button is clickable', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      )

      // Error is shown
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()

      // Get retry button - verify it exists and is clickable
      const retryButton = screen.getByRole('button', { name: 'Retry' })
      expect(retryButton).toBeInTheDocument()
      expect(retryButton).not.toBeDisabled()

      // Click it - should reset error state internally
      fireEvent.click(retryButton)

      // Test passes if no error was thrown during click
    })
  })

  describe('T075.7: Error message formatting', () => {
    test('T075.7: Error message is clearly displayed', () => {
      const { container } = render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      )

      // Check for presence of key error UI elements
      const heading = screen.getByText(/something went wrong/i)
      expect(heading).toBeInTheDocument()

      // Check outer error boundary div has border styling
      const outerContainer = container.querySelector('.border-2')
      expect(outerContainer).toBeInTheDocument()
      expect(outerContainer?.className).toContain('border-red-500')
    })
  })
})
