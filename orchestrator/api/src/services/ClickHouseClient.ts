import { createClient, ClickHouseClient } from '@clickhouse/client';

const host = process.env.CLICKHOUSE_HOST ?? 'localhost';
const port = process.env.CLICKHOUSE_PORT ?? '8123';
const username = process.env.CLICKHOUSE_USER ?? 'default';
const password = process.env.CLICKHOUSE_PASSWORD ?? '';
const database = process.env.CLICKHOUSE_DATABASE ?? 'dca_bot';

// Singleton ClickHouse HTTP client — shared across all services.
// The @clickhouse/client connection is request-scoped (stateless HTTP), so a
// single instance is safe under concurrent use.
export const chClient: ClickHouseClient = createClient({
  url: `http://${host}:${port}`,
  username,
  password,
  database,
  clickhouse_settings: {
    // Ensure we see deduplicated rows in gap-detection queries
    final: 1,
  },
});

/**
 * pingClickHouse runs a lightweight SELECT 1 against ClickHouse to verify
 * the connection is healthy. Called once at server startup.
 * Throws on connection failure so the process exits with a clear error.
 */
export async function pingClickHouse(): Promise<void> {
  const result = await chClient.query({
    query: 'SELECT 1',
    format: 'JSONEachRow',
  });
  await result.json(); // consume the response to confirm transport works
}
