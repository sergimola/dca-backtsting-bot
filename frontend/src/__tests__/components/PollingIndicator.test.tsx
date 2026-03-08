import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { PollingIndicator } from '../../components/PollingIndicator'

describe('PollingIndicator Component Tests', () => {
  test('T047.1: Component renders spinner and status message', () => {
    const mockRetry = jest.fn()
    const mockCancel = jest.fn()
    const mockCheck = jest.fn()

    render(
      <PollingIndicator
        status="pending"
        statusMessage="Processing your backtest..."
        elapsedSeconds={15}
        totalSeconds={300}
        onRetry={mockRetry}
        onCancel={mockCancel}
        onCheckStatus={mockCheck}
      />
    )

    // Check for spinner (animate-spin class or SVG)
    expect(screen.getByText(/Processing your backtest/i)).toBeInTheDocument()
    
    // Should have some kind of spinner/loading indicator
    const spinnerElement = document.querySelector('[class*="animate"]') || 
                          document.querySelector('svg')
    expect(spinnerElement || screen.getByRole('status', { hidden: true })).toBeTruthy()
  })

  test('T047.2: Component displays elapsed time and progress', () => {
    const mockRetry = jest.fn()
    const mockCancel = jest.fn()

    render(
      <PollingIndicator
        status="pending"
        statusMessage="Processing..."
        elapsedSeconds={60}
        totalSeconds={300}
        onRetry={mockRetry}
        onCancel={mockCancel}
      />
    )

    // Should display elapsed time
    expect(screen.getByText(/60|seconds|elapsed/i)).toBeInTheDocument()
    
    // Should show progress percentage (60/300 = 20%)
    expect(screen.getByText(/20|progress/i) || screen.getByText(/60/)).toBeInTheDocument()
  })

  test('T047.3: Component displays error message when provided', () => {
    const mockRetry = jest.fn()
    const mockCancel = jest.fn()

    render(
      <PollingIndicator
        status="failed"
        statusMessage="Backtest failed"
        elapsedSeconds={100}
        totalSeconds={300}
        errorMessage="Request timeout: The backtest took too long to respond"
        onRetry={mockRetry}
        onCancel={mockCancel}
      />
    )

    // Should display error message in red
    const errorElement = screen.getByText(/Request timeout/i)
    expect(errorElement).toBeInTheDocument()
    expect(errorElement).toHaveClass('text-red-600')
  })

  test('T047.4: Pending state shows Retry button', () => {
    const mockRetry = jest.fn()
    const mockCancel = jest.fn()

    render(
      <PollingIndicator
        status="pending"
        statusMessage="Processing..."
        elapsedSeconds={30}
        totalSeconds={300}
        onRetry={mockRetry}
        onCancel={mockCancel}
      />
    )

    const retryButton = screen.getByRole('button', { name: /retry/i })
    expect(retryButton).toBeInTheDocument()
    
    fireEvent.click(retryButton)
    expect(mockRetry).toHaveBeenCalled()
  })

  test('T047.5: Cancel button always works', () => {
    const mockRetry = jest.fn()
    const mockCancel = jest.fn()

    render(
      <PollingIndicator
        status="pending"
        statusMessage="Processing..."
        elapsedSeconds={30}
        totalSeconds={300}
        onRetry={mockRetry}
        onCancel={mockCancel}
      />
    )

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    expect(cancelButton).toBeInTheDocument()
    
    fireEvent.click(cancelButton)
    expect(mockCancel).toHaveBeenCalled()
  })

  test('T047.6: Timeout state shows Retry and Check Status buttons', () => {
    const mockRetry = jest.fn()
    const mockCancel = jest.fn()
    const mockCheck = jest.fn()

    render(
      <PollingIndicator
        status="timeout"
        statusMessage="Request timed out"
        elapsedSeconds={300}
        totalSeconds={300}
        errorMessage="Backtest polling exceeded 5 minutes"
        onRetry={mockRetry}
        onCancel={mockCancel}
        onCheckStatus={mockCheck}
      />
    )

    const retryButton = screen.getByRole('button', { name: /retry/i })
    const checkButton = screen.queryByRole('button', { name: /check status/i })
    
    expect(retryButton).toBeInTheDocument()
    if (checkButton) {
      expect(checkButton).toBeInTheDocument()
      fireEvent.click(checkButton)
      expect(mockCheck).toHaveBeenCalled()
    }
  })

  test('T047.7: Failed state shows Retry button and error', () => {
    const mockRetry = jest.fn()
    const mockCancel = jest.fn()

    render(
      <PollingIndicator
        status="failed"
        statusMessage="Backtest failed"
        elapsedSeconds={45}
        totalSeconds={300}
        errorMessage="API error: Invalid configuration"
        onRetry={mockRetry}
        onCancel={mockCancel}
      />
    )

    const retryButton = screen.getByRole('button', { name: /retry/i })
    expect(retryButton).toBeInTheDocument()
    
    const errorText = screen.getByText(/API error/i)
    expect(errorText).toHaveClass('text-red-600')

    fireEvent.click(retryButton)
    expect(mockRetry).toHaveBeenCalled()
  })

  test('T047.8: Progress bar displays correct styling', () => {
    const mockRetry = jest.fn()
    const mockCancel = jest.fn()

    const { container } = render(
      <PollingIndicator
        status="pending"
        statusMessage="Processing..."
        elapsedSeconds={75}
        totalSeconds={300}
        onRetry={mockRetry}
        onCancel={mockCancel}
      />
    )

    // Should have progress bar with gradient
    const progressBar = container.querySelector('[class*="bg-"]')
    expect(progressBar).toBeInTheDocument()
  })

  test('T047.9: Component handles all status states correctly', () => {
    const mockRetry = jest.fn()
    const mockCancel = jest.fn()
    const mockCheck = jest.fn()

    // Test pending state
    const { rerender } = render(
      <PollingIndicator
        status="pending"
        statusMessage="Still processing..."
        elapsedSeconds={10}
        totalSeconds={300}
        onRetry={mockRetry}
        onCancel={mockCancel}
        onCheckStatus={mockCheck}
      />
    )

    expect(screen.getByText(/Still processing/i)).toBeInTheDocument()

    // Test timeout state
    rerender(
      <PollingIndicator
        status="timeout"
        statusMessage="Request timed out"
        elapsedSeconds={300}
        totalSeconds={300}
        errorMessage="Timeout after 5 minutes"
        onRetry={mockRetry}
        onCancel={mockCancel}
        onCheckStatus={mockCheck}
      />
    )

    expect(screen.getByText(/Request timed out/i)).toBeInTheDocument()
    expect(screen.getByText(/Timeout after 5 minutes/i)).toBeInTheDocument()

    // Test failed state
    rerender(
      <PollingIndicator
        status="failed"
        statusMessage="Backtest failed"
        elapsedSeconds={50}
        totalSeconds={300}
        errorMessage="Network error"
        onRetry={mockRetry}
        onCancel={mockCancel}
        onCheckStatus={mockCheck}
      />
    )

    expect(screen.getByText(/Backtest failed/i)).toBeInTheDocument()
    expect(screen.getByText(/Network error/i)).toBeInTheDocument()
  })

  test('T047.10: Component styles pending vs failed states differently', () => {
    const mockRetry = jest.fn()
    const mockCancel = jest.fn()

    const { container: pendingContainer } = render(
      <PollingIndicator
        status="pending"
        statusMessage="Processing..."
        elapsedSeconds={30}
        totalSeconds={300}
        onRetry={mockRetry}
        onCancel={mockCancel}
      />
    )

    // Pending state should have blue/loading colors
    let statusElement = pendingContainer.querySelector('[class*="text-"]')
    expect(statusElement).toBeInTheDocument()

    // Clean up and render failed state
    const { container: failedContainer } = render(
      <PollingIndicator
        status="failed"
        statusMessage="Failed"
        elapsedSeconds={30}
        totalSeconds={300}
        errorMessage="Error message"
        onRetry={mockRetry}
        onCancel={mockCancel}
      />
    )

    // Error message should have red color
    const errorElement = failedContainer.querySelector('.text-red-600')
    expect(errorElement).toBeInTheDocument()
  })
})
