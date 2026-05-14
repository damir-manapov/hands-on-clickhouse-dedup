import { randomUUID } from "node:crypto";
import type { ClickHouseClient } from "@clickhouse/client";
import { TEST_DOCUMENTS_PREFIX, TEST_PASSENGERS_PREFIX } from "./clickhouse.js";

export interface Passenger {
  readonly id: number;
  readonly firstname: string;
  readonly lastname: string;
  readonly patronymic: string;
  readonly birthDate?: string;
  readonly phoneNumber?: string;
}

export interface DocumentRow {
  readonly passengerId: number;
  readonly docType: string;
  readonly docNumber: string;
}

export interface CaseFixture {
  readonly passengersTable: string;
  readonly documentsTable: string;
  readonly cleanup: () => Promise<void>;
}

const DEFAULT_BIRTH_DATE = "1990-01-01";
const DEFAULT_PHONE = "00000000000";

/**
 * Create a unique pair of `passengers_test_*` / `documents_test_*` tables,
 * insert the given rows, and return a cleanup callback. Tables are isolated
 * per call, so concurrent tests cannot collide.
 */
export async function createCaseFixture(
  client: ClickHouseClient,
  passengers: ReadonlyArray<Passenger>,
  documents: ReadonlyArray<DocumentRow> = []
): Promise<CaseFixture> {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 16);
  const passengersTable = `${TEST_PASSENGERS_PREFIX}${suffix}`;
  const documentsTable = `${TEST_DOCUMENTS_PREFIX}${suffix}`;

  await client.command({
    query: `
      CREATE TABLE \`${passengersTable}\` (
        id Int64,
        firstname String,
        lastname String,
        patronymic String,
        birthDate Date,
        phoneNumber String
      ) ENGINE = MergeTree
      ORDER BY id
    `,
  });

  await client.command({
    query: `
      CREATE TABLE \`${documentsTable}\` (
        passengerId Int64,
        docType String,
        docNumber String
      ) ENGINE = MergeTree
      ORDER BY passengerId
    `,
  });

  if (passengers.length > 0) {
    await client.insert({
      table: passengersTable,
      values: passengers.map((p) => ({
        id: p.id,
        firstname: p.firstname,
        lastname: p.lastname,
        patronymic: p.patronymic,
        birthDate: p.birthDate ?? DEFAULT_BIRTH_DATE,
        phoneNumber: p.phoneNumber ?? DEFAULT_PHONE,
      })),
      format: "JSONEachRow",
    });
  }

  if (documents.length > 0) {
    await client.insert({
      table: documentsTable,
      values: documents.map((d) => ({ ...d })),
      format: "JSONEachRow",
    });
  }

  const cleanup = async (): Promise<void> => {
    await client.command({ query: `DROP TABLE IF EXISTS \`${passengersTable}\`` });
    await client.command({ query: `DROP TABLE IF EXISTS \`${documentsTable}\`` });
  };

  return { passengersTable, documentsTable, cleanup };
}
