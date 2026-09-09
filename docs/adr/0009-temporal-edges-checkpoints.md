# ADR 0009: Temporal edges + checkpoint/delta hybrid

## Status

Accepted (Phase 2) — supersedes Phase 1 sha-tagged full copies for new writes

## Context

Full Neo4j copies per commit do not scale. Pure temporal edges need a materialize-at-SHA path and benefit from sparse checkpoints for long compares.

## Decision

**Hybrid:**

1. **Neo4j nodes:** one node per entity id (repo-scoped); no per-sha node copies
2. **Neo4j edges:** `valid_from` / `valid_to` as `topo_index` longs; `added_in` / `removed_in` SHAs; open edges use `valid_to = 2147483647`
3. **Object storage:**
   - Full snapshot JSON per sample: `graphs/{repo_id}/snapshots/{sha}.json`
   - Deltas: `graphs/{repo_id}/deltas/{from}_{to}.zst` (+ `graph_deltas` rows in Postgres)
   - Checkpoints every **K** samples (default **25**): `graphs/{repo_id}/ckpt/{sha}.zst`
4. **Materialize-at-SHA:** Cypher `valid_from <= idx < valid_to` **or** load snapshot / checkpoint+replay
5. Phase 1 sha-tagged graphs are replaced on next analyze (`replaceRepo` temporal write)

## Consequences

- Tip-first progressive delivery can publish `graph_ready` before full backfill
- Diff/timeline prefer stored snapshots; Neo4j serves live tip slices
- Unbounded compares without checkpoints return **412** above hop limit (default 200)
