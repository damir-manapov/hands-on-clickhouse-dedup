/**
 * SQL builder stubs for ClickHouse passenger deduplication.
 *
 * These functions return parameterized versions of the canonical queries
 * in `sql/passengers_duplicate_checks.sql`. They exist so the test suite
 * can be written against a stable interface; the user is expected to
 * replace these stubs with a real builder over time.
 */

function escapeIdentifier(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

export interface ExactFioOptions {
  readonly passengersTable: string;
}

/** Case 1 — exact firstname + lastname + patronymic. */
export function buildExactFioDuplicates(opts: ExactFioOptions): string {
  const t = escapeIdentifier(opts.passengersTable);
  return `
    SELECT firstname, lastname, patronymic, count() AS duplicates_count
    FROM ${t}
    GROUP BY firstname, lastname, patronymic
    HAVING count() > 1
    ORDER BY duplicates_count DESC, firstname, lastname, patronymic
  `;
}

export interface FirstnameLevenshteinOptions {
  readonly passengersTable: string;
  /** Inclusive upper bound on firstname Levenshtein distance. 0 ⇒ exact-FIO clusters only. */
  readonly maxDistance: number;
}

/**
 * Same lastname + patronymic, firstname Levenshtein distance ≤ maxDistance.
 *
 * Semantics:
 *   - Distance 0 (self-match within names_agg): emitted as one row per name
 *     cluster of size > 1, with `firstname_variant_1 = firstname_variant_2`
 *     and `total_possible_duplicates = records_count`.
 *   - Distance 1..maxDistance (cross-match): one row per unordered pair of
 *     distinct firstname variants, with
 *     `total_possible_duplicates = a.records_count + b.records_count`.
 *
 * Singletons (records_count = 1 with no fuzzy neighbour) are suppressed.
 */
export function buildFirstnameLevenshteinDuplicates(opts: FirstnameLevenshteinOptions): string {
  const t = escapeIdentifier(opts.passengersTable);
  return `
    WITH names_agg AS (
      SELECT firstname, lastname, patronymic, count() AS records_count
      FROM ${t}
      GROUP BY firstname, lastname, patronymic
    )
    SELECT
      a.lastname,
      a.patronymic,
      a.firstname AS firstname_variant_1,
      b.firstname AS firstname_variant_2,
      levenshteinDistanceUTF8(a.firstname, b.firstname) AS name_distance,
      if(a.firstname = b.firstname, a.records_count, a.records_count + b.records_count)
        AS total_possible_duplicates
    FROM names_agg AS a
    INNER JOIN names_agg AS b
      ON a.lastname = b.lastname
      AND a.patronymic = b.patronymic
      AND a.firstname <= b.firstname
    WHERE levenshteinDistanceUTF8(a.firstname, b.firstname) <= ${opts.maxDistance}
      AND if(a.firstname = b.firstname, a.records_count, a.records_count + b.records_count) > 1
    ORDER BY total_possible_duplicates DESC, name_distance, a.lastname, a.patronymic, firstname_variant_1, firstname_variant_2
  `;
}
