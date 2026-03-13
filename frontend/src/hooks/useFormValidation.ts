import { useMemo } from 'react'
import type { BacktestFormState } from '../services/types'

export interface ValidationErrors {
  [key: string]: string | undefined
}

export interface UseFormValidationResult {
  isValid: boolean
  errors: ValidationErrors
}

/**
 * Custom hook for validating BacktestFormState values
 * Returns validation errors for touched fields
 * Completes validation in < 100ms
 */
export function useFormValidation(
  values: Partial<BacktestFormState>,
  touched: Record<string, boolean>,
): UseFormValidationResult {
  return useMemo(() => {
    const errors: ValidationErrors = {}

    if (touched.tradingPair && !values.tradingPair?.trim()) {
      errors.tradingPair = 'Trading pair is required'
    }

    if (touched.startDate) {
      if (!values.startDate) {
        errors.startDate = 'Start date is required'
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.startDate)) {
        errors.startDate = 'Start date must be YYYY-MM-DD'
      }
    }

    if (touched.endDate) {
      if (!values.endDate) {
        errors.endDate = 'End date is required'
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.endDate)) {
        errors.endDate = 'End date must be YYYY-MM-DD'
      }
    }

    if (touched.priceEntry) {
      const n = parseFloat(values.priceEntry || '')
      if (!values.priceEntry || isNaN(n) || n <= 0) {
        errors.priceEntry = 'Price entry must be greater than 0'
      }
    }

    if (touched.priceScale) {
      const n = parseFloat(values.priceScale || '')
      if (!values.priceScale || isNaN(n) || n <= 0) {
        errors.priceScale = 'Price scale must be greater than 0'
      }
    }

    if (touched.amountScale) {
      const n = parseFloat(values.amountScale || '')
      if (!values.amountScale || isNaN(n) || n <= 0) {
        errors.amountScale = 'Amount scale must be greater than 0'
      }
    }

    if (touched.numberOfOrders) {
      const n = parseInt(values.numberOfOrders || '', 10)
      if (!values.numberOfOrders || isNaN(n) || n < 1) {
        errors.numberOfOrders = 'Number of orders must be >= 1'
      }
    }

    if (touched.amountPerTrade) {
      const n = parseFloat(values.amountPerTrade || '')
      if (!values.amountPerTrade || isNaN(n) || n <= 0 || n > 1) {
        errors.amountPerTrade = 'Amount per trade must be between 0 and 1'
      }
    }

    if (touched.multiplier) {
      const n = parseInt(values.multiplier || '', 10)
      if (!values.multiplier || isNaN(n) || n < 1) {
        errors.multiplier = 'Multiplier must be >= 1'
      }
    }

    if (touched.takeProfitDistancePercent) {
      const n = parseFloat(values.takeProfitDistancePercent || '')
      if (!values.takeProfitDistancePercent || isNaN(n) || n <= 0) {
        errors.takeProfitDistancePercent = 'Take profit distance must be greater than 0'
      }
    }

    if (touched.accountBalance) {
      const n = parseFloat(values.accountBalance || '')
      if (!values.accountBalance || isNaN(n) || n <= 0) {
        errors.accountBalance = 'Account balance must be greater than 0'
      }
    }

    const isValid = Object.keys(errors).length === 0

    return { isValid, errors }
  }, [values, touched])
}

