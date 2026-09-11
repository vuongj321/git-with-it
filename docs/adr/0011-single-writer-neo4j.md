# ADR 0011: Single-writer-per-repo for Neo4j deltas

## Status

Accepted (Phase 2)

## Context

Temporal edge updates (close `valid_to`, open new edges) race if multiple workers mutate the same repo concurrently.

## Decision

- Each `parse_commit` job acquires a **per-repo Redis lease** (`gwi:neo4j-writer:{repoId}`) before Neo4j/temporal writes
- BullMQ `parse_commit` concurrency may be **> 1** so different repos progress in parallel; same-repo jobs wait on the lease
- Job payloads remain repo-scoped; do not shard Neo4j writes across workers for the same `repo_id` without the lease

## Consequences

- Throughput scales with number of repos, not files within a repo’s delta write
- File-level parse parallelism remains allowed **within** a single commit job before the write phase
- Lease TTL must exceed worst-case job duration (or renew via heartbeat in a future hardening pass)
