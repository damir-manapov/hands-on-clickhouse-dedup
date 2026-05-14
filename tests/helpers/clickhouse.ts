import { type ClickHouseClient, createClient } from "@clickhouse/client";

export const TEST_PASSENGERS_PREFIX = "passengers_test_";
export const TEST_DOCUMENTS_PREFIX = "documents_test_";

export function createTestClient(): ClickHouseClient {
  const env = process.env;
  const host = env["CLICKHOUSE_HOST"] ?? "localhost";
  const port = env["CLICKHOUSE_PORT"] ?? "8123";
  const database = env["CLICKHOUSE_DATABASE"] ?? "dedup";
  const username = env["CLICKHOUSE_USER"] ?? "default";
  const password = env["CLICKHOUSE_PASSWORD"] ?? "clickhouse";

  return createClient({
    url: `http://${host}:${port}`,
    database,
    username,
    password,
  });
}

/** Drop every test-owned table. Safe to call repeatedly. */
export async function dropOrphanTestTables(client: ClickHouseClient): Promise<void> {
  const result = await client.query({
    query: `
      SELECT name FROM system.tables
      WHERE database = currentDatabase()
        AND (name LIKE '${TEST_PASSENGERS_PREFIX}%' OR name LIKE '${TEST_DOCUMENTS_PREFIX}%')
    `,
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as ReadonlyArray<{ name: string }>;
  for (const row of rows) {
    await client.command({ query: `DROP TABLE IF EXISTS \`${row.name}\`` });
  }
}
