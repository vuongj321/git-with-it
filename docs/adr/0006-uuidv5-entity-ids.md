# ADR 0006: UUIDv5 entity IDs from FQN

## Status

Accepted (Phase 1)

## Context

Entities must keep a stable identity across commits so graph diffs and metrics can join on `id` rather than path/line. Line numbers and paths alone are unstable (refactors, renames). FQN (`repo` + `kind` + normalized name) is the primary identity key within a repository.

## Decision

1. Assign each entity a **UUIDv5** derived from:
   - Namespace `GWI_ENTITY_NAMESPACE` = UUIDv5(DNS UUID, `"git-with-it.entity.v1"`) = `73061f4c-6213-5e3a-a533-3a7162bb434f`
   - Name string: `{repo_id}:{kind}:{fqn}`
2. Persist in Postgres `entities` with unique `(repo_id, kind, fqn)`; `id` is the UUIDv5 (not random).
3. Record per-commit presence in `entity_appearances` with `analyzer_version`.
4. Stamp `analysis_runs.analyzer_version` so re-parses with a new extractor can be distinguished.

FQN rules (see `gwi-parse`): TS/JS `path#Symbol` / `path#Class.method`; Python `module.path.Class.method`.

## Consequences

- Same analyzer inputs ⇒ identical entity UUIDs (property tested in `packages/shared-types`).
- Renames that change FQN create a new entity id (rename linking deferred to Phase 2).
- Namespace UUID must never change once production data exists.
