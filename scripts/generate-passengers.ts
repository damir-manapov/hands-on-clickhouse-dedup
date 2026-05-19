/**
 * Generate realistic passenger data into ClickHouse using @mkven/samples-generation.
 *
 * Uses real Russian name dictionaries (@mkven/name-dictionaries) for high-cardinality
 * firstname/lastname/patronymic fields, and applies a low-probability `mutate`
 * transformation to introduce realistic typos for dedup testing.
 *
 * Usage:
 *   pnpm generate --rows 100000 --drop
 *   pnpm generate --host localhost --port 8123 --database dedup --user default --password clickhouse
 */
import { parseArgs } from "node:util";
import {
  getRussianFemaleNames,
  getRussianMaleNames,
  getRussianMaleSurnames,
  getRussianPatronymics,
} from "@mkven/name-dictionaries";
import { ClickHouseDataGenerator, formatDuration, type Scenario } from "@mkven/samples-generation";

const DEFAULT_ROWS = 100_000;

// ~3,356 male + ~1,434 female = ~4,790 first names in Cyrillic
const FIRST_NAMES: string[] = [...getRussianMaleNames(), ...getRussianFemaleNames()];

// ~34,803 surnames (male forms, includes ~10,832 unisex) in Cyrillic
const LAST_NAMES: string[] = getRussianMaleSurnames();

// Patronymics derived from male first names (both genders), provided by
// @mkven/name-dictionaries — handles classic exceptions (Илья, Лука, Кузьма,
// Никита, ...) and -а/-я endings correctly.
const { male: MALE_PATRONYMICS, female: FEMALE_PATRONYMICS } = getRussianPatronymics();
const PATRONYMICS: string[] = [...MALE_PATRONYMICS, ...FEMALE_PATRONYMICS];

const DOCUMENT_TYPES = [
  "passport",
  "foreign_passport",
  "birth_certificate",
  "id_card",
  "residence_permit",
];

const { values } = parseArgs({
  options: {
    rows: { type: "string", short: "r", default: String(DEFAULT_ROWS) },
    batch: { type: "string", short: "b" },
    drop: { type: "boolean", default: false },
    truncate: { type: "boolean", default: false },
    host: { type: "string", default: "localhost" },
    port: { type: "string", default: "8123" },
    database: { type: "string", default: "dedup" },
    user: { type: "string", default: "default" },
    password: { type: "string", default: "clickhouse" },
    help: { type: "boolean", short: "h", default: false },
  },
});

function printHelp(): void {
  console.log(`
Usage: pnpm generate [options]

Options:
  -r, --rows <count>      Number of passengers (default: ${DEFAULT_ROWS})
  -b, --batch <size>      Batch size for insert
  --drop                  Drop tables before generation
  --truncate              Truncate tables before generation
  --host <host>           ClickHouse host (default: localhost)
  --port <port>           ClickHouse port (default: 8123)
  --database <db>         ClickHouse database (default: dedup)
  --user <user>           ClickHouse user (default: default)
  --password <password>   ClickHouse password (default: clickhouse)
  -h, --help              Show this help message
`);
}

function createScenario(rowCount: number): Scenario {
  const documentRowCount = rowCount * 2;

  return {
    name: "ClickHouse passengers generation",
    steps: [
      {
        table: {
          name: "passengers",
          columns: [
            {
              name: "id",
              type: "bigint",
              generator: { kind: "sequence", start: 1 },
            },
            {
              name: "firstname",
              type: "string",
              generator: { kind: "choice", values: FIRST_NAMES },
            },
            {
              name: "lastname",
              type: "string",
              generator: { kind: "choice", values: LAST_NAMES },
            },
            {
              name: "patronymic",
              type: "string",
              generator: { kind: "choice", values: PATRONYMICS },
            },
            {
              name: "birthDate",
              type: "date",
              generator: { kind: "datetime" },
            },
            {
              name: "phoneNumber",
              type: "string",
              generator: { kind: "randomString", length: 11 },
            },
          ],
        },
        rowCount,
      },
      {
        table: {
          name: "passengerDocuments",
          columns: [
            {
              name: "passengerId",
              type: "bigint",
              generator: { kind: "randomInt", min: 1, max: rowCount },
            },
            {
              name: "docType",
              type: "string",
              generator: { kind: "choice", values: DOCUMENT_TYPES },
            },
            {
              // 10-char string mimics Russian passport format (4-digit series + 6-digit number).
              // High cardinality avoids false-positive docNumber collisions at large row counts.
              name: "docNumber",
              type: "string",
              generator: { kind: "randomString", length: 5 },
            },
          ],
        },
        rowCount: documentRowCount,
      },
    ],
  };
}

function parseIntOrThrow(value: string, label: string): number {
  const n = Number.parseInt(value.replace(/_/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer, got: ${value}`);
  }
  return n;
}

async function main(): Promise<void> {
  if (values.help) {
    printHelp();
    return;
  }

  const rowCount = parseIntOrThrow(values.rows, "rows");
  const batchSize = values.batch ? parseIntOrThrow(values.batch, "batch") : undefined;

  const generator = new ClickHouseDataGenerator({
    host: values.host,
    port: Number.parseInt(values.port, 10),
    database: values.database,
    username: values.user,
    password: values.password,
  });

  try {
    await generator.connect();
    console.log(`Connected to ClickHouse at ${values.host}:${values.port}/${values.database}`);

    const result = await generator.runScenario({
      scenario: createScenario(rowCount),
      dropFirst: values.drop,
      truncateFirst: values.truncate,
      ...(batchSize !== undefined ? { batchSize } : {}),
    });

    for (const step of result.steps) {
      if (step.generate) {
        console.log(
          `[${step.tableName}] Generated ${step.generate.rowsInserted.toLocaleString()} rows in ${formatDuration(
            step.generate.generateMs
          )}`
        );
      }
    }

    console.log(
      `Total: ${result.totalRowsInserted.toLocaleString()} rows in ${formatDuration(result.durationMs)}`
    );

    const passengersCount = await generator.countRows("passengers");
    const passengersSample = await generator.queryRows("passengers", 5);
    console.log(`[passengers] rows: ${passengersCount.toLocaleString()}`);
    console.table(passengersSample);

    const documentsCount = await generator.countRows("passengerDocuments");
    const documentsSample = await generator.queryRows("passengerDocuments", 5);
    console.log(`[passengerDocuments] rows: ${documentsCount.toLocaleString()}`);
    console.table(documentsSample);
  } finally {
    await generator.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
