# ADR 0007: Phase 1 sha-tagged Neo4j snapshots

## Status

Accepted (Phase 1)

## Context

Full temporal graphs (validity intervals per edge) are required for evolution views but add write and query complexity. Phase 1 only needs a single tip-SHA architectural view.

## Decision

Store **sha-tagged snapshot** nodes/edges in Neo4j:

- Every node and relationship carries `repo_id` + `sha` (+ `analyzer_version` on write).
- Re-analyzing a tip replaces the prior snapshot for `(repo_id, sha)` (delete then insert).
- Uniqueness: `(repo_id, sha, id)` for nodes.
- Default materialization: Package, File, exported Class/Function; relationships `CONTAINS`, `IMPORTS`, `DEPENDS_ON`.

Temporal `valid_from` / `valid_to` edges are deferred to Phase 2.

## Consequences

- Simple MVP queries: `MATCH (n {repo_id, sha}) …`
- Storage grows with re-analyzed SHAs (acceptable while sampling is tip-only).
- Migration path: Phase 2 introduces interval edges without changing Postgres entity IDs.
