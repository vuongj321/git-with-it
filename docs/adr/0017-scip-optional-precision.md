# ADR 0017: SCIP as optional precision tier

## Status

**Rejected** — [ADR 0005](0005-tree-sitter-only.md) (tree-sitter only) stands. Code path deleted.

## Context

Tree-sitter gives fast, offline structural graphs but incomplete call resolution. SCIP (and similar
indexers) improve precision at the cost of toolchains, config, and RCE risk if untrusted build
scripts run in shared workers. Phase 5 proposed an optional SCIP tier.

## Decision (as proposed, never adopted)

1. tree-sitter remains the default path; analysis never depends on a full project build.
2. SCIP is an optional precision tier behind a per-repo flag `scip_enabled`.
3. When enabled, run allowlisted indexers only under a safe invoke policy (lockfiles present,
   known-safe command patterns, no arbitrary `npm install` / `go test` / `make`).
4. Map SCIP symbols → entity FQNs; upgrade `CALLS` edge confidence. UI badge: `Precision: structural | SCIP`.
5. If SCIP cannot run safely, skip silently and keep structural results.

## Why it was rejected

- **It never executed.** `SCIP_ENABLED` was unset in every environment; the only caller was a
  flag-gated block in `parse-commit.ts`, and the API route it posted to (`/precision`) merely wrote a
  display string.
- **The security cost was real, the payoff unmeasured.** Running third-party indexers on untrusted
  repositories in shared workers is the largest RCE surface in the product, and no precision user
  story justified it.
- **It leaked into the schema.** `repositories.precision_mode` (plus `features.scipLanguage` /
  `scipReason`) only ever fed a UI badge.

## Consequences

- Deleted: `apps/worker-ts/src/scip.ts`, `POST /v1/internal/repos/:id/precision`, the
  `scip_enabled` / `SCIP_ENABLED` flag, `repositories.precision_mode`, the `precisionMode` fields in
  API serializers and the web `Repo` type, and the overview page's precision badge.
- Column removal ships in migration `0008_drop_unused_columns.sql`.
- Parse precision is whatever tree-sitter gives; call-graph edges stay confidence-tagged
  ([ADR 0010](0010-evolution-event-taxonomy.md)) rather than upgraded.

