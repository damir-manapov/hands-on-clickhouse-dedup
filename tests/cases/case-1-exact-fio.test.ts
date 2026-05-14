import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildExactFioDuplicates } from "../../src/sql-builder/index.js";
import { createTestClient } from "../helpers/clickhouse.js";
import { type CaseFixture, createCaseFixture, type Passenger } from "../helpers/fixtures.js";

interface ExactFioRow {
  firstname: string;
  lastname: string;
  patronymic: string;
  duplicates_count: number;
}

async function runExactFio(
  client: ClickHouseClient,
  fixture: CaseFixture
): Promise<ReadonlyArray<ExactFioRow>> {
  const sql = buildExactFioDuplicates({ passengersTable: fixture.passengersTable });
  const result = await client.query({ query: sql, format: "JSONEachRow" });
  return (await result.json()) as ReadonlyArray<ExactFioRow>;
}

describe("case 1 — exact firstname + lastname + patronymic duplicates", () => {
  let client: ClickHouseClient;
  let fixtures: CaseFixture[] = [];

  beforeAll(() => {
    client = createTestClient();
  });

  afterEach(async () => {
    await Promise.all(fixtures.map((f) => f.cleanup()));
    fixtures = [];
  });

  afterAll(async () => {
    await client.close();
  });

  async function load(passengers: ReadonlyArray<Passenger>): Promise<CaseFixture> {
    const fixture = await createCaseFixture(client, passengers);
    fixtures.push(fixture);
    return fixture;
  }

  it("returns a single row with count=2 for one duplicate pair", async () => {
    const fixture = await load([
      { id: 1, firstname: "Ivan", lastname: "Sur", patronymic: "Pat" },
      { id: 2, firstname: "Ivan", lastname: "Sur", patronymic: "Pat" },
    ]);

    const rows = await runExactFio(client, fixture);

    expect(rows).toEqual([
      { firstname: "Ivan", lastname: "Sur", patronymic: "Pat", duplicates_count: 2 },
    ]);
  });

  it("returns count=3 for a triplet (cardinality > 2)", async () => {
    const fixture = await load([
      { id: 1, firstname: "Trio", lastname: "Sur", patronymic: "Pat" },
      { id: 2, firstname: "Trio", lastname: "Sur", patronymic: "Pat" },
      { id: 3, firstname: "Trio", lastname: "Sur", patronymic: "Pat" },
    ]);

    const rows = await runExactFio(client, fixture);

    expect(rows).toEqual([
      { firstname: "Trio", lastname: "Sur", patronymic: "Pat", duplicates_count: 3 },
    ]);
  });

  it("excludes singletons (HAVING count > 1)", async () => {
    const fixture = await load([
      { id: 1, firstname: "Solo", lastname: "Unique", patronymic: "Onlyone" },
      { id: 2, firstname: "Pair", lastname: "Sur", patronymic: "Pat" },
      { id: 3, firstname: "Pair", lastname: "Sur", patronymic: "Pat" },
    ]);

    const rows = await runExactFio(client, fixture);

    expect(rows).toEqual([
      { firstname: "Pair", lastname: "Sur", patronymic: "Pat", duplicates_count: 2 },
    ]);
  });

  it("returns empty for a fully unique dataset", async () => {
    const fixture = await load([
      { id: 1, firstname: "A", lastname: "X", patronymic: "M" },
      { id: 2, firstname: "B", lastname: "Y", patronymic: "N" },
    ]);

    const rows = await runExactFio(client, fixture);

    expect(rows).toEqual([]);
  });
});
