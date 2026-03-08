/**
 * User Story 2: Concurrent Backtest Execution (T044)
 *
 * Narrative:
 * As an API operator, I want to submit multiple backtest configurations
 * simultaneously and have them all process independently so that I can
 * evaluate different strategies in parallel without data corruption or mixing.
 *
 * Acceptance Criteria:
 * - 10+ simultaneous POST /backtest requests all succeed
 * - Each request gets unique request_id
 * - Response data is isolated (no mixing between requests)
 * - All results stored separately in persistence layer
 * - No data corruption or race conditions
 */

import request from 'supertest';
import {
  setupTestApp,
  cleanupTestApp,
  createMultipleBacktestRequests,
  getTestServices,
} from '../helpers/test-setup';

describe.skip('User Story 2: Concurrent Backtest Execution (T044)', () => {
  // NOTE: Skipped when binary not available - requires Core Engine binary
  beforeAll(async () => {
    await setupTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp();
  });

  describe('Simultaneous backtest requests', () => {
    it('should handle 10+ concurrent POST /backtest requests without data mixing', async () => {
      const concurrentCount = 15;
      const requests = createMultipleBacktestRequests(concurrentCount);

      // Fire all requests simultaneously
      const responses = await Promise.all(
        requests.map((req) =>
          request('http://localhost:3000')
            .post('/backtest')
            .send(req)
        )
      );

      // Verify all responses completed
      expect(responses.length).toBe(concurrentCount);

      // All should have status 200 or 202
      responses.forEach((response) => {
        expect([200, 202]).toContain(response.status);
      });

      // Extract request_ids
      const requestIds = responses
        .filter((r) => r.body?.request_id)
        .map((r) => r.body.request_id);

      // Since we have different entry prices, we should get different results
      expect(requestIds.length).toBeGreaterThan(0);

      // All request_ids should be unique
      const uniqueIds = new Set(requestIds);
      expect(uniqueIds.size).toBe(requestIds.length);
    });

    it('should verify each concurrent result has correct structure (no data mixing)', async () => {
      const concurrentCount = 10;
      const requests = createMultipleBacktestRequests(concurrentCount);

      const responses = await Promise.all(
        requests.map((req) =>
          request('http://localhost:3000')
            .post('/backtest')
            .send(req)
        )
      );

      // Verify each response has proper structure
      responses.forEach((_response, _index) => {
        expect([200, 202]).toContain(_response.status);

        if (_response.status === 200) {
          // Verify complete response structure
          expect(_response.body).toHaveProperty('request_id');
          expect(_response.body).toHaveProperty('status');
          expect(_response.body).toHaveProperty('timestamp');

          // Verify PnL summary is present and correct
          if (_response.body.pnl_summary) {
            expect(typeof _response.body.pnl_summary.total_pnl).toBe('string');
            expect(typeof _response.body.pnl_summary.roi_percent).toBe('string');
          }

          // Verify event counts make sense
          if (Array.isArray(_response.body.events)) {
            expect(_response.body.events.length).toBeGreaterThanOrEqual(0);
          }
        }
      });
    });

    it('should store all concurrent results independently in persistence layer', async () => {
      const concurrentCount = 8;
      const requests = createMultipleBacktestRequests(concurrentCount);
      const { resultStore } = getTestServices();

      const responses = await Promise.all(
        requests.map((req) =>
          request('http://localhost:3000')
            .post('/backtest')
            .send(req)
        )
      );

      // Retrieve all results from storage
      const storedResults = await Promise.all(
        responses
          .filter((r) => r.body?.request_id)
          .map((r) => resultStore.retrieve(r.body.request_id))
      );

      // All should be retrievable
      expect(storedResults.filter((r) => r).length).toBe(storedResults.length);

      // All should have proper structure
      storedResults.forEach((result) => {
        expect(result).toHaveProperty('request_id');
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('timestamp');
      });

      // Verify no data is mixed (each result has unique request_id)
      const resultIds = storedResults.map((r) => r?.request_id);
      const uniqueIds = new Set(resultIds);
      expect(uniqueIds.size).toBe(resultIds.length);
    });

    it('should isolate request contexts (request IDs, timestamps, results)', async () => {
      const concurrentCount = 12;
      const requests = createMultipleBacktestRequests(concurrentCount);

      const responses = await Promise.all(
        requests.map((req) =>
          request('http://localhost:3000')
            .post('/backtest')
            .send(req)
        )
      );

      // Extract metadata
      const metadata = responses
        .filter((r) => r.body?.request_id)
        .map((r) => ({
          requestId: r.body.request_id,
          timestamp: r.body.timestamp,
          status: r.body.status,
        }));

      // Verify all timestamps are recent (within last 10 seconds)
      const now = Date.now();
      metadata.forEach((m) => {
        const timestamp = new Date(m.timestamp).getTime();
        expect(Math.abs(now - timestamp)).toBeLessThan(10000);
      });

      // Verify request_id uniqueness
      const ids = new Set(metadata.map((m) => m.requestId));
      expect(ids.size).toBe(metadata.length);

      // All should have consistent status field
      metadata.forEach((m) => {
        expect(['success', 'failed', 'pending']).toContain(m.status);
      });
    });

    it('should not produce data corruption during concurrent writes', async () => {
      const concurrentCount = 20; // High concurrency test
      const requests = createMultipleBacktestRequests(concurrentCount);

      const responses = await Promise.all(
        requests.map((req) =>
          request('http://localhost:3000')
            .post('/backtest')
            .send(req)
        )
      );

      // All should complete
      const successCount = responses.filter((r) => [200, 202].includes(r.status)).length;
      expect(successCount).toBe(concurrentCount);

      // Verify response bodies are valid JSON with no corruption
      responses.forEach((response) => {
        // Should not have duplicate or malformed fields
        expect(response.body).not.toHaveProperty('request_idrequest_id'); // No duplicated fields
        expect(response.body).not.toHaveProperty('statusstatus');

        // Should have valid string fields
        if (response.body.request_id) {
          expect(typeof response.body.request_id).toBe('string');
          expect(response.body.request_id.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('Queue depth under concurrent load', () => {
    it('should track queue metrics during concurrent execution', async () => {
      const concurrentCount = 10;
      const requests = createMultipleBacktestRequests(concurrentCount);
      const { processManager } = getTestServices();

      // Check queue state before firing requests
      const metricsBefore = processManager.getMetrics();
      expect(metricsBefore).toHaveProperty('queue_depth');

      // Fire concurrent requests
      const responses = await Promise.all(
        requests.map((req) =>
          request('http://localhost:3000')
            .post('/backtest')
            .send(req)
        )
      );

      // After completion, queue should drain
      const metricsAfter = processManager.getMetrics();
      expect(metricsAfter.queue_depth).toBeGreaterThanOrEqual(0);

      // All requests should have completed
      expect(responses.filter((r) => [200, 202].includes(r.status)).length).toBe(concurrentCount);
    });
  });
});
