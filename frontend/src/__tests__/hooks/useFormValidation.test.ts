import { useFormValidation } from '../../hooks/useFormValidation'
import { renderHook, act } from '@testing-library/react'

describe('useFormValidation', () => {
  describe('Valid inputs', () => {
    it('should return isValid: true when all fields are correct', () => {
      const values = {
        entryPrice: 50000,
        amounts: [100, 200, 300],
        sequences: 5,
        leverage: 2,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(true)
      expect(result.current.errors).toEqual({})
    })

    it('should accept entry price with decimals (max 2)', () => {
      const values = {
        entryPrice: 50000.99,
        amounts: [100, 200],
        sequences: 3,
        leverage: 1.5,
        marginRatio: 75,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(true)
    })

    it('should handle minimum valid leverage (0.1)', () => {
      const values = {
        entryPrice: 100,
        amounts: [10],
        sequences: 1,
        leverage: 0.1,
        marginRatio: 10,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(true)
    })

    it('should handle maximum sequences (10)', () => {
      const values = {
        entryPrice: 100,
        amounts: [10],
        sequences: 10,
        leverage: 1,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(true)
    })

    it('should handle margin ratio boundaries (0 to <100)', () => {
      const { result: result1 } = renderHook(() =>
        useFormValidation(
          {
            entryPrice: 100,
            amounts: [10],
            sequences: 1,
            leverage: 1,
            marginRatio: 0,
          },
          {
            entryPrice: true,
            amounts: true,
            sequences: true,
            leverage: true,
            marginRatio: true,
          }
        )
      )
      expect(result1.current.isValid).toBe(true)

      const { result: result2 } = renderHook(() =>
        useFormValidation(
          {
            entryPrice: 100,
            amounts: [10],
            sequences: 1,
            leverage: 1,
            marginRatio: 99.99,
          },
          {
            entryPrice: true,
            amounts: true,
            sequences: true,
            leverage: true,
            marginRatio: true,
          }
        )
      )
      expect(result2.current.isValid).toBe(true)
    })
  })

  describe('Entry Price validation', () => {
    it('should reject entry price <= 0', () => {
      const values = {
        entryPrice: 0,
        amounts: [100],
        sequences: 1,
        leverage: 1,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.entryPrice).toBe(
        'Entry Price must be greater than 0'
      )
    })

    it('should reject negative entry price', () => {
      const values = {
        entryPrice: -100,
        amounts: [100],
        sequences: 1,
        leverage: 1,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.entryPrice).toBe(
        'Entry Price must be greater than 0'
      )
    })

    it('should not validate entry price if not touched', () => {
      const values = {
        entryPrice: 0,
        amounts: [100],
        sequences: 1,
        leverage: 1,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: false,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.errors.entryPrice).toBeUndefined()
    })
  })

  describe('Amounts validation', () => {
    it('should reject empty amounts array', () => {
      const values = {
        entryPrice: 100,
        amounts: [],
        sequences: 1,
        leverage: 1,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.amounts).toBe(
        'At least one amount is required'
      )
    })

    it('should reject amounts with zero or negative values', () => {
      const values = {
        entryPrice: 100,
        amounts: [100, 0, 50],
        sequences: 1,
        leverage: 1,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.amounts).toContain('must be greater than 0')
    })

    it('should reject amounts with negative values', () => {
      const values = {
        entryPrice: 100,
        amounts: [100, -50],
        sequences: 1,
        leverage: 1,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.amounts).toContain('must be greater than 0')
    })

    it('should accept multiple valid amounts', () => {
      const values = {
        entryPrice: 100,
        amounts: [100, 200, 300, 400, 500],
        sequences: 5,
        leverage: 1,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(true)
      expect(result.current.errors.amounts).toBeUndefined()
    })

    it('should not validate amounts if not touched', () => {
      const values = {
        entryPrice: 100,
        amounts: [],
        sequences: 1,
        leverage: 1,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: false,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.errors.amounts).toBeUndefined()
    })
  })

  describe('Sequences validation', () => {
    it('should reject sequences < 1', () => {
      const values = {
        entryPrice: 100,
        amounts: [100],
        sequences: 0,
        leverage: 1,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.sequences).toContain('must be between 1 and 10')
    })

    it('should reject sequences > 10', () => {
      const values = {
        entryPrice: 100,
        amounts: [100],
        sequences: 11,
        leverage: 1,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.sequences).toContain('must be between 1 and 10')
    })

    it('should reject non-integer sequences', () => {
      const values = {
        entryPrice: 100,
        amounts: [100],
        sequences: 5.5,
        leverage: 1,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.sequences).toContain('must be an integer')
    })

    it('should accept valid sequences (1-10)', () => {
      for (let i = 1; i <= 10; i++) {
        const values = {
          entryPrice: 100,
          amounts: [100],
          sequences: i,
          leverage: 1,
          marginRatio: 50,
        }
        const touched = {
          entryPrice: true,
          amounts: true,
          sequences: true,
          leverage: true,
          marginRatio: true,
        }

        const { result } = renderHook(() => useFormValidation(values, touched))

        expect(result.current.isValid).toBe(true)
        expect(result.current.errors.sequences).toBeUndefined()
      }
    })

    it('should not validate sequences if not touched', () => {
      const values = {
        entryPrice: 100,
        amounts: [100],
        sequences: 0,
        leverage: 1,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: false,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.errors.sequences).toBeUndefined()
    })
  })

  describe('Leverage validation', () => {
    it('should reject leverage <= 0', () => {
      const values = {
        entryPrice: 100,
        amounts: [100],
        sequences: 1,
        leverage: 0,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.leverage).toBe(
        'Leverage must be greater than 0'
      )
    })

    it('should reject negative leverage', () => {
      const values = {
        entryPrice: 100,
        amounts: [100],
        sequences: 1,
        leverage: -1,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.leverage).toBe(
        'Leverage must be greater than 0'
      )
    })

    it('should not validate leverage if not touched', () => {
      const values = {
        entryPrice: 100,
        amounts: [100],
        sequences: 1,
        leverage: 0,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: false,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.errors.leverage).toBeUndefined()
    })
  })

  describe('Margin Ratio validation', () => {
    it('should reject margin ratio < 0', () => {
      const values = {
        entryPrice: 100,
        amounts: [100],
        sequences: 1,
        leverage: 1,
        marginRatio: -1,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.marginRatio).toContain('must be between 0 and')
    })

    it('should reject margin ratio >= 100', () => {
      const values = {
        entryPrice: 100,
        amounts: [100],
        sequences: 1,
        leverage: 1,
        marginRatio: 100,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(false)
      expect(result.current.errors.marginRatio).toContain('must be between 0 and')
    })

    it('should accept margin ratio at boundaries', () => {
      const { result: result1 } = renderHook(() =>
        useFormValidation(
          {
            entryPrice: 100,
            amounts: [100],
            sequences: 1,
            leverage: 1,
            marginRatio: 0,
          },
          {
            entryPrice: true,
            amounts: true,
            sequences: true,
            leverage: true,
            marginRatio: true,
          }
        )
      )
      expect(result1.current.isValid).toBe(true)

      const { result: result2 } = renderHook(() =>
        useFormValidation(
          {
            entryPrice: 100,
            amounts: [100],
            sequences: 1,
            leverage: 1,
            marginRatio: 99.99,
          },
          {
            entryPrice: true,
            amounts: true,
            sequences: true,
            leverage: true,
            marginRatio: true,
          }
        )
      )
      expect(result2.current.isValid).toBe(true)
    })

    it('should not validate margin ratio if not touched', () => {
      const values = {
        entryPrice: 100,
        amounts: [100],
        sequences: 1,
        leverage: 1,
        marginRatio: -1,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: false,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.errors.marginRatio).toBeUndefined()
    })
  })

  describe('Performance', () => {
    it('should validate all fields within 100ms', () => {
      const values = {
        entryPrice: 50000,
        amounts: [100, 200, 300],
        sequences: 5,
        leverage: 2,
        marginRatio: 50,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const startTime = performance.now()
      const { result } = renderHook(() => useFormValidation(values, touched))
      const endTime = performance.now()

      const executionTime = endTime - startTime
      expect(executionTime).toBeLessThan(100)
      expect(result.current.isValid).toBe(true)
    })
  })

  describe('Multiple validation errors', () => {
    it('should return multiple errors for invalid fields', () => {
      const values = {
        entryPrice: -100,
        amounts: [],
        sequences: 15,
        leverage: -1,
        marginRatio: 150,
      }
      const touched = {
        entryPrice: true,
        amounts: true,
        sequences: true,
        leverage: true,
        marginRatio: true,
      }

      const { result } = renderHook(() => useFormValidation(values, touched))

      expect(result.current.isValid).toBe(false)
      expect(Object.keys(result.current.errors).length).toBeGreaterThan(2)
      expect(result.current.errors.entryPrice).toBeDefined()
      expect(result.current.errors.amounts).toBeDefined()
      expect(result.current.errors.sequences).toBeDefined()
      expect(result.current.errors.leverage).toBeDefined()
      expect(result.current.errors.marginRatio).toBeDefined()
    })
  })
})
