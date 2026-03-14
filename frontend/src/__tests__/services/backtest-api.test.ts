import { submitBacktest, getStatus, getResults } from '../../services/backtest-api'
import type { BacktestFormState, BacktestResults } from '../../services/types'
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
      const config: BacktestFormState = {
        tradingPair: 'BTC/USDT',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        priceEntry: '50000',
        priceScale: '1.10',
        amountScale: '2.0',
        numberOfOrders: '5',
        amountPerTrade: '0.10',
        marginType: 'cross',
        multiplier: '1',
        takeProfitDistancePercent: '2.5',
        accountBalance: '1000.00',
        exitOnLastOrder: false,
      }

      const mockResponse = {
        status: 201,
        data: { backtestId: 'test-123' },
      }

      mockedAxios.post.mockResolvedValue(mockResponse)

      const result = await submitBacktest(config)

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/backtest'),
        expect.objectContaining({
          trading_pair: 'BTC/USDT',
          price_entry: '50000',
          margin_type: 'cross',
        }),
        expect.any(Object)
      )
      expect(result).toEqual({ backtestId: 'test-123' })
    })

    it('should throw error on 400 validation error', async () => {
      const config: BacktestFormState = {
        tradingPair: '',
        startDate: '',
        endDate: '',
        priceEntry: '0',
        priceScale: '1.10',
        amountScale: '2.0',
        numberOfOrders: '0',
        amountPerTrade: '0',
        marginType: 'cross',
        multiplier: '0',
        takeProfitDistancePercent: '0',
        accountBalance: '0',
        exitOnLastOrder: false,
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
      const config: BacktestFormState = {
        tradingPair: 'BTC/USDT',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        priceEntry: '50000',
        priceScale: '1.10',
        amountScale: '2.0',
        numberOfOrders: '5',
        amountPerTrade: '0.10',
        marginType: 'cross',
        multiplier: '1',
        takeProfitDistancePercent: '2.5',
        accountBalance: '1000.00',
        exitOnLastOrder: false,
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
      const config: BacktestFormState = {
        tradingPair: 'BTC/USDT',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        priceEntry: '50000',
        priceScale: '1.10',
        amountScale: '2.0',
        numberOfOrders: '5',
        amountPerTrade: '0.10',
        marginType: 'cross',
        multiplier: '1',
        takeProfitDistancePercent: '2.5',
        accountBalance: '1000.00',
        exitOnLastOrder: false,
      }

      mockedAxios.post.mockResolvedValue({
        status: 201,
        data: {}, // Missing backtestId
      })

      await expect(submitBacktest(config)).rejects.toThrow('backtestId')
    })

    it('should validate response status is 201', async () => {
      const config: BacktestFormState = {
        tradingPair: 'BTC/USDT',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        priceEntry: '50000',
        priceScale: '1.10',
        amountScale: '2.0',
        numberOfOrders: '5',
        amountPerTrade: '0.10',
        marginType: 'cross',
        multiplier: '1',
        takeProfitDistancePercent: '2.5',
        accountBalance: '1000.00',
        exitOnLastOrder: false,
      }

      mockedAxios.post.mockResolvedValue({
        status: 200, // Wrong status
        data: { backtestId: 'test-123' },
      })

      await expect(submitBacktest(config)).rejects.toThrow()
    })

    it('T004.2: pads YYYY-MM-DD dates to RFC 3339 before sending to API', async () => {
      const config: BacktestFormState = {
        tradingPair: 'LTC/USDT',
        startDate: '2025-01-01',
        endDate: '2025-01-31',
        priceEntry: '2.0',
        priceScale: '1.1',
        amountScale: '2.0',
        numberOfOrders: '3',
        amountPerTrade: '1000.0',
        marginType: 'cross',
        multiplier: '1',
        takeProfitDistancePercent: '2.0',
        accountBalance: '10000.0',
        exitOnLastOrder: false,
      }

      mockedAxios.post.mockResolvedValue({
        status: 201,
        data: { request_id: 'pad-test-001' },
      })

      await submitBacktest(config)

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/backtest'),
        expect.objectContaining({
          start_date: '2025-01-01T00:00:00Z',
          end_date: '2025-01-31T23:59:59Z',
        }),
        expect.any(Object),
      )
    })

    it('T004.2: converts padded datetime to RFC 3339 format', async () => {
      const config: BacktestFormState = {
        tradingPair: 'LTC/USDT',
        startDate: '2025-01-01 00:00:00',
        endDate: '2025-01-31 23:59:59',
        priceEntry: '2.0',
        priceScale: '1.1',
        amountScale: '2.0',
        numberOfOrders: '3',
        amountPerTrade: '1000.0',
        marginType: 'cross',
        multiplier: '1',
        takeProfitDistancePercent: '2.0',
        accountBalance: '10000.0',
        exitOnLastOrder: false,
      }

      mockedAxios.post.mockResolvedValue({
        status: 201,
        data: { request_id: 'pad-test-002' },
      })

      await submitBacktest(config)

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/backtest'),
        expect.objectContaining({
          start_date: '2025-01-01T00:00:00Z',
          end_date: '2025-01-31T23:59:59Z',
        }),
        expect.any(Object),
      )
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

    it('T011: EXIT event.fee equals SellOrderExecuted.fee (not 0)', async () => {
      const backtestId = 'sell-fee-011'
      mockedAxios.post.mockResolvedValue({
        status: 201,
        data: {
          request_id: backtestId,
          pnl_summary: { roi_percent: '5.0', total_fees: '0.75', safety_order_usage_counts: {} },
          events: [
            { type: 'PositionOpened',    data: { trade_id: 'uuid', entry_fee: '0.30', configured_orders: [{ price: '50000', amount: '50' }] }, timestamp: '2024-01-01T10:00:00Z' },
            { type: 'BuyOrderExecuted',  data: { trade_id: 'uuid', fee: '0.25', order_number: 2, base_size: '0.001', price: '49000' }, timestamp: '2024-01-01T10:30:00Z' },
            { type: 'PositionClosed',    data: { trade_id: 'uuid', closing_price: '51000', size: '0.002', profit: '2.50' }, timestamp: '2024-01-01T11:00:00Z' },
            { type: 'SellOrderExecuted', data: { trade_id: 'uuid', fee: '0.20' }, timestamp: '2024-01-01T11:00:00Z' },
          ],
        },
      })

      const submitConfig: BacktestFormState = {
        tradingPair: 'BTC/USDT', startDate: '2024-01-01', endDate: '2024-01-31',
        priceEntry: '50000', priceScale: '1.10', amountScale: '2.0', numberOfOrders: '3',
        amountPerTrade: '100', marginType: 'cross', multiplier: '1',
        takeProfitDistancePercent: '2.5', accountBalance: '1000', exitOnLastOrder: false,
      }
      await submitBacktest(submitConfig)
      const result = await getResults(backtestId)

      const exitEvent = result.tradeEvents.find(e => e.eventType === 'EXIT')
      expect(exitEvent).toBeDefined()
      // Must be 0.20 from SellOrderExecuted — NOT the default 0
      expect(exitEvent!.fee).toBeCloseTo(0.20, 5)
    })

    it('T007: assigns sequential trade_id "1","2","3" ignoring engine trade_id', async () => {
      const backtestId = 'trade-counter-007'
      mockedAxios.post.mockResolvedValue({
        status: 201,
        data: {
          request_id: backtestId,
          pnl_summary: { roi_percent: '5.0', total_fees: '0.30', safety_order_usage_counts: {} },
          events: [
            // Trade 1
            { type: 'PositionOpened', data: { trade_id: 'engine-uuid', entry_fee: '0.05', configured_orders: [{ price: '50000', amount: '50' }] }, timestamp: '2024-01-01T10:00:00Z' },
            { type: 'PositionClosed', data: { trade_id: 'engine-uuid', closing_price: '50100', size: '0.001', profit: '0.10' }, timestamp: '2024-01-01T11:00:00Z' },
            // Trade 2
            { type: 'PositionOpened', data: { trade_id: 'engine-uuid', entry_fee: '0.05', configured_orders: [{ price: '50000', amount: '50' }] }, timestamp: '2024-01-01T12:00:00Z' },
            { type: 'PositionClosed', data: { trade_id: 'engine-uuid', closing_price: '50200', size: '0.001', profit: '0.20' }, timestamp: '2024-01-01T13:00:00Z' },
            // Trade 3
            { type: 'PositionOpened', data: { trade_id: 'engine-uuid', entry_fee: '0.05', configured_orders: [{ price: '50000', amount: '50' }] }, timestamp: '2024-01-01T14:00:00Z' },
            { type: 'PositionClosed', data: { trade_id: 'engine-uuid', closing_price: '50300', size: '0.001', profit: '0.30' }, timestamp: '2024-01-01T15:00:00Z' },
          ],
        },
      })

      const submitConfig: BacktestFormState = {
        tradingPair: 'BTC/USDT', startDate: '2024-01-01', endDate: '2024-01-31',
        priceEntry: '50000', priceScale: '1.10', amountScale: '2.0', numberOfOrders: '3',
        amountPerTrade: '100', marginType: 'cross', multiplier: '1',
        takeProfitDistancePercent: '2.5', accountBalance: '1000', exitOnLastOrder: false,
      }
      await submitBacktest(submitConfig)
      const result = await getResults(backtestId)

      const entryEvents = result.tradeEvents.filter(e => e.eventType === 'ENTRY')
      const exitEvents  = result.tradeEvents.filter(e => e.eventType === 'EXIT')

      expect(entryEvents).toHaveLength(3)
      expect(entryEvents[0].trade_id).toBe('1')
      expect(entryEvents[1].trade_id).toBe('2')
      expect(entryEvents[2].trade_id).toBe('3')
      expect(exitEvents[0].trade_id).toBe('1')
      expect(exitEvents[1].trade_id).toBe('2')
      expect(exitEvents[2].trade_id).toBe('3')
      // Engine UUID must NOT appear
      result.tradeEvents.forEach(e => {
        expect(e.trade_id).not.toBe('engine-uuid')
      })
    })

    it('T008: tradeCounter resets to 1 on each getResults() call', async () => {
      const backtestId = 'trade-counter-008'
      mockedAxios.post.mockResolvedValue({
        status: 201,
        data: {
          request_id: backtestId,
          pnl_summary: { roi_percent: '2.0', total_fees: '0.10', safety_order_usage_counts: {} },
          events: [
            { type: 'PositionOpened', data: { trade_id: 'engine-uuid', entry_fee: '0.05', configured_orders: [{ price: '50000', amount: '50' }] }, timestamp: '2024-01-01T10:00:00Z' },
            { type: 'PositionClosed', data: { trade_id: 'engine-uuid', closing_price: '50100', size: '0.001', profit: '0.10' }, timestamp: '2024-01-01T11:00:00Z' },
            { type: 'PositionOpened', data: { trade_id: 'engine-uuid', entry_fee: '0.05', configured_orders: [{ price: '50000', amount: '50' }] }, timestamp: '2024-01-01T12:00:00Z' },
            { type: 'PositionClosed', data: { trade_id: 'engine-uuid', closing_price: '50200', size: '0.001', profit: '0.20' }, timestamp: '2024-01-01T13:00:00Z' },
          ],
        },
      })

      const submitConfig: BacktestFormState = {
        tradingPair: 'BTC/USDT', startDate: '2024-01-01', endDate: '2024-01-31',
        priceEntry: '50000', priceScale: '1.10', amountScale: '2.0', numberOfOrders: '3',
        amountPerTrade: '100', marginType: 'cross', multiplier: '1',
        takeProfitDistancePercent: '2.5', accountBalance: '1000', exitOnLastOrder: false,
      }
      await submitBacktest(submitConfig)

      const result1 = await getResults(backtestId)
      const result2 = await getResults(backtestId)

      const first1 = result1.tradeEvents.filter(e => e.eventType === 'ENTRY')[0]
      const first2 = result2.tradeEvents.filter(e => e.eventType === 'ENTRY')[0]
      expect(first1.trade_id).toBe('1')
      expect(first2.trade_id).toBe('1')
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

    it('T017: safetyOrderUsage array starts at level "1" when numberOfOrders=5', async () => {
      const backtestId = 'so-chart-017'
      mockedAxios.post.mockResolvedValue({
        status: 201,
        data: {
          request_id: backtestId,
          pnl_summary: {
            roi_percent: '3.0',
            total_fees: '0.10',
            // SO1 used 2×, SO2 used 1×, SO3-4 unused
            safety_order_usage_counts: { '1': 2, '2': 1 },
          },
          events: [
            { type: 'PositionOpened', data: { trade_id: 'uuid', entry_fee: '0.05', configured_orders: [{ price: '50000', amount: '50' }] }, timestamp: '2024-01-01T10:00:00Z' },
            { type: 'PositionClosed', data: { trade_id: 'uuid', closing_price: '51000', size: '0.001', profit: '1.00' }, timestamp: '2024-01-01T11:00:00Z' },
          ],
        },
      })

      const submitConfig: BacktestFormState = {
        tradingPair: 'BTC/USDT', startDate: '2024-01-01', endDate: '2024-01-31',
        priceEntry: '50000', priceScale: '1.10', amountScale: '2.0', numberOfOrders: '5',
        amountPerTrade: '100', marginType: 'cross', multiplier: '1',
        takeProfitDistancePercent: '2.5', accountBalance: '1000', exitOnLastOrder: false,
      }
      await submitBacktest(submitConfig)
      const result = await getResults(backtestId)

      // First level must be "1", never "0"
      expect(result.safetyOrderUsage[0].level).toBe('1')
      // No level "0" in the array
      const hasLevelZero = result.safetyOrderUsage.some(x => x.level === '0')
      expect(hasLevelZero).toBe(false)
    })

    it('T018: no level "0" entry in safetyOrderUsage even when pnl_summary contains legacy key "0"', async () => {
      const backtestId = 'so-chart-018'
      mockedAxios.post.mockResolvedValue({
        status: 201,
        data: {
          request_id: backtestId,
          pnl_summary: {
            roi_percent: '1.0',
            total_fees: '0.05',
            // Legacy key "0" present — must be ignored by the loop
            safety_order_usage_counts: { '0': 3, '1': 2 },
          },
          events: [
            { type: 'PositionOpened', data: { trade_id: 'uuid', entry_fee: '0.05', configured_orders: [{ price: '50000', amount: '50' }] }, timestamp: '2024-01-01T10:00:00Z' },
            { type: 'PositionClosed', data: { trade_id: 'uuid', closing_price: '50500', size: '0.001', profit: '0.50' }, timestamp: '2024-01-01T11:00:00Z' },
          ],
        },
      })

      const submitConfig: BacktestFormState = {
        tradingPair: 'BTC/USDT', startDate: '2024-01-01', endDate: '2024-01-31',
        priceEntry: '50000', priceScale: '1.10', amountScale: '2.0', numberOfOrders: '3',
        amountPerTrade: '100', marginType: 'cross', multiplier: '1',
        takeProfitDistancePercent: '2.5', accountBalance: '1000', exitOnLastOrder: false,
      }
      await submitBacktest(submitConfig)
      const result = await getResults(backtestId)

      // Legacy "0" key from pnl_summary must NOT produce a level "0" bar
      const hasLevelZero = result.safetyOrderUsage.some(x => x.level === '0')
      expect(hasLevelZero).toBe(false)
      // Levels start at 1
      if (result.safetyOrderUsage.length > 0) {
        expect(result.safetyOrderUsage[0].level).toBe('1')
      }
    })
  })
})

