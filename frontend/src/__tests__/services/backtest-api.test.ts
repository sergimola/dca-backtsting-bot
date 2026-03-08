import { submitBacktest, getStatus, getResults } from '../../services/backtest-api'
import type { BacktestConfiguration, BacktestResults } from '../../services/types'
import axios from 'axios'

// Mock axios
jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

describe('backtest-api', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('submitBacktest', () => {
    it('should POST to /backtest with configuration and return backtestId', async () => {
      const config: BacktestConfiguration = {
        entryPrice: 50000,
        amounts: [100, 200],
        sequences: 5,
        leverage: 2,
        marginRatio: 50,
      }

      const mockResponse = {
        status: 201,
        data: { backtestId: 'test-123' },
      }

      mockedAxios.post.mockResolvedValue(mockResponse)

      const result = await submitBacktest(config)

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/backtest'),
        config,
        expect.any(Object)
      )
      expect(result).toEqual({ backtestId: 'test-123' })
    })

    it('should throw error on 400 validation error', async () => {
      const config: BacktestConfiguration = {
        entryPrice: 0,
        amounts: [],
        sequences: 0,
        leverage: 0,
        marginRatio: 150,
      }

      const error = new Error('Validation failed')
      ;(error as any).response = {
        status: 400,
        data: { message: 'Invalid configuration parameters' },
      }

      mockedAxios.post.mockRejectedValue(error)

      await expect(submitBacktest(config)).rejects.toThrow('Validation failed')
    })

    it('should throw error on 500 server error', async () => {
      const config: BacktestConfiguration = {
        entryPrice: 50000,
        amounts: [100],
        sequences: 1,
        leverage: 1,
        marginRatio: 50,
      }

      const error = new Error('Internal Server Error')
      ;(error as any).response = {
        status: 500,
        data: { message: 'Server error occurred' },
      }

      mockedAxios.post.mockRejectedValue(error)

      await expect(submitBacktest(config)).rejects.toThrow('Internal Server Error')
    })

    it('should throw error if backtestId is missing from response', async () => {
      const config: BacktestConfiguration = {
        entryPrice: 50000,
        amounts: [100],
        sequences: 1,
        leverage: 1,
        marginRatio: 50,
      }

      mockedAxios.post.mockResolvedValue({
        status: 201,
        data: {}, // Missing backtestId
      })

      await expect(submitBacktest(config)).rejects.toThrow('backtestId')
    })

    it('should validate response status is 201', async () => {
      const config: BacktestConfiguration = {
        entryPrice: 50000,
        amounts: [100],
        sequences: 1,
        leverage: 1,
        marginRatio: 50,
      }

      mockedAxios.post.mockResolvedValue({
        status: 200, // Wrong status
        data: { backtestId: 'test-123' },
      })

      await expect(submitBacktest(config)).rejects.toThrow()
    })
  })

  describe('getStatus', () => {
    it('should GET /backtest/{backtestId}/status and return status', async () => {
      const backtestId = 'test-123'

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { status: 'pending' },
      })

      const result = await getStatus(backtestId)

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining(`/backtest/${backtestId}/status`),
        expect.any(Object)
      )
      expect(result).toEqual({ status: 'pending' })
    })

    it('should return status "completed"', async () => {
      const backtestId = 'test-123'

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { status: 'completed' },
      })

      const result = await getStatus(backtestId)

      expect(result.status).toBe('completed')
    })

    it('should return status "failed"', async () => {
      const backtestId = 'test-123'

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { status: 'failed' },
      })

      const result = await getStatus(backtestId)

      expect(result.status).toBe('failed')
    })

    it('should throw error on 404 backtest not found', async () => {
      const backtestId = 'nonexistent'

      const error = new Error('Not found')
      ;(error as any).response = {
        status: 404,
        data: { message: 'Backtest not found' },
      }

      mockedAxios.get.mockRejectedValue(error)

      await expect(getStatus(backtestId)).rejects.toThrow('Not found')
    })

    it('should throw error on 500 server error', async () => {
      const backtestId = 'test-123'

      const error = new Error('Internal Server Error')
      ;(error as any).response = { status: 500 }

      mockedAxios.get.mockRejectedValue(error)

      await expect(getStatus(backtestId)).rejects.toThrow('Internal Server Error')
    })

    it('should validate response status is 200', async () => {
      const backtestId = 'test-123'

      mockedAxios.get.mockResolvedValue({
        status: 201, // Wrong status
        data: { status: 'pending' },
      })

      await expect(getStatus(backtestId)).rejects.toThrow()
    })
  })

  describe('getResults', () => {
    it('should GET /backtest/{backtestId}/results and return BacktestResults', async () => {
      const backtestId = 'test-123'

      const mockResults: BacktestResults = {
        backtestId,
        pnlSummary: {
          roi: 15.5,
          maxDrawdown: -5.2,
          totalFees: 125.5,
        },
        safetyOrderUsage: [
          { level: '1', count: 12 },
          { level: '2', count: 8 },
        ],
        tradeEvents: [
          {
            timestamp: '2026-03-08T10:00:00Z',
            eventType: 'ENTRY',
            price: 50000,
            quantity: 0.01,
            balance: 9900,
          },
        ],
      }

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: mockResults,
      })

      const result = await getResults(backtestId)

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining(`/backtest/${backtestId}/results`),
        expect.any(Object)
      )
      expect(result).toEqual(mockResults)
      expect(result.pnlSummary.roi).toBe(15.5)
      expect(result.tradeEvents.length).toBe(1)
    })

    it('should throw error on 404 backtest not found', async () => {
      const backtestId = 'nonexistent'

      const error = new Error('Not found')
      ;(error as any).response = {
        status: 404,
        data: { message: 'Backtest not found' },
      }

      mockedAxios.get.mockRejectedValue(error)

      await expect(getResults(backtestId)).rejects.toThrow('Not found')
    })

    it('should throw error on 500 server error', async () => {
      const backtestId = 'test-123'

      const error = new Error('Internal Server Error')
      ;(error as any).response = { status: 500 }

      mockedAxios.get.mockRejectedValue(error)

      await expect(getResults(backtestId)).rejects.toThrow('Internal Server Error')
    })

    it('should throw error on malformed response', async () => {
      const backtestId = 'test-123'

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { corrupted: 'data' }, // Missing required fields
      })

      await expect(getResults(backtestId)).rejects.toThrow()
    })

    it('should validate response status is 200', async () => {
      const backtestId = 'test-123'

      const mockResults: BacktestResults = {
        backtestId,
        pnlSummary: {
          roi: 15.5,
          maxDrawdown: -5.2,
          totalFees: 125.5,
        },
        safetyOrderUsage: [],
        tradeEvents: [],
      }

      mockedAxios.get.mockResolvedValue({
        status: 201, // Wrong status
        data: mockResults,
      })

      await expect(getResults(backtestId)).rejects.toThrow()
    })

    it('should handle complete BacktestResults structure', async () => {
      const backtestId = 'test-123'

      const mockResults: BacktestResults = {
        backtestId: 'test-123',
        pnlSummary: {
          roi: 25.5,
          maxDrawdown: -10.2,
          totalFees: 250.75,
        },
        safetyOrderUsage: [
          { level: '1', count: 20 },
          { level: '2', count: 15 },
          { level: '3', count: 8 },
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
            timestamp: '2026-03-08T10:30:00Z',
            eventType: 'SAFETY_ORDER',
            price: 49000,
            quantity: 0.01,
            balance: 9851,
          },
        ],
      }

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: mockResults,
      })

      const result = await getResults(backtestId)

      expect(result.backtestId).toBe('test-123')
      expect(result.pnlSummary.roi).toBe(25.5)
      expect(result.safetyOrderUsage.length).toBe(3)
      expect(result.tradeEvents.length).toBe(2)
    })
  })
})
