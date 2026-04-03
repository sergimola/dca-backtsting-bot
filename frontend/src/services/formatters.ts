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

/**
 * Return a Tailwind class string for a trade event action pill.
 */
export function getEventPillClass(eventType: string): string {
  switch (eventType.toUpperCase()) {
    case 'ENTRY':        return 'text-emerald-300 bg-emerald-900/40'
    case 'SAFETY_ORDER': return 'text-slate-200 bg-slate-600/40'
    case 'EXIT':         return 'text-rose-300 bg-rose-900/40'
    default:             return 'text-slate-400 bg-slate-800/40'
  }
}

/**
 * Format milliseconds as a human-readable duration string.
 * @param ms - Duration in milliseconds
 * @returns Formatted string like "2d 2h 0m", "1h 0m", "0m"
 */
export function msDuration(ms: number): string {
  const days  = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  const mins  = Math.floor((ms % 3_600_000) / 60_000)
  const parts = [days && `${days}d`, hours && `${hours}h`, `${mins}m`].filter(Boolean)
  return parts.join(' ') || '0m'
}
