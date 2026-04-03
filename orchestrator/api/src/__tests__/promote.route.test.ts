/**
 * T026: Promote route unit tests.
 *
 * Tests the POST /optimizer/session/:sessionId/promote validation logic
 * against mocked dependencies. The SSE streaming tests use raw HTTP
 * to a real Express app with a stubbed engine process.
 */

import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import http from 'http';

let mockChild: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: jest.Mock; stdin: PassThrough };
let spawnResolve: (() => void) | null = null;

function createMockChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: jest.Mock; stdin: PassThrough };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = jest.fn();
  return child;
}

jest.mock('child_process', () => ({
  spawn: jest.fn(() => {
    mockChild = createMockChild();
    if (spawnResolve) spawnResolve();
    return mockChild;
  }),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    writeFileSync: jest.fn(),
    unlinkSync: jest.fn(),
  };
});

jest.mock('../services/ClickHouseClient', () => ({
  chClient: {
    insert: jest.fn().mockResolvedValue(undefined),
    command: jest.fn().mockResolvedValue(undefined),
  },
  database: 'data',
}));

const mockBulkDelete = jest.fn().mockResolvedValue(undefined);
const mockWriterPush = jest.fn().mockResolvedValue(undefined);
const mockWriterFlush = jest.fn().mockResolvedValue(undefined);

jest.mock('../services/ClickHouseWideEventWriter', () => {
  return {
    ClickHouseWideEventWriter: jest.fn().mockImplementation(() => ({
      push: mockWriterPush,
      flush: mockWriterFlush,
      bulkDeleteBeforeInsert: mockBulkDelete,
    })),
    WideEventRow: undefined,
  };
});

import express from 'express';
import request from 'supertest';
import { createOptimizerRouter } from '../routes/optimizer.routes.js';
import { OptimizerSessionStore } from '../services/OptimizerSessionStore.js';
import { SweepService } from '../services/SweepService.js';
import { randomUUID } from 'crypto';

const mockGetRunSummaries = jest.fn();
const mockSetPromotedAt = jest.fn().mockResolvedValue(undefined);
const mockSweepPersistence = {
  getRunSummaries: mockGetRunSummaries,
  setPromotedAt: mockSetPromotedAt,
  createSession: jest.fn(),
  persistRunSummary: jest.fn(),
  finalizeSession: jest.fn(),
  getSessions: jest.fn(),
  deleteSession: jest.fn(),
} as any;

function buildApp(sessionStore: OptimizerSessionStore) {
  const app = express();
  app.use(express.json());
  const sweepService = new SweepService('./engine');
  app.use('/optimizer', createOptimizerRouter(sweepService, sessionStore, mockSweepPersistence));
  return app;
}

function waitForSpawn(): Promise<void> {
  return new Promise<void>(resolve => { spawnResolve = resolve; });
}

/** Fire a POST and collect SSE events via raw http, returning parsed events once the stream ends. */
function postSSE(
  server: http.Server,
  path: string,
  body: unknown,
): Promise<Array<Record<string, unknown>>> {
  const port = (server.address() as { port: number }).port;
  return new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { buf += chunk; });
        res.on('end', () => {
          const parsed = buf
            .split('\n')
            .filter(l => l.startsWith('data: '))
            .map(l => JSON.parse(l.slice(6)));
          resolve(parsed);
        });
      },
    );
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

describe('T026: POST /optimizer/session/:sessionId/promote', () => {
  let sessionStore: OptimizerSessionStore;
  const sessionId = '00000000-0000-0000-0000-000000000001';
  const runId1 = randomUUID();
  const runId2 = randomUUID();
  const runId3 = randomUUID();

  beforeEach(() => {
    jest.clearAllMocks();
    spawnResolve = null;
    sessionStore = new OptimizerSessionStore();
  });

  it('returns 400 when run_ids count exceeds 200', async () => {
    const app = buildApp(sessionStore);
    const bigRunIds = Array.from({ length: 201 }, () => randomUUID());

    const res = await request(app)
      .post(`/optimizer/session/${sessionId}/promote`)
      .send({ run_ids: bigRunIds });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds cap of 200/);
  });

  it('returns 400 when run_ids is empty', async () => {
    const app = buildApp(sessionStore);

    const res = await request(app)
      .post(`/optimizer/session/${sessionId}/promote`)
      .send({ run_ids: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty/);
  });

  it('returns 409 when a promotion is already active for the session', async () => {
    const app = buildApp(sessionStore);
    const server = app.listen(0);

    mockGetRunSummaries.mockResolvedValue([
      { runId: runId1, configJson: { trading_pair: 'BTC/USDT' }, promotedAt: null },
    ]);

    // Fire first promotion (fire-and-forget — don't await the SSE stream yet)
    const spawnReady = waitForSpawn();
    const firstEvents = postSSE(server, `/optimizer/session/${sessionId}/promote`, { run_ids: [runId1] });

    // Wait until engine has been spawned, confirming the route is in SSE mode
    await spawnReady;

    // Second request should get 409 since activePromotions has sessionId
    const secondRes = await request(server)
      .post(`/optimizer/session/${sessionId}/promote`)
      .send({ run_ids: [runId1] });

    expect(secondRes.status).toBe(409);
    expect(secondRes.body.error).toMatch(/already in progress/);

    // Clean up: close the first request's engine
    mockChild.emit('close', 0);
    await firstEvents;
    server.close();
  }, 10000);

  it('streams promotion_progress then promotion_complete for valid run_ids', async () => {
    const app = buildApp(sessionStore);
    const server = app.listen(0);

    mockGetRunSummaries.mockResolvedValue([
      { runId: runId1, configJson: { trading_pair: 'BTC/USDT' }, promotedAt: null },
      { runId: runId2, configJson: { trading_pair: 'BTC/USDT' }, promotedAt: null },
    ]);

    const spawnReady = waitForSpawn();
    const eventsPromise = postSSE(server, `/optimizer/session/${sessionId}/promote`, { run_ids: [runId1, runId2] });

    await spawnReady;

    // Simulate engine sending 2 results then closing
    mockChild.stdout.write(JSON.stringify({ type: 'result', run_id: runId1 }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 30));
    mockChild.stdout.write(JSON.stringify({ type: 'result', run_id: runId2 }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 30));
    mockChild.emit('close', 0);

    const sseEvents = await eventsPromise;
    server.close();

    const progressEvents = sseEvents.filter(e => e.type === 'promotion_progress');
    const completeEvents = sseEvents.filter(e => e.type === 'promotion_complete');

    expect(progressEvents.length).toBe(2);
    expect(progressEvents[0].completed).toBe(1);
    expect(progressEvents[1].completed).toBe(2);
    expect(completeEvents.length).toBe(1);
    expect(completeEvents[0].completed).toBe(2);
    expect(completeEvents[0].failed).toBe(0);
    expect(mockSetPromotedAt).toHaveBeenCalledTimes(2);
  }, 10000);

  it('emits promotion_error for a failed run without closing the stream early', async () => {
    const app = buildApp(sessionStore);
    const server = app.listen(0);

    mockGetRunSummaries.mockResolvedValue([
      { runId: runId1, configJson: { trading_pair: 'BTC/USDT' }, promotedAt: null },
      { runId: runId2, configJson: { trading_pair: 'BTC/USDT' }, promotedAt: null },
      { runId: runId3, configJson: { trading_pair: 'BTC/USDT' }, promotedAt: null },
    ]);

    const spawnReady = waitForSpawn();
    const eventsPromise = postSSE(server, `/optimizer/session/${sessionId}/promote`, { run_ids: [runId1, runId2, runId3] });

    await spawnReady;

    // Run 1 succeeds
    mockChild.stdout.write(JSON.stringify({ type: 'result', run_id: runId1 }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 30));

    // Run 2 errors
    mockChild.stdout.write(JSON.stringify({ type: 'error', run_id: runId2, error: 'candle parse failure' }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 30));

    // Run 3 succeeds — stream should NOT have closed
    mockChild.stdout.write(JSON.stringify({ type: 'result', run_id: runId3 }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 30));

    mockChild.emit('close', 0);
    const sseEvents = await eventsPromise;
    server.close();

    const progressEvents = sseEvents.filter(e => e.type === 'promotion_progress');
    const errorEvents = sseEvents.filter(e => e.type === 'promotion_error');
    const completeEvents = sseEvents.filter(e => e.type === 'promotion_complete');

    expect(progressEvents.length).toBe(2);
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].run_id).toBe(runId2);
    expect(errorEvents[0].error).toBe('candle parse failure');
    expect(completeEvents.length).toBe(1);
    expect(completeEvents[0].completed).toBe(2);
    expect(completeEvents[0].failed).toBe(1);
  }, 10000);

  it('T033: calls bulkDeleteBeforeInsert exactly once when re-promoting already-promoted runs', async () => {
    const app = buildApp(sessionStore);
    const server = app.listen(0);

    // Mark runId1 as already promoted (non-null promotedAt)
    mockGetRunSummaries.mockResolvedValue([
      { runId: runId1, configJson: { trading_pair: 'BTC/USDT' }, promotedAt: '2025-01-15T12:00:00Z' },
      { runId: runId2, configJson: { trading_pair: 'BTC/USDT' }, promotedAt: '2025-01-15T12:00:00Z' },
      { runId: runId3, configJson: { trading_pair: 'BTC/USDT' }, promotedAt: null },
    ]);

    const spawnReady = waitForSpawn();
    const eventsPromise = postSSE(server, `/optimizer/session/${sessionId}/promote`, { run_ids: [runId1, runId2, runId3] });

    await spawnReady;

    // bulkDeleteBeforeInsert should have been called exactly once with the 2 already-promoted IDs
    expect(mockBulkDelete).toHaveBeenCalledTimes(1);
    expect(mockBulkDelete).toHaveBeenCalledWith(sessionId, [runId1, runId2]);

    // Close engine to clean up
    mockChild.emit('close', 0);
    await eventsPromise;
    server.close();
  }, 10000);
});
