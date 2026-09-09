# ADR 0017: SCIP as optional precision tier

## Status

Accepted (Phase 5) — evolves ADR 0005

## Context

Tree-sitter gives fast, offline structural graphs but incomplete call resolution. SCIP (and similar indexers) improve precision at the cost of toolchains, config, and RCE risk if untrusted build scripts run in shared workers.

## Decision

1. **tree-sitter remains the default** path; analysis never depends on a full project build.
2. SCIP is an **optional precision tier** behind per-repo/org flag `scip_enabled`.
3. When enabled, run allowlisted indexers (e.g. `scip-typescript`, `scip-go`) only under a **safe invoke policy**: lockfiles present, known-safe command patterns, no arbitrary `npm install` / `go test` / Makefile/`package.json` scripts from customer code. Prefer pre-index upload or trusted CI index upload for enterprise.
4. Map SCIP symbols → entity FQNs; upgrade `CALLS` (and related) edge confidence. UI badge: `Precision: structural | SCIP`.
5. If SCIP cannot run safely, skip silently and keep structural results.

## Consequences

- Default SaaS path stays parse-only and sandbox-friendly.
- Precision is best-effort and may differ across languages/repos.
- Misconfigured `scip_enabled` must not open an RCE path — policy enforcement is a security gate, not a DX nicety.
