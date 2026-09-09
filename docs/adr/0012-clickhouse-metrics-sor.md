# ADR 0012: ClickHouse as metrics system of record

## Status

Accepted (Phase 3)

## Context

Entity × commit × metric time series (sampled history) will not fit comfortably in PostgreSQL for million-LOC repos. Neo4j stores the graph projection, not metric rollups.

## Decision

**ClickHouse** is the system of record for architectural metrics (`metrics_entity`, `metrics_repo`). PostgreSQL remains SoR for tenancy, entities, jobs, and evolution events. Metrics are computed after each sampled graph delta (`metrics_write`) so SHA alignment matches Neo4j temporal materialization.

Idempotency: delete-before-insert per `(repo_id, commit_sha)` plus `ReplacingMergeTree`.

## Consequences

- Overview/heatmap/series APIs read ClickHouse (Redis-cached)
- Cold retention / tiering is deferred; MVP keeps all sampled points
- Local Compose already runs ClickHouse on `:8123`
