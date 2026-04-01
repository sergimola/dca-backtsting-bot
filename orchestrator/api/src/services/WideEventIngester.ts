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

    // 4. Raw streaming insert via exec() — avoids the object-mode requirement
    //    of insert() and the parse→stringify overhead for millions of events.
    //    date_time_input_format=best_effort lets ClickHouse accept ISO 8601 timestamps
    //    with the 'Z' suffix produced by Go's time.Time JSON marshalling.
    const stream = createReadStream(filePath);
    const execResult = await this.client.exec({
      query: `INSERT INTO ${this.db}.wide_events FORMAT JSONEachRow`,
      values: stream,
      clickhouse_settings: {
        date_time_input_format: 'best_effort',
      },
    } as any);
    // Drain the response stream to release the HTTP connection
    if (execResult?.stream) {
      execResult.stream.on('data', () => {});
      await new Promise<void>((resolve) => execResult.stream.on('end', resolve));
    }

    return {
      rowsInserted: -1, // exec() does not return row count; -1 signals success
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
