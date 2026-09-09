# ADR 0011: Single-writer-per-repo for Neo4j deltas

## Status

Accepted (Phase 2)

## Context

Temporal edge updates (close `valid_to`, open new edges) race if multiple workers mutate the same repo concurrently.

## Decision

- BullMQ `parse_commit` (and Neo4j delta writers) run at **concurrency 1** globally for MVP
- Job payloads are repo-scoped; do not shard Neo4j writes across workers for the same `repo_id`
- Future: per-repo Redis lock or partitioned queues keyed by `repo_id`

## Consequences

- Throughput scales with number of repos, not files within a repo’s delta write
- File-level parse parallelism remains allowed **within** a single commit job before the write phase
