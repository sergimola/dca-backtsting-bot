import { WideEventIngester } from './WideEventIngester.js';
import type { ClickHouseClient } from '@clickhouse/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function makeMockClient() {
  return {
    command: jest.fn().mockResolvedValue({ query_id: 'test' }),
    exec: jest.fn().mockImplementation(async (params: any) => {
      // Consume and destroy the file stream to prevent dangling handles
      if (params?.values && typeof params.values.destroy === 'function') {
        params.values.on('error', () => {});
        params.values.resume();   // drain
        params.values.destroy();
      }
      return { stream: { on: (_: string, cb: () => void) => { cb(); } }, query_id: 'test' };
    }),
  };
}

function makeJsonlLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ schema_version: 1, run_id: 'test-run-123', event_type: 'price_changed', ...overrides });
}

describe('WideEventIngester', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wide-event-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(name: string, content: string): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  it('empty file returns rowsInserted 0 with no ClickHouse calls', async () => {
    const mock = makeMockClient();
    const ingester = new WideEventIngester(mock as unknown as ClickHouseClient, 'data');
    const filePath = writeFile('empty.jsonl', '');

    const result = await ingester.ingest('test-run-123', filePath);

    expect(result.rowsInserted).toBe(0);
    expect(mock.command).not.toHaveBeenCalled();
    expect(mock.exec).not.toHaveBeenCalled();
  });

  it('schema_version !== 1 throws before any ClickHouse calls', async () => {
    const mock = makeMockClient();
    const ingester = new WideEventIngester(mock as unknown as ClickHouseClient, 'data');
    const filePath = writeFile('bad-schema.jsonl', makeJsonlLine({ schema_version: 99 }) + '\n');

    await expect(ingester.ingest('test-run-123', filePath)).rejects.toThrow('Unsupported schema_version: 99');
    expect(mock.command).not.toHaveBeenCalled();
    expect(mock.exec).not.toHaveBeenCalled();
  });

  it('valid file: DROP PARTITION called before insert', async () => {
    const mock = makeMockClient();
    const ingester = new WideEventIngester(mock as unknown as ClickHouseClient, 'data');
    const lines = [makeJsonlLine(), makeJsonlLine(), makeJsonlLine()].join('\n') + '\n';
    const filePath = writeFile('valid.jsonl', lines);

    const callOrder: string[] = [];
    mock.command.mockImplementation(async () => { callOrder.push('command'); return { query_id: 'test' }; });
    mock.exec.mockImplementation(async (params: any) => {
      if (params?.values && typeof params.values.destroy === 'function') {
        params.values.on('error', () => {});
        params.values.resume();
        params.values.destroy();
      }
      callOrder.push('exec');
      return { stream: { on: (_: string, cb: () => void) => { cb(); } }, query_id: 'test' };
    });

    const result = await ingester.ingest('test-run-123', filePath);

    expect(callOrder).toEqual(['command', 'exec']);
    expect(result.rowsInserted).toBe(-1);
  });

  it('DROP PARTITION query contains the correct runId', async () => {
    const mock = makeMockClient();
    const ingester = new WideEventIngester(mock as unknown as ClickHouseClient, 'data');
    const filePath = writeFile('run-id-check.jsonl', makeJsonlLine() + '\n');

    await ingester.ingest('my-run-42', filePath);

    expect(mock.command).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('my-run-42'),
      }),
    );
  });

  it('rejects runId with SQL injection characters', async () => {
    const mock = makeMockClient();
    const ingester = new WideEventIngester(mock as unknown as ClickHouseClient, 'data');
    const filePath = writeFile('injection.jsonl', makeJsonlLine() + '\n');

    await expect(ingester.ingest("'; DROP TABLE --", filePath)).rejects.toThrow('Invalid runId format');
    expect(mock.command).not.toHaveBeenCalled();
  });
});
