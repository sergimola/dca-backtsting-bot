import type { BacktestConfiguration, BacktestResults, BacktestStatus } from './types'

/**
 * Mock API implementation for local development and testing
 * Simulates API behavior without a real backend
 */

let requestCount = 0

/**
 * Mock submitBacktest - simulates form submission delay
 * @param config - BacktestConfiguration
 * @returns Promise with mock backtestId
 */
export async function mockSubmitBacktest(
  config: BacktestConfiguration
): Promise<{ backtestId: string }> {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 500))

  // Generate mock backtestId
  const backtestId = `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

  console.log('[Mock API] submitBacktest:', { config, backtestId })

  return {
    backtestId,
  }
}

/**
 * Mock getStatus - simulates polling progression
 * First 3 calls: pending, subsequent calls: completed
 */
export async function mockGetStatus(backtestId: string): Promise<BacktestStatus> {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 200))

  requestCount++

  // Simulate progression: pending → pending → pending → completed
  const status = requestCount <= 3 ? 'pending' : 'completed'

  console.log(`[Mock API] getStatus call ${requestCount}:`, { backtestId, status })

  return { status: status as 'pending' | 'completed' | 'failed' }
}

/**
 * Mock getResults - returns realistic sample backtest results
 */
export async function mockGetResults(backtestId: string): Promise<BacktestResults> {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 300))

  const mockResults: BacktestResults = {
    backtestId,
    pnlSummary: {
      roi: 18.75,
      maxDrawdown: -8.5,
      totalFees: 425.5,
    },
    safetyOrderUsage: [
      { level: '1', count: 24 },
      { level: '2', count: 18 },
      { level: '3', count: 12 },
      { level: '4', count: 6 },
    ],
    tradeEvents: [
      {
        timestamp: '2026-03-08T10:00:00Z',
        eventType: 'ENTRY',
        price: 50000,
        quantity: 0.02,
        balance: 9900,
      },
      {
        timestamp: '2026-03-08T10:15:00Z',
        eventType: 'SAFETY_ORDER',
        price: 49500,
        quantity: 0.01,
        balance: 9851.25,
      },
      {
        timestamp: '2026-03-08T10:45:00Z',
        eventType: 'SAFETY_ORDER',
        price: 49000,
        quantity: 0.015,
        balance: 9747.75,
      },
      {
        timestamp: '2026-03-08T11:30:00Z',
        eventType: 'EXIT',
        price: 51500,
        quantity: 0.045,
        balance: 10173.25,
      },
    ],
  }

  console.log('[Mock API] getResults:', mockResults)

  return mockResults
}

/**
 * Reset mock request counter (for testing)
 */
export function mockResetRequestCount(): void {
  requestCount = 0
}

/**
 * Error scenario mocks for testing error handling
 */

/**
 * Mock network error
 */
export async function mockNetworkError(message: string = 'Network error'): Promise<never> {
  await new Promise((resolve) => setTimeout(resolve, 100))
  throw new Error(message)
}

/**
 * Mock server error (500)
 */
export async function mockServerError(
  message: string = 'Internal Server Error'
): Promise<never> {
  await new Promise((resolve) => setTimeout(resolve, 100))
  const error = new Error(message)
  ;(error as any).response = { status: 500, data: { message } }
  throw error
}

/**
 * Mock validation error (400)
 */
export async function mockValidationError(
  message: string = 'Validation failed'
): Promise<never> {
  await new Promise((resolve) => setTimeout(resolve, 100))
  const error = new Error(message)
  ;(error as any).response = { status: 400, data: { message } }
  throw error
}

/**
 * Mock not found error (404)
 */
export async function mockNotFoundError(
  message: string = 'Backtest not found'
): Promise<never> {
  await new Promise((resolve) => setTimeout(resolve, 100))
  const error = new Error(message)
  ;(error as any).response = { status: 404, data: { message } }
  throw error
}
