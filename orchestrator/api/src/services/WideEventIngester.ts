import { createReadStream } from 'fs';
import { open, stat } from 'fs/promises';
import type { ClickHouseClient } from '@clickhouse/client';

export interface IngestResult {
  rowsInserted: number;
  durationMs: number;
}

/** Only alphanumeric, dots, hyphens, underscores — prevents SQL injection in ALTER TABLE. */
const SAFE_RUN_ID = /^[a-zA-Z0-9._-]+$/;

export class WideEventIngester {
  constructor(
    private readonly client: ClickHouseClient,
    private readonly db: string,
  ) {}

  async ingest(runId: string, filePath: string): Promise<IngestResult> {
    const startMs = Date.now();

    if (!SAFE_RUN_ID.test(runId)) {
      throw new Error(`Invalid runId format: ${runId}`);
    }

    // 1. Empty file guard
    const fileStat = await stat(filePath);
    if (fileStat.size === 0) {
      return { rowsInserted: 0, durationMs: Date.now() - startMs };
    }

    // 2. Schema version check (first line)
    const firstLine = await readFirstLine(filePath);
    const parsed = JSON.parse(firstLine);
    if (parsed.schema_version !== 1) {
      throw new Error(`Unsupported schema_version: ${parsed.schema_version}`);
    }

    // 3. Idempotent partition drop (zero-cost metadata operation)
    await this.client.command({
      query: `ALTER TABLE ${this.db}.wide_events DROP PARTITION '${runId}'`,
    });

    // 4. Streaming bulk insert
    const stream = createReadStream(filePath);
    const insertResult = await this.client.insert({
      table: `${this.db}.wide_events`,
      values: stream,
      format: 'JSONEachRow',
    });

    return {
      rowsInserted: parseInt(String(insertResult.summary?.written_rows ?? '0'), 10),
      durationMs: Date.now() - startMs,
    };
  }
}

async function readFirstLine(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buf, 0, 8192, 0);
    if (bytesRead === 0) throw new Error(`File is empty: ${filePath}`);
    const text = buf.toString('utf8', 0, bytesRead);
    const idx = text.indexOf('\n');
    return (idx >= 0 ? text.substring(0, idx) : text).trimEnd();
  } finally {
    await handle.close();
  }
}
