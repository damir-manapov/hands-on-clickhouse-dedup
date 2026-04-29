# hands-on-clickhouse-dedup

A small playground for investigating **deduplication strategies in ClickHouse**
on synthetic passenger data.

## What's inside

* `compose/docker-compose.yml` — single-node ClickHouse for local experiments.
* `scripts/generate-passengers.ts` — fills `passengers` and `passengerDocuments`
  with deliberately-noisy data using
  [`@mkven/samples-generation`](https://www.npmjs.com/package/@mkven/samples-generation).
  The name lists contain near-duplicates (`Ivan` / `Ivon`, `Olga` / `Olga1`,
  `Ivanov` / `Ivano1`, etc.) so fuzzy-match queries actually find something.
* `sql/passengers_duplicate_checks.sql` — annotated example queries:
  exact-match on FIO, exact-match on FIO + passport, and Levenshtein-based
  fuzzy duplicate detection.

## Prerequisites

* Node.js >= 22, [pnpm](https://pnpm.io/) (managed via `corepack`).
* Docker with the `docker compose` plugin.
* [`gitleaks`](https://github.com/gitleaks/gitleaks) for `health.sh`.

## Quick start

```bash
pnpm install

# Start ClickHouse and wait for it to be healthy
pnpm compose:up

# Generate 100k passengers + 200k documents
pnpm generate --rows 100000 --drop

# Run the dedup queries
docker compose -f compose/docker-compose.yml exec -T clickhouse \
  clickhouse-client --password clickhouse --database dedup --multiquery \
  < sql/passengers_duplicate_checks.sql

# Tear it down
pnpm compose:reset
```

## Compose service

| Service     | Port            | Credentials                |
| ----------- | --------------- | -------------------------- |
| ClickHouse  | 8123 (HTTP), 9000 (native) | `default` / `clickhouse` |

Database: `dedup`.

## Generator options

```
pnpm generate --help
```

Useful flags: `--rows`, `--batch`, `--drop`, `--truncate`, plus connection
overrides (`--host`, `--port`, `--database`, `--user`, `--password`).

For larger datasets, batch the insert:

```bash
pnpm generate --rows 1_000_000_000 --batch 100_000_000 --drop
```

## Quality checks

```bash
./check.sh        # format, lint, typecheck, tests
./health.sh       # gitleaks, outdated deps, vulnerabilities
./all-checks.sh   # both
```

`pnpm install` wires `simple-git-hooks` so `all-checks.sh` runs on every commit.
Skip in emergencies with `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...`.

## Layout

```
compose/   docker-compose.yml (ClickHouse)
scripts/   generate-passengers.ts (data generator entry-point)
sql/       passengers_duplicate_checks.sql (curated dedup queries)
src/       library entry-point (currently a placeholder export)
tests/     vitest smoke tests
```

See [`PLAN.md`](PLAN.md) for design notes.
