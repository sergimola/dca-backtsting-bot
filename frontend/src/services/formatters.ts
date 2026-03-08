/**
 * Formatting utilities for DCA Frontend
 * Provides currency, crypto, and percentage formatting functions
 */

/**
 * Format a number as USD currency with dollar sign
 * @param amount - The amount to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted currency string (e.g., "$1234.57")
 */
export function formatCurrency(amount: number, decimals: number = 2): string {
  const isNegative = amount < 0
  const absAmount = Math.abs(amount)
  
  // Use toFixed to control decimals, avoiding thousands separator
  const rounded = Math.round(absAmount * Math.pow(10, decimals)) / Math.pow(10, decimals)
  const formatted = rounded.toFixed(decimals)

  const prefix = isNegative ? '-$' : '$'
  return prefix + formatted
}

/**
 * Format a number as crypto quantity with fixed decimals
 * @param amount - The amount to format
 * @param decimals - Number of decimal places (default: 8)
 * @returns Formatted crypto string (e.g., "0.12345678")
 */
export function formatCryptoQuantity(amount: number, decimals: number = 8): string {
  // Use toFixed for precision, then parse back to avoid scientific notation
  const fixed = amount.toFixed(decimals)
  // Remove trailing zeros after decimal if needed, but keep at least the specified decimals
  return fixed
}

/**
 * Format a number as a percentage with percent sign
 * @param value - The percentage value to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted percentage string (e.g., "12.35%")
 */
export function formatPercentage(value: number, decimals: number = 2): string {
  const isNegative = value < 0
  const absValue = Math.abs(value)
  
  // Round to specified decimal places
  const rounded = Math.round(absValue * Math.pow(10, decimals)) / Math.pow(10, decimals)
  const formatted = rounded.toFixed(decimals)

  const prefix = isNegative ? '-' : ''
  return prefix + formatted + '%'
}
