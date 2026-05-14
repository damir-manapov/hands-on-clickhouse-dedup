import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildFirstnameLevenshteinDuplicates } from "../../src/sql-builder/index.js";
import { createTestClient } from "../helpers/clickhouse.js";
import { type CaseFixture, createCaseFixture, type Passenger } from "../helpers/fixtures.js";

interface FirstnameRow {
  lastname: string;
  patronymic: string;
  firstname_variant_1: string;
  firstname_variant_2: string;
  name_distance: number;
  total_possible_duplicates: number;
}

/**
 * Cross-case spec for `buildFirstnameLevenshteinDuplicates`:
 *   - self-join symmetry filter (no (a,b)+(b,a) doubling)
 *   - groups isolated by lastname + patronymic
 *   - distance 0 emitted as self-match for clusters > 1
 *   - singletons suppressed
 *   - distance ≤ maxDistance includes lower distances
 */
describe("cross-case — firstname levenshtein builder", () => {
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

  async function run(
    fixture: CaseFixture,
    maxDistance: number
  ): Promise<ReadonlyArray<FirstnameRow>> {
    const sql = buildFirstnameLevenshteinDuplicates({
      passengersTable: fixture.passengersTable,
      maxDistance,
    });
    const result = await client.query({ query: sql, format: "JSONEachRow" });
    return (await result.json()) as ReadonlyArray<FirstnameRow>;
  }

  it("a single firstname-distance-1 pair produces exactly one row, not two", async () => {
    const fixture = await load([
      { id: 1, firstname: "Petr", lastname: "Sur", patronymic: "Pat" },
      { id: 2, firstname: "Pety", lastname: "Sur", patronymic: "Pat" },
    ]);

    const rows = await run(fixture, 1);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      lastname: "Sur",
      patronymic: "Pat",
      firstname_variant_1: "Petr",
      firstname_variant_2: "Pety",
      name_distance: 1,
      total_possible_duplicates: 2,
    });
  });

  it("does not match across groups with different lastname or patronymic", async () => {
    const fixture = await load([
      { id: 1, firstname: "Petr", lastname: "SurA", patronymic: "Pat" },
      { id: 2, firstname: "Pety", lastname: "SurA", patronymic: "Pat" },
      { id: 3, firstname: "Anna", lastname: "SurB", patronymic: "Pat" },
      { id: 4, firstname: "Anny", lastname: "SurB", patronymic: "Pat" },
    ]);

    const rows = await run(fixture, 1);

    // One row per group, never a cross-group (Petr/Anna) match.
    expect(rows).toHaveLength(2);
  });

  it("maxDistance=0 emits exact-FIO clusters as self-matches", async () => {
    const fixture = await load([
      { id: 1, firstname: "Ivan", lastname: "Sur", patronymic: "Pat" },
      { id: 2, firstname: "Ivan", lastname: "Sur", patronymic: "Pat" },
      { id: 3, firstname: "Solo", lastname: "Sur", patronymic: "Pat" },
    ]);

    const rows = await run(fixture, 0);

    expect(rows).toEqual([
      {
        lastname: "Sur",
        patronymic: "Pat",
        firstname_variant_1: "Ivan",
        firstname_variant_2: "Ivan",
        name_distance: 0,
        total_possible_duplicates: 2,
      },
    ]);
  });

  it("suppresses lone singletons (records_count=1 with no fuzzy neighbour)", async () => {
    const fixture = await load([
      { id: 1, firstname: "Lonely", lastname: "Sur", patronymic: "Pat" },
      { id: 2, firstname: "Hermit", lastname: "Sur", patronymic: "Pat" },
    ]);

    // No two firstnames within distance 1 of each other → no rows at all.
    const rows = await run(fixture, 1);
    expect(rows).toEqual([]);
  });

  it("maxDistance=2 includes distance-0 cluster, distance-1 and distance-2 fuzzy pairs", async () => {
    const fixture = await load([
      // Cluster of 3 identical names.
      { id: 1, firstname: "Ivan", lastname: "Sur", patronymic: "Pat" },
      { id: 2, firstname: "Ivan", lastname: "Sur", patronymic: "Pat" },
      { id: 3, firstname: "Ivan", lastname: "Sur", patronymic: "Pat" },
      // Fuzzy neighbour at distance 1 from Ivan.
      { id: 4, firstname: "Ivam", lastname: "Sur", patronymic: "Pat" },
      // Distance 2 from both Ivan (a→o, n→r) and Ivam (a→o, m→r).
      { id: 5, firstname: "Ivor", lastname: "Sur", patronymic: "Pat" },
    ]);

    const rows = await run(fixture, 2);

    // Pairs (with name_distance, total_possible_duplicates):
    //   Ivan↔Ivan (0, 3) — self-match
    //   Ivam↔Ivan (1, 4)
    //   Ivan↔Ivor (2, 4)
    //   Ivam↔Ivor (2, 2)
    expect(rows).toHaveLength(4);

    // Sorted by total_possible_duplicates DESC, then name_distance ASC:
    expect(rows[0]).toMatchObject({
      firstname_variant_1: "Ivam",
      firstname_variant_2: "Ivan",
      name_distance: 1,
      total_possible_duplicates: 4,
    });
    expect(rows[1]).toMatchObject({
      firstname_variant_1: "Ivan",
      firstname_variant_2: "Ivor",
      name_distance: 2,
      total_possible_duplicates: 4,
    });
    expect(rows[2]).toMatchObject({
      firstname_variant_1: "Ivan",
      firstname_variant_2: "Ivan",
      name_distance: 0,
      total_possible_duplicates: 3,
    });
    expect(rows[3]).toMatchObject({
      firstname_variant_1: "Ivam",
      firstname_variant_2: "Ivor",
      name_distance: 2,
      total_possible_duplicates: 2,
    });
  });
});
