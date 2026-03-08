import { useMemo } from 'react'
import type { BacktestConfiguration } from '../services/types'

export interface ValidationErrors {
  [key: string]: string | undefined
}

export interface UseFormValidationResult {
  isValid: boolean
  errors: ValidationErrors
}

/**
 * Custom hook for validating backtest configuration form values
 * Returns validation errors for touched fields
 * Completes validation in < 100ms
 */
export function useFormValidation(
  values: Partial<BacktestConfiguration>,
  touched: Record<string, boolean>
): UseFormValidationResult {
  return useMemo(() => {
    const errors: ValidationErrors = {}

    // Validate entry price
    if (touched.entryPrice) {
      if (values.entryPrice === undefined || values.entryPrice <= 0) {
        errors.entryPrice = 'Entry Price must be greater than 0'
      }
    }

    // Validate amounts array
    if (touched.amounts) {
      if (!values.amounts || values.amounts.length === 0) {
        errors.amounts = 'At least one amount is required'
      } else if (values.amounts.some((amount) => amount <= 0)) {
        errors.amounts = 'All amounts must be greater than 0'
      }
    }

    // Validate sequences (must be integer 1-10)
    if (touched.sequences) {
      if (values.sequences === undefined) {
        errors.sequences = 'Sequences is required'
      } else if (!Number.isInteger(values.sequences)) {
        errors.sequences = 'Sequences must be an integer'
      } else if (values.sequences < 1 || values.sequences > 10) {
        errors.sequences = 'Sequences must be between 1 and 10'
      }
    }

    // Validate leverage
    if (touched.leverage) {
      if (values.leverage === undefined || values.leverage <= 0) {
        errors.leverage = 'Leverage must be greater than 0'
      }
    }

    // Validate margin ratio (0 <= value < 100)
    if (touched.marginRatio) {
      if (
        values.marginRatio === undefined ||
        values.marginRatio < 0 ||
        values.marginRatio >= 100
      ) {
        errors.marginRatio = 'Margin Ratio must be between 0 and less than 100'
      }
    }

    const isValid = Object.keys(errors).length === 0

    return {
      isValid,
      errors,
    }
  }, [values, touched])
}
