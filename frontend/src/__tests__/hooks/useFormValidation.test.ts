import { useFormValidation } from '../../hooks/useFormValidation'
import { renderHook } from '@testing-library/react'
import type { BacktestFormState } from '../../services/types'

const validValues: Partial<BacktestFormState> = {
  tradingPair: 'BTC/USDT',
  startDate: '2024-01-01',
  endDate: '2024-01-31',
  priceEntry: '50000',
  priceScale: '1.10',
  amountScale: '2.0',
  numberOfOrders: '5',
  amountPerTrade: '0.10',
  multiplier: '1',
  takeProfitDistancePercent: '2.5',
  accountBalance: '1000.00',
}

const allTouched: Record<string, boolean> = {
  tradingPair: true,
  startDate: true,
  endDate: true,
  priceEntry: true,
  priceScale: true,
  amountScale: true,
  numberOfOrders: true,
  amountPerTrade: true,
  multiplier: true,
  takeProfitDistancePercent: true,
  accountBalance: true,
}

describe('useFormValidation', () => {
  describe('Valid inputs', () => {
    it('should return isValid: true when all fields are correct', () => {
      const { result } = renderHook(() => useFormValidation(validValues, allTouched))
      expect(result.current.isValid).toBe(true)
      expect(result.current.errors).toEqual({})
    })

    it('should accept priceEntry with decimal places', () => {
      const values = { ...validValues, priceEntry: '50000.99' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(true)
    })

    it('should accept amountPerTrade equal to 1 (upper boundary)', () => {
      const values = { ...validValues, amountPerTrade: '1' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(true)
    })

    it('should accept multiplier equal to 1 (lower boundary)', () => {
      const values = { ...validValues, multiplier: '1' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(true)
    })
  })

  describe('Invalid inputs', () => {
    it('should return error for empty tradingPair when touched', () => {
      const values = { ...validValues, tradingPair: '' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.tradingPair).toBeTruthy()
    })

    it('should return error for invalid startDate format', () => {
      const values = { ...validValues, startDate: '01-01-2024' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.startDate).toBeTruthy()
    })

    it('should return error for invalid endDate format', () => {
      const values = { ...validValues, endDate: '2024/01/31' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.endDate).toBeTruthy()
    })

    it('should return error for priceEntry <= 0', () => {
      const values = { ...validValues, priceEntry: '-100' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.priceEntry).toBe('Price entry must be greater than 0')
    })

    it('should return error for priceEntry = 0', () => {
      const values = { ...validValues, priceEntry: '0' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.priceEntry).toBeTruthy()
    })

    it('should return error for priceScale <= 0', () => {
      const values = { ...validValues, priceScale: '0' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.priceScale).toBeTruthy()
    })

    it('should return error for amountScale <= 0', () => {
      const values = { ...validValues, amountScale: '-1' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.amountScale).toBeTruthy()
    })

    it('should return error for numberOfOrders < 1', () => {
      const values = { ...validValues, numberOfOrders: '0' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.numberOfOrders).toBeTruthy()
    })

    it('should return error for amountPerTrade > 1', () => {
      const values = { ...validValues, amountPerTrade: '1.5' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.amountPerTrade).toBe('Amount per trade must be between 0 and 1')
    })

    it('should return error for amountPerTrade <= 0', () => {
      const values = { ...validValues, amountPerTrade: '0' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.amountPerTrade).toBeTruthy()
    })

    it('should return error for multiplier < 1', () => {
      const values = { ...validValues, multiplier: '0' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.multiplier).toBe('Multiplier must be >= 1')
    })

    it('should return error for takeProfitDistancePercent <= 0', () => {
      const values = { ...validValues, takeProfitDistancePercent: '-5' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.takeProfitDistancePercent).toBeTruthy()
    })

    it('should return error for accountBalance <= 0', () => {
      const values = { ...validValues, accountBalance: '0' }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.accountBalance).toBeTruthy()
    })
  })

  describe('Untouched fields do not show errors', () => {
    it('should not show error for untouched tradingPair even if empty', () => {
      const values = { ...validValues, tradingPair: '' }
      const touched = { ...allTouched, tradingPair: false }
      const { result } = renderHook(() => useFormValidation(values, touched))
      expect(result.current.errors.tradingPair).toBeUndefined()
    })

    it('should not show error for untouched priceEntry even if invalid', () => {
      const values = { ...validValues, priceEntry: '-100' }
      const touched = { ...allTouched, priceEntry: false }
      const { result } = renderHook(() => useFormValidation(values, touched))
      expect(result.current.errors.priceEntry).toBeUndefined()
    })

    it('should return isValid: true if no fields are touched', () => {
      const { result } = renderHook(() =>
        useFormValidation({}, {}),
      )
      expect(result.current.isValid).toBe(true)
      expect(result.current.errors).toEqual({})
    })
  })

  describe('Multiple errors', () => {
    it('should collect errors for multiple invalid touched fields', () => {
      const values = {
        ...validValues,
        priceEntry: '-1',
        amountPerTrade: '2',
        multiplier: '0',
      }
      const { result } = renderHook(() => useFormValidation(values, allTouched))
      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.priceEntry).toBeTruthy()
      expect(result.current.errors.amountPerTrade).toBeTruthy()
      expect(result.current.errors.multiplier).toBeTruthy()
    })
  })
})
