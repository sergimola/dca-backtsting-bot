import {
  formatCurrency,
  formatCryptoQuantity,
  formatPercentage,
} from '../../services/formatters'

describe('Formatters', () => {
  describe('formatCurrency', () => {
    it('should format currency with default 2 decimals and dollar sign', () => {
      const result = formatCurrency(1234.5678)
      expect(result).toBe('$1234.57')
    })

    it('should round to 2 decimals by default', () => {
      expect(formatCurrency(99.999)).toBe('$100.00')
      expect(formatCurrency(99.994)).toBe('$99.99')
    })

    it('should handle whole numbers', () => {
      expect(formatCurrency(1000)).toBe('$1000.00')
    })

    it('should handle small decimals', () => {
      expect(formatCurrency(0.01)).toBe('$0.01')
      expect(formatCurrency(0.005)).toBe('$0.01')
    })

    it('should handle zero', () => {
      expect(formatCurrency(0)).toBe('$0.00')
    })

    it('should handle negative numbers with minus sign', () => {
      expect(formatCurrency(-1234.5678)).toBe('-$1234.57')
    })

    it('should support custom decimal places', () => {
      expect(formatCurrency(1234.56789, 3)).toBe('$1234.568')
      expect(formatCurrency(1234.56789, 1)).toBe('$1234.6')
      expect(formatCurrency(1234.56789, 0)).toBe('$1235')
    })

    it('should handle large numbers with proper formatting', () => {
      expect(formatCurrency(1000000)).toBe('$1000000.00')
      expect(formatCurrency(50000.123)).toBe('$50000.12')
    })

    it('should include comma thousands separator for readability (optional)', () => {
      // This test documents the expected behavior if comma separators are included
      const result = formatCurrency(1234567.89)
      // Result should be either '$1234567.89' or '$1,234,567.89'
      expect(result).toMatch(/^\$[\d,]+\.\d{2}$/)
    })
  })

  describe('formatCryptoQuantity', () => {
    it('should format crypto quantity with 8 decimals', () => {
      const result = formatCryptoQuantity(0.123456789)
      expect(result).toBe('0.12345679')
    })

    it('should round to 8 decimals', () => {
      expect(formatCryptoQuantity(0.123456784)).toBe('0.12345678')
      expect(formatCryptoQuantity(0.123456789)).toBe('0.12345679')
    })

    it('should handle whole numbers', () => {
      expect(formatCryptoQuantity(1)).toBe('1.00000000')
      expect(formatCryptoQuantity(10)).toBe('10.00000000')
    })

    it('should handle small quantities', () => {
      expect(formatCryptoQuantity(0.00000001)).toBe('0.00000001')
      expect(formatCryptoQuantity(0.000000001)).toBe('0.00000000')
    })

    it('should handle zero', () => {
      expect(formatCryptoQuantity(0)).toBe('0.00000000')
    })

    it('should handle negative quantities (for display purposes)', () => {
      expect(formatCryptoQuantity(-0.5)).toBe('-0.50000000')
    })

    it('should support custom decimal places', () => {
      expect(formatCryptoQuantity(0.123456789, 2)).toBe('0.12')
      expect(formatCryptoQuantity(0.123456789, 4)).toBe('0.1235')
      expect(formatCryptoQuantity(0.123456789, 6)).toBe('0.123457')
    })

    it('should preserve leading zeros', () => {
      expect(formatCryptoQuantity(0.00100000)).toBe('0.00100000')
    })

    it('should handle large crypto quantities', () => {
      expect(formatCryptoQuantity(21000000)).toBe('21000000.00000000')
    })

    it('should not include dollar sign', () => {
      const result = formatCryptoQuantity(1.5)
      expect(result).not.toContain('$')
      expect(result).toMatch(/^\d+\.\d{8}$/)
    })
  })

  describe('formatPercentage', () => {
    it('should format percentage with 2 decimals and percent sign', () => {
      const result = formatPercentage(12.3456)
      expect(result).toBe('12.35%')
    })

    it('should round to 2 decimals', () => {
      expect(formatPercentage(99.999)).toBe('100.00%')
      expect(formatPercentage(99.994)).toBe('99.99%')
    })

    it('should handle whole numbers', () => {
      expect(formatPercentage(50)).toBe('50.00%')
      expect(formatPercentage(100)).toBe('100.00%')
    })

    it('should handle zero', () => {
      expect(formatPercentage(0)).toBe('0.00%')
    })

    it('should handle small percentages', () => {
      expect(formatPercentage(0.01)).toBe('0.01%')
      expect(formatPercentage(0.001)).toBe('0.00%')
    })

    it('should handle negative percentages', () => {
      expect(formatPercentage(-12.3456)).toBe('-12.35%')
      expect(formatPercentage(-0.5)).toBe('-0.50%')
    })

    it('should support custom decimal places', () => {
      expect(formatPercentage(12.3456, 1)).toBe('12.3%')
      expect(formatPercentage(12.3456, 3)).toBe('12.346%')
      expect(formatPercentage(12.3456, 0)).toBe('12%')
    })

    it('should handle large percentages', () => {
      expect(formatPercentage(250.5678)).toBe('250.57%')
    })

    it('should handle very small decimals', () => {
      expect(formatPercentage(0.001)).toBe('0.00%')
      expect(formatPercentage(0.005)).toBe('0.01%')
    })

    it('should not use parentheses for negative values', () => {
      const result = formatPercentage(-25.5)
      expect(result).toBe('-25.50%')
      expect(result).not.toContain('(')
    })
  })

  describe('Integration tests', () => {
    it('should format a complete PnL summary', () => {
      const roi = 15.6789
      const drawdown = -5.4321
      const fees = 123.456

      const formattedRoi = formatPercentage(roi)
      const formattedDrawdown = formatPercentage(drawdown)
      const formattedFees = formatCurrency(fees)

      expect(formattedRoi).toBe('15.68%')
      expect(formattedDrawdown).toBe('-5.43%')
      expect(formattedFees).toBe('$123.46')
    })

    it('should format a complete trade event', () => {
      const price = 50123.456
      const quantity = 0.123456789
      const balance = 1234.5678

      const formattedPrice = formatCurrency(price)
      const formattedQuantity = formatCryptoQuantity(quantity)
      const formattedBalance = formatCurrency(balance)

      expect(formattedPrice).toBe('$50123.46')
      expect(formattedQuantity).toBe('0.12345679')
      expect(formattedBalance).toBe('$1234.57')
    })
  })
})
