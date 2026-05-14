import { createTestClient, dropOrphanTestTables } from "./clickhouse.js";

/**
 * Vitest globalSetup. Verifies ClickHouse is reachable and removes any
 * orphan test tables left behind by a previous crashed run. Returns a
 * teardown that does the same cleanup at the end.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const client = createTestClient();

  try {
    await client.ping();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client.close();
    throw new Error(
      `Cannot reach ClickHouse for tests: ${message}\n` +
        `Start it with: pnpm compose:up\n` +
        `Or override host via CLICKHOUSE_HOST / CLICKHOUSE_PORT / CLICKHOUSE_DATABASE env vars.`
    );
  }

  await dropOrphanTestTables(client);
  await client.close();

  return async (): Promise<void> => {
    const teardownClient = createTestClient();
    try {
      await dropOrphanTestTables(teardownClient);
    } finally {
      await teardownClient.close();
    }
  };
}
