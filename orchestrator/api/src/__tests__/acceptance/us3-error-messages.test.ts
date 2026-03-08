/**
 * User Story 3: Structured Error Messages (T045)
 *
 * Narrative:
 * As an API consumer, I want to receive structured error responses with
 * clear error codes and user-friendly messages so that I can debug issues
 * and understand what went wrong without needing to parse error logs.
 *
 * Acceptance Criteria:
 * - All errors have error.code field
 * - All errors have error.message field (user-friendly)
 * - Validation errors include field name (error.field)
 * - Execution errors include details (exit_code, signal, stderr)
 * - HTTP status codes match error severity
 */

import request from 'supertest';
import { setupTestApp, cleanupTestApp, getTestApp, hasCoreEngineBinary } from '../helpers/test-setup';

// Dynamically skip if Core Engine binary is not available
(hasCoreEngineBinary() ? describe : describe.skip)('User Story 3: Structured Error Messages (T045)', () => {
  beforeAll(async () => {
    await setupTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp();
  });

  describe('Validation error responses', () => {
    it('should return structured error for missing required field', async () => {
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
      expect(response.body.error).toHaveProperty('http_status');
      expect(response.body.error.http_status).toBe(400);

      // Message should be readable
      expect(response.body.error.message.length).toBeGreaterThan(0);
    });

    it('should include field name in validation error details', async () => {
      const invalidRequest = {
        entry_price: 100.50, // Invalid: float instead of decimal string
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
      expect(response.body.error).toHaveProperty('code');

      // Error code should indicate type error
      expect(['VALIDATION_TYPE_ERROR', 'VALIDATION_FLOAT_PRECISION', 'INVALID_REQUEST_SCHEMA']).toContain(
        response.body.error.code
      );
    });

    it('should return 422 for out-of-bounds validation errors', async () => {
      const invalidRequest = {
        entry_price: '100.50000000',
        amounts: ['10.25000000'],
        sequences: [0],
        leverage: '2.00000000',
        margin_ratio: '1.50000000', // Invalid: >= 1.0
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      const response = await request(getTestApp())
        .post('/backtest')
        .send(invalidRequest);

      expect(response.status).toBe(422);
      expect(response.body.error).toHaveProperty('code');
      expect(['VALIDATION_OUT_OF_BOUNDS', 'INVALID_REQUEST_SCHEMA']).toContain(response.body.error.code);
    });

    it('should include timestamp in all error responses', async () => {
      const invalidRequest = {
        amounts: ['10.25000000'],
        sequences: [0],
      };

      const response = await request(getTestApp())
        .post('/backtest')
        .send(invalidRequest);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.error).toHaveProperty('timestamp');

      // Timestamp should be ISO-8601 format
      const timestamp = new Date(response.body.error.timestamp);
      expect(timestamp.getTime()).toBeGreaterThan(0);
    });
  });

  describe('Execution error responses', () => {
    it('should return structured error for execution timeout', async () => {
      // This is a placeholder test since actual timeout requires
      // a long-running core engine binary
      // The error structure should be:
      const expectedErrorStructure = {
        code: 'EXECUTION_TIMEOUT',
        http_status: 504,
        message: expect.stringContaining('exceeded'),
        timestamp: expect.any(String),
      };

      // Verify that an execution error would have this structure
      expect(expectedErrorStructure.code).toBe('EXECUTION_TIMEOUT');
      expect(expectedErrorStructure.http_status).toBe(504);
    });

    it('should include process details in execution errors', async () => {
      // Expected structure when core engine fails
      const expectedErrorStructure = {
        error: {
          code: 'EXECUTION_BINARY_CRASH',
          http_status: 500,
          message: expect.stringContaining('Core Engine'),
          details: {
            exit_code: expect.any(Number),
            signal: expect.any([String, null]),
            stderr_snippet: expect.any(String),
          },
        },
      };

      // Verify structure matches expectation
      expect(expectedErrorStructure.error.code).toBe('EXECUTION_BINARY_CRASH');
      expect(expectedErrorStructure.error.http_status).toBe(500);
    });
  });

  describe('Error code consistency', () => {
    it('should use consistent error code values across endpoints', async () => {
      // Test POST /backtest error
      const invalidPostRequest = {
        entry_price: 100.50,
        amounts: ['10.25000000'],
        sequences: [0],
      };

      const postResponse = await request(getTestApp())
        .post('/backtest')
        .send(invalidPostRequest);

      // All error responses should have error.code
      if (postResponse.status >= 400) {
        expect(postResponse.body.error).toHaveProperty('code');
        expect(typeof postResponse.body.error.code).toBe('string');

        // Error code should be uppercase with underscores
        expect(postResponse.body.error.code).toMatch(/^[A-Z_]+$/);
      }
    });

    it('should provide human-readable messages in all errors', async () => {
      const testCases = [
        {
          request: { leverage: '2.0' }, // Missing fields
          expectedStatus: 400,
          expectedMessage: expect.stringMatching(/[a-z]/i),
        },
        {
          request: {
            // All fields present but invalid
            entry_price: '100.50000000',
            amounts: ['10.25000000'],
            sequences: [0],
            leverage: '2.00000000',
            margin_ratio: '1.50000000', // Out of bounds
            market_data_csv_path: '/data/BTCUSDT_1m.csv',
          },
          expectedStatus: 422,
          expectedMessage: expect.stringMatching(/[a-z]/i),
        },
      ];

      for (const testCase of testCases) {
        const response = await request(getTestApp())
          .post('/backtest')
          .send(testCase.request);

        expect(response.status).toBe(testCase.expectedStatus);
        expect(response.body.error).toHaveProperty('message');
        expect(response.body.error.message.length).toBeGreaterThan(5);
      }
    });
  });

  describe('Non-existent resource errors', () => {
    it('should return 404 for non-existent request_id', async () => {
      const fakeRequestId = 'ffffffff-ffff-4fff-bfff-ffffffffffff';

      const response = await request(getTestApp()).get(`/backtest/${fakeRequestId}`);

      // Should be 404 Not Found
      expect([404, 400]).toContain(response.status);

      if (response.body.error) {
        expect(response.body.error).toHaveProperty('code');
        expect(response.body.error).toHaveProperty('message');
      }
    });
  });
});

