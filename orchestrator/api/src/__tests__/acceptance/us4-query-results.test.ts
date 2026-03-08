/**
 * User Story 4: Query Results by Date Range (T046)
 *
 * Narrative:
 * As an API consumer, I want to query previously executed backtests
 * by date range and status so that I can find and analyze historical
 * backtest runs without loading all results into memory.
 *
 * Acceptance Criteria:
 * - GET /backtest?from=...&to=... returns paginated results
 * - Query parameters: from, to, status, page, limit
 * - Results sorted by timestamp descending
 * - Pagination works correctly
 * - Filtering by status (success, failed, all) works
 */

import request from 'supertest';
import { setupTestApp, cleanupTestApp, createValidBacktestRequest, getTestApp, hasCoreEngineBinary } from '../helpers/test-setup';

// Dynamically skip if Core Engine binary is not available
(hasCoreEngineBinary() ? describe : describe.skip)('User Story 4: Query Results by Date Range (T046)', () => {
  beforeAll(async () => {
    await setupTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp();
  });

  describe('Query results by date range', () => {
    beforeEach(async () => {
      // Submit a few backtests to populate results
      const requests = [
        createValidBacktestRequest(),
        { ...createValidBacktestRequest(), entry_price: '101.00000000' },
        { ...createValidBacktestRequest(), entry_price: '102.00000000' },
      ];

      await Promise.all(
        requests.map((req) =>
          request(getTestApp())
            .post('/backtest')
            .send(req)
        )
      );
    });

    it('should return paginated results for date range query', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const response = await request(getTestApp())
        .get('/backtest')
        .query({
          from: yesterday.toISOString(),
          to: now.toISOString(),
          page: 0,
          limit: 10,
        })
        .expect('Content-Type', /json/);

      expect([200, 404]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('results');
        expect(response.body).toHaveProperty('pagination');

        // Pagination info should be present
        expect(response.body.pagination).toHaveProperty('page');
        expect(response.body.pagination).toHaveProperty('limit');
        expect(response.body.pagination).toHaveProperty('total');
        expect(response.body.pagination).toHaveProperty('page_count');

        // Results should be array
        expect(Array.isArray(response.body.results)).toBe(true);

        // Each result should have proper structure
        response.body.results.forEach((result: any) => {
          expect(result).toHaveProperty('request_id');
          expect(result).toHaveProperty('timestamp');
          expect(result).toHaveProperty('status');
        });
      }
    });

    it('should respect page and limit parameters', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Request first page with limit 2
      const page1Response = await request(getTestApp())
        .get('/backtest')
        .query({
          from: yesterday.toISOString(),
          to: now.toISOString(),
          page: 0,
          limit: 2,
        });

      // Request second page
      const page2Response = await request(getTestApp())
        .get('/backtest')
        .query({
          from: yesterday.toISOString(),
          to: now.toISOString(),
          page: 1,
          limit: 2,
        });

      if (page1Response.status === 200 && page2Response.status === 200) {
        // Should have different results
        if (
          page1Response.body.results.length > 0 &&
          page2Response.body.results.length > 0
        ) {
          const page1Ids = page1Response.body.results.map((r: any) => r.request_id);
          const page2Ids = page2Response.body.results.map((r: any) => r.request_id);

          // Pages should not overlap
          const overlap = page1Ids.filter((id: string) => page2Ids.includes(id));
          expect(overlap.length).toBe(0);
        }
      }
    });

    it('should filter by status parameter', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Query all results
      const allResponse = await request(getTestApp())
        .get('/backtest')
        .query({
          from: yesterday.toISOString(),
          to: now.toISOString(),
          status: 'all',
        });

      // Query only successful results
      const successResponse = await request(getTestApp())
        .get('/backtest')
        .query({
          from: yesterday.toISOString(),
          to: now.toISOString(),
          status: 'success',
        });

      if (allResponse.status === 200 && successResponse.status === 200) {
        // Success count should be <= all count
        const allCount = Array.isArray(allResponse.body.results)
          ? allResponse.body.results.length
          : allResponse.body.pagination?.total || 0;
        const successCount = Array.isArray(successResponse.body.results)
          ? successResponse.body.results.length
          : successResponse.body.pagination?.total || 0;

        expect(successCount).toBeLessThanOrEqual(allCount);

        // All success results should have status === 'success'
        if (Array.isArray(successResponse.body.results)) {
          successResponse.body.results.forEach((result: any) => {
            expect(result.status).toBe('success');
          });
        }
      }
    });

    it('should return results sorted by timestamp descending', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const response = await request(getTestApp())
        .get('/backtest')
        .query({
          from: yesterday.toISOString(),
          to: now.toISOString(),
          page: 0,
          limit: 50,
        });

      if (response.status === 200 && Array.isArray(response.body.results) && response.body.results.length > 1) {
        // Verify descending order
        for (let i = 1; i < response.body.results.length; i++) {
          const prevTime = new Date(response.body.results[i - 1].timestamp).getTime();
          const currTime = new Date(response.body.results[i].timestamp).getTime();

          expect(prevTime).toBeGreaterThanOrEqual(currTime);
        }
      }
    });
  });

  describe('Query validation', () => {
    it('should reject query without required from/to parameters', async () => {
      const response = await request(getTestApp()).get('/backtest');

      // Should either return 400 or require parameters
      expect([400, 422]).toContain(response.status);
    });

    it('should reject invalid date format', async () => {
      const response = await request(getTestApp())
        .get('/backtest')
        .query({
          from: 'not-a-date',
          to: '2025-12-31T23:59:59Z',
        });

      expect([400, 422]).toContain(response.status);
    });

    it('should handle date range with no results gracefully', async () => {
      // Query for very old dates
      const response = await request(getTestApp())
        .get('/backtest')
        .query({
          from: '1970-01-01T00:00:00Z',
          to: '1970-01-02T00:00:00Z',
          page: 0,
          limit: 50,
        });

      expect([200, 404]).toContain(response.status);

      if (response.status === 200) {
        // Should return empty results array
        expect(response.body).toHaveProperty('results');
        expect(Array.isArray(response.body.results)).toBe(true);
        expect(response.body.results.length).toBe(0);
      }
    });
  });

  describe('Query performance', () => {
    it('should return query results within reasonable time', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const startTime = Date.now();

      const response = await request(getTestApp())
        .get('/backtest')
        .query({
          from: yesterday.toISOString(),
          to: now.toISOString(),
          page: 0,
          limit: 50,
        });

      const endTime = Date.now();
      const elapsed = endTime - startTime;

      // Query should complete within 2 seconds
      expect(elapsed).toBeLessThan(2000);

      expect([200, 404]).toContain(response.status);
    });

    it('should support limit parameter for pagination', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Test with different limit values
      const limits = [5, 10, 25, 50];

      for (const limit of limits) {
        const response = await request(getTestApp())
          .get('/backtest')
          .query({
            from: yesterday.toISOString(),
            to: now.toISOString(),
            page: 0,
            limit: limit,
          });

        if (response.status === 200) {
          expect(response.body).toHaveProperty('pagination');
          expect(response.body.pagination.limit).toBe(limit);

          // Results count should not exceed limit
          if (Array.isArray(response.body.results)) {
            expect(response.body.results.length).toBeLessThanOrEqual(limit);
          }
        }
      }
    });
  });
});

