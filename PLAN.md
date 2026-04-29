# Plan: hands-on-clickhouse-dedup

## Goal
Hands-on project to investigate **deduplication strategies in ClickHouse** on
synthetic passenger data. The project provides:

* a reproducible ClickHouse container (via `docker compose`)
* a TypeScript script that fills it with realistic-but-noisy passenger data
  using the public package [`@mkven/samples-generation`](https://www.npmjs.com/package/@mkven/samples-generation)
* a curated set of SQL queries that demonstrate exact and fuzzy duplicate
  detection on the generated data

## Scope (MVP)
* No production code, this is a benchmark / playground repo.
* Single ClickHouse node, single database (`dedup`).
* Two tables: `passengers` and `passengerDocuments` (mirrors the original SQL).
* Generator parameters expose row counts so we can scale from 10k to 1B.

## Stack
TypeScript (`type: module`), pnpm, vitest, biome 2.x, gitleaks, trivy *(no
Dockerfile here, so trivy is optional / skipped)*, simple-git-hooks, renovate.

Follows `prompts/newProject.md` conventions:
* strict `tsconfig` (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `noPropertyAccessFromIndexSignature`)
* biome lint with `noExplicitAny: error`, `noNonNullAssertion: warn`
* compose service prefix `compose:*`, `starter` service waiting all healthy
* `check.sh`, `health.sh`, `all-checks.sh`

## Repo layout

```
hands-on-clickhouse-dedup/
├── PLAN.md                 # this file
├── README.md
├── package.json
├── tsconfig.json
├── biome.json
├── vitest.config.ts
├── .gitignore
├── renovate.json
├── renovate-check.sh
├── check.sh
├── health.sh
├── all-checks.sh
├── compose/
│   └── docker-compose.yml  # clickhouse + starter
├── scripts/
│   └── generate-passengers.ts   # uses @mkven/samples-generation
├── sql/
│   └── passengers_duplicate_checks.sql
├── src/
│   └── index.ts            # placeholder export so tsc has something
└── tests/
    └── smoke.test.ts       # trivial vitest test (no DB required)
```

### File moves
* `generate-clickhouse-passengers.ts` → `scripts/generate-passengers.ts`,
  rewriting the import from a non-existent local
  `../src/generator/index.js` to `@mkven/samples-generation`.
* `passengers_duplicate_checks.sql` → `sql/passengers_duplicate_checks.sql`,
  unchanged.

## ClickHouse compose service
* Image: `clickhouse/clickhouse-server` pinned to a recent tag.
* User/password: `default` / `clickhouse`.
* DB: `dedup`.
* Ports: `8123` (HTTP), `9000` (native).
* Healthcheck: `clickhouse-client --password clickhouse --query 'SELECT 1'`.
* `starter` alpine service depending on `clickhouse: service_healthy`.
* No `restart`, no `container_name`, no `version:` field.

## Generator script
* CLI flags: `--rows`, `--batch`, `--drop`, `--truncate`, plus connection
  options (`--host`, `--port`, `--database`, `--user`, `--password`).
* Same noisy `FIRST_NAMES` / `LAST_NAMES` / `PATRONYMICS` arrays preserved
  (the typos are the whole point — they trigger the levenshtein checks).
* `passengerDocuments.passengerId` random in `[1, rows]` so we get fan-out.

## Dedup SQL
Kept as a single annotated file. Future iterations may split per-strategy and
add expected-row-count expectations. Out of scope for MVP.

## Tests
A single trivial vitest test is enough to satisfy `check.sh` (real ClickHouse
integration tests are out of MVP scope).

## Out of scope (for now)
* Performance benchmarking harness
* ReplacingMergeTree / FINAL deduplication patterns (the SQL is *find*-only)
* CI workflow files
