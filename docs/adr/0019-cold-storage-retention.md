# ADR 0019: Cold storage and retention for fine-grained symbol edges

## Status

Accepted (Phase 5)

## Context

Fine-grained symbol graphs and temporal edges grow unbounded with history depth. Keeping every symbol edge hot in Neo4j is cost-prohibitive; package-level architecture and metrics must remain queryable.

## Decision

1. **Age** fine-grained symbol edges older than **N months** (configurable per plan/org; default TBD in ops) out of hot Neo4j into **S3** cold objects (prefix under `orgs/{org_id}/repos/{repo_id}/cold/...`).
2. **Retain hot:** package/module graph rollups, tip (and recent) symbol slice, ClickHouse metrics, Postgres metadata, and checkpoint/snapshot artifacts needed for rebuild.
3. Cold objects are **read-rarely**: restore/replay job materializes a time window on demand; UI for deep history may show degraded latency or “restore required.”
4. Deletion of Neo4j aged edges happens only after successful S3 write + checksum; retention of cold objects follows org/plan policy separately.

## Consequences

- Neo4j disk and cost stay bounded; deep historical symbol diffs may require restore.
- Package graph + metrics remain the always-on product surface.
- Ops runbook: see `docs/ops/cold-storage.md`.
