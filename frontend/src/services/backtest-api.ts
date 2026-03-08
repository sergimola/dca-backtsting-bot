import axios, { AxiosInstance } from 'axios'
import type { BacktestConfiguration, BacktestResults } from './types'

/**
 * API client for backtest operations
 * Handles submission, status polling, and results retrieval
 */

const API_BASE_URL = (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL) || 'http://localhost:4000/api'

/**
 * Get headers for API requests
 */
function getHeaders() {
  return {
    'Content-Type': 'application/json',
  }
}

/**
 * Build full URL for requests
 */
function buildUrl(endpoint: string): string {
  return `${API_BASE_URL}${endpoint}`
}

/**
 * Submit a backtest configuration to the API
 * @param config - BacktestConfiguration object
 * @returns Promise with backtestId
 * @throws Error if submission fails
 */
export async function submitBacktest(
  config: BacktestConfiguration
): Promise<{ backtestId: string }> {
  try {
    const response = await axios.post(
      buildUrl('/backtest'),
      config,
      { headers: getHeaders() }
    )

    // Validate response status
    if (response.status !== 201) {
      throw new Error(`Expected status 201, received ${response.status}`)
    }

    // Validate response has backtestId
    if (!response.data || !response.data.backtestId) {
      throw new Error('Response missing required field: backtestId')
    }

    return {
      backtestId: response.data.backtestId,
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error('Failed to submit backtest')
  }
}

/**
 * Get the current status of a backtest
 * @param backtestId - ID of the backtest to check
 * @returns Promise with status string
 * @throws Error if status check fails
 */
export async function getStatus(
  backtestId: string
): Promise<{ status: 'pending' | 'completed' | 'failed' }> {
  try {
    const response = await axios.get(
      buildUrl(`/backtest/${backtestId}/status`),
      { headers: getHeaders() }
    )

    // Validate response status
    if (response.status !== 200) {
      throw new Error(`Expected status 200, received ${response.status}`)
    }

    // Validate status value
    const validStatuses = ['pending', 'completed', 'failed']
    if (!response.data || !validStatuses.includes(response.data.status)) {
      throw new Error('Invalid status in response')
    }

    return {
      status: response.data.status as 'pending' | 'completed' | 'failed',
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error('Failed to get backtest status')
  }
}

/**
 * Get the complete results of a backtest
 * @param backtestId - ID of the backtest to retrieve results for
 * @returns Promise with BacktestResults object
 * @throws Error if results cannot be retrieved or are malformed
 */
export async function getResults(
  backtestId: string
): Promise<BacktestResults> {
  try {
    const response = await axios.get(
      buildUrl(`/backtest/${backtestId}/results`),
      { headers: getHeaders() }
    )

    // Validate response status
    if (response.status !== 200) {
      throw new Error(`Expected status 200, received ${response.status}`)
    }

    // Validate response structure
    if (
      !response.data ||
      !response.data.backtestId ||
      !response.data.pnlSummary ||
      !Array.isArray(response.data.safetyOrderUsage) ||
      !Array.isArray(response.data.tradeEvents)
    ) {
      throw new Error('Response has invalid structure: missing required fields')
    }

    return response.data as BacktestResults
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error('Failed to get backtest results')
  }
}
