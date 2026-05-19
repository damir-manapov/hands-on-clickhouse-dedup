/**
 * Run each query from sql/passengers_duplicate_checks.sql against ClickHouse
 * and report row count + query_duration_ms from system.query_log.
 *
 * Usage:
 *   pnpm bench
 *   pnpm bench --host localhost --port 8123 --database dedup
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createClient } from "@clickhouse/client";

const { values } = parseArgs({
  options: {
    host: { type: "string", default: "localhost" },
    port: { type: "string", default: "8123" },
    database: { type: "string", default: "dedup" },
    user: { type: "string", default: "default" },
    password: { type: "string", default: "clickhouse" },
    case: { type: "string", short: "c" },
  },
});

const SQL_PATH = join(import.meta.dirname, "../sql/passengers_duplicate_checks.sql");

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/** Split the file into { caseNumber, label, sql } entries by "-- N) ..." markers. */
function parseQueries(source: string): Array<{ n: number; label: string; sql: string }> {
  // Split on lines that start with "-- <digit(s)>)"
  const parts = source.split(/^(?=-- \d+\))/m);
  const result: Array<{ n: number; label: string; sql: string }> = [];

  for (const part of parts) {
    const headerMatch = /^-- (\d+)\)\s*(.+)$/m.exec(part);
    if (!headerMatch) continue;
    const n = Number.parseInt(headerMatch[1] ?? "", 10);
    const label = (headerMatch[2] ?? "").trim();
    // Strip comment lines, keep SQL lines
    const sql = part
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--") && line.trim() !== "")
      .join("\n")
      .trim();
    if (sql.length > 0) {
      result.push({ n, label, sql });
    }
  }

  return result.sort((a, b) => a.n - b.n);
}

async function main(): Promise<void> {
  const client = createClient({
    url: `http://${values.host}:${values.port}`,
    database: values.database,
    username: values.user,
    password: values.password,
    request_timeout: 60 * 60 * 1000, // 60 minutes — large self-joins at 100M+ rows can take a while
  });

  try {
    await client.ping();
    console.log(`Connected to ClickHouse at ${values.host}:${values.port}/${values.database}\n`);

    const source = readFileSync(SQL_PATH, "utf8");
    const allQueries = parseQueries(source);
    const selected = values.case
      ? new Set(values.case.split(",").map((s) => Number.parseInt(s.trim(), 10)))
      : null;
    const queries = selected ? allQueries.filter((q) => selected.has(q.n)) : allQueries;
    console.log(`Found ${queries.length} queries. Running...\n`);

    // Mark a timestamp we can filter system.query_log by (DateTime has second precision).
    const benchStart = new Date()
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, "");

    const results: Array<{ n: number; label: string; rows: number; durationMs: number }> = [];

    for (const { n, label, sql } of queries) {
      process.stdout.write(`Case ${n}: ${label} ... `);

      // Drop caches before each query for fair cold-cache comparison
      await client.command({ query: "SYSTEM DROP QUERY CACHE" });
      await client.command({ query: "SYSTEM DROP MARK CACHE" });
      await client.command({ query: "SYSTEM DROP UNCOMPRESSED CACHE" });

      const t0 = performance.now();

      const result = await client.query({
        query: sql,
        format: "JSONEachRow",
        clickhouse_settings: {
          // Force disk spill so large self-joins don't OOM at 100M+ rows.
          max_memory_usage: "20000000000",
          max_bytes_before_external_group_by: "8000000000",
          max_bytes_before_external_sort: "8000000000",
          max_bytes_in_join: "0",
          join_algorithm: "parallel_hash",
        },
      });
      const rows = (await result.json()) as unknown[];

      const wallMs = Math.round(performance.now() - t0);
      process.stdout.write(`${rows.length} rows, ${formatDuration(wallMs)} (wall)\n`);
      results.push({ n, label, rows: rows.length, durationMs: wallMs });
    }

    // Also pull server-side duration from query_log (more accurate than wall clock).
    await client.command({ query: "SYSTEM FLUSH LOGS" });

    const logResult = await client.query({
      query: `
        SELECT
          query,
          read_rows,
          round(query_duration_ms) AS query_duration_ms,
          round(memory_usage / 1048576) AS memory_mb
        FROM system.query_log
        WHERE type = 'QueryFinish'
          AND event_time >= '${benchStart}'
          AND query NOT LIKE '%system.query_log%'
          AND query NOT LIKE '%SYSTEM %'
          AND query LIKE '%passengers%'
        ORDER BY event_time
      `,
      format: "JSONEachRow",
    });

    type LogRow = {
      query: string;
      read_rows: number;
      query_duration_ms: number;
      memory_mb: number;
    };
    const logRows = (await logResult.json()) as LogRow[];

    console.log("\n=== Summary (server-side timings from system.query_log) ===\n");
    console.log("Case  Duration     Rows(out)  ReadRows(scan)  Memory(MB)  Label");
    console.log("-".repeat(80));

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r) continue;
      const log = logRows[i];
      const dur = log ? formatDuration(log.query_duration_ms).padStart(11) : "          ?";
      const readRows = log ? String(log.read_rows.toLocaleString()).padStart(14) : "             ?";
      const mem = log ? String(log.memory_mb).padStart(10) : "         ?";
      const outRows = String(r.rows).padStart(9);
      console.log(`  ${String(r.n).padEnd(4)} ${dur}  ${outRows}  ${readRows}  ${mem}  ${r.label}`);
    }
    console.log();
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
