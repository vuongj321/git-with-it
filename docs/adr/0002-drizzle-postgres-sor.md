# ADR 0002: Drizzle + Postgres as system of record

## Status

Accepted (Phase 0)

## Context

We need typed SQL migrations for orgs, users, repos, analysis runs, and jobs. Prisma is popular with Nest but generates a heavier client. Raw SQL lacks ergonomics for a small team.

## Decision

Use **PostgreSQL 16** as the system of record and **Drizzle ORM** for schema, migrations, and queries in `apps/api`. Neo4j and ClickHouse are provisioned in Compose but receive **no writes** in Phase 0 — they are derived stores in later phases.

## Consequences

- SQL-first schema is easy to review in PRs (`apps/api/drizzle/`).
- Nest services use a shared `db` client rather than a full repository framework.
- Entity/graph identity tables arrive in Phase 1+ without fighting an early Prisma model freeze.
