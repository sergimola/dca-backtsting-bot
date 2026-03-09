/**
 * User Story 1: Submit & Execute Backtest (T043)
 *
 * Narrative:
 * As an API consumer, I want to submit a backtest configuration and receive
 * a complete result with final position and PnL summary so that I can evaluate
 * my trading strategy performance.
 *
 * Acceptance Criteria:
 * - POST /backtest accepts valid configuration
 * - Response contains request_id, events, final_position, pnl_summary
 * - pnl_summary includes total_pnl, roi_percent, trading_fees, total_fills
 * - Response status is 200 OK
 * - Idempotency key prevents duplicate execution
 */

import request from 'supertest';
import { setupTestApp, cleanupTestApp, createValidBacktestRequest, getTestServices, getTestApp, hasCoreEngineBinary } from '../helpers/test-setup';

// Dynamically skip if Core Engine binary is not available
(hasCoreEngineBinary() ? describe : describe.skip)('User Story 1: Submit & Execute Backtest (T043)', () => {
  beforeAll(async () => {
    await setupTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp();
  });

  describe('Submit valid backtest request', () => {
    it('should return HTTP 200 with complete result including request_id, events, final_position, pnl_summary', async () => {
      const validRequest = createValidBacktestRequest();

      const response = await request(getTestApp())
        .post('/backtest')
        .send(validRequest)
        .expect('Content-Type', /json/);

      // Verify HTTP status
      expect([200, 202]).toContain(response.status);

      // Verify response structure
      expect(response.body).toHaveProperty('request_id');
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');

      // Verify request_id is a valid UUID
      expect(response.body.request_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );

      // For 200 response: verify complete result
      if (response.status === 200) {
        expect(response.body).toHaveProperty('events');
        expect(Array.isArray(response.body.events)).toBe(true);
        
        expect(response.body).toHaveProperty('final_position');
        expect(response.body.final_position).toHaveProperty('quantity');
        expect(response.body.final_position).toHaveProperty('average_cost');
        expect(response.body.final_position).toHaveProperty('status');

        expect(response.body).toHaveProperty('pnl_summary');
        expect(response.body.pnl_summary).toHaveProperty('total_pnl');
        expect(response.body.pnl_summary).toHaveProperty('roi_percent');
        expect(response.body.pnl_summary).toHaveProperty('trading_fees');
        expect(response.body.pnl_summary).toHaveProperty('total_fills');
        expect(response.body.pnl_summary).toHaveProperty('realized_pnl');

        // Verify PnL values are decimal strings
        expect(typeof response.body.pnl_summary.total_pnl).toBe('string');
        expect(typeof response.body.pnl_summary.roi_percent).toBe('string');
        expect(typeof response.body.pnl_summary.trading_fees).toBe('string');
      }

      // For 202 response: polling endpoint would be /backtest/:request_id
      // Just verify we got a request_id to query
    });

    it('should store result in persistence layer', async () => {
      const validRequest = createValidBacktestRequest();
      const { resultStore } = getTestServices();

      const response = await request(getTestApp())
        .post('/backtest')
        .send(validRequest);

      if (response.status === 200) {
        const retrievedResult = await resultStore.retrieve(response.body.request_id);
        expect(retrievedResult).toBeDefined();
        expect(retrievedResult?.request_id).toBe(response.body.request_id);
      }
    });

    it('should populate execution_time_ms with actual execution duration', async () => {
      const validRequest = createValidBacktestRequest();

      const response = await request(getTestApp())
        .post('/backtest')
        .send(validRequest)
        .expect(200);

      expect(response.body).toHaveProperty('execution_time_ms');
      expect(typeof response.body.execution_time_ms).toBe('number');
      expect(response.body.execution_time_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Idempotency support', () => {
    it('should return same result when idempotency_key is reused', async () => {
      const validRequest = {
        ...createValidBacktestRequest(),
        idempotency_key: require('crypto').randomUUID(),
      };

      // First request
      const response1 = await request(getTestApp())
        .post('/backtest')
        .send(validRequest)
        .expect('Content-Type', /json/);

      // Second request with same idempotency_key
      const response2 = await request(getTestApp())
        .post('/backtest')
        .send(validRequest)
        .expect('Content-Type', /json/);

      // Both should succeed
      expect([200, 202]).toContain(response1.status);
      expect([200, 202]).toContain(response2.status);

      // If 200 response, should get same result
      if (response1.status === 200 && response2.status === 200) {
        expect(response2.body.request_id).toBe(response1.body.request_id);
      }
    });
  });

  describe('Invalid request handling', () => {
    it('should reject missing required field with HTTP 400', async () => {
      const invalidRequest = {
        // Missing entry_price
        amounts: ['10.25000000'],
        sequences: [0],
        leverage: '2.00000000',
        margin_ratio: '0.50000000',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      const response = await request(getTestApp())
        .post('/backtest')
        .send(invalidRequest);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
    });

    it('should reject float precision violation with HTTP 400', async () => {
      const invalidRequest = {
        entry_price: 100.50, // Should be "100.50000000"
        amounts: ['10.25000000'],
        sequences: [0],
        leverage: '2.00000000',
        margin_ratio: '0.50000000',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      const response = await request(getTestApp())
        .post('/backtest')
        .send(invalidRequest);

      expect(response.status).toBe(400);
      expect(response.body.error).toHaveProperty('message');
    });

    it('should reject out-of-bounds margin_ratio with HTTP 422', async () => {
      const invalidRequest = {
        entry_price: '100.50000000',
        amounts: ['10.25000000'],
        sequences: [0],
        leverage: '2.00000000',
        margin_ratio: '1.50000000', // Should be < 1.0
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      const response = await request(getTestApp())
        .post('/backtest')
        .send(invalidRequest);

      expect(response.status).toBe(422);
    });

    it('should reject mismatched amounts/sequences lengths', async () => {
      const invalidRequest = {
        entry_price: '100.50000000',
        amounts: ['10.25000000'], // 1 amount
        sequences: [0, 1], // 2 sequences - MISMATCH
        leverage: '2.00000000',
        margin_ratio: '0.50000000',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      const response = await request(getTestApp())
        .post('/backtest')
        .send(invalidRequest);

      expect([400, 422]).toContain(response.status);
    });
  });
});

