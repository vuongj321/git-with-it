# ADR 0005: tree-sitter-only extraction (no SCIP yet)

## Status

Accepted (Phase 1)

## Context

High-fidelity indexers (SCIP/LSIF, `tsc`, language servers) produce precise call graphs and types, but they are heavy: language toolchains, project configuration, and long index times make them fragile in sandboxed workers. Phase 1 only needs structural architecture graphs (packages, files, exported symbols, imports).

## Decision

Use **tree-sitter** grammars for TypeScript/JavaScript and Python in `gwi-parse`. Defer SCIP and compiler-based indexers until Phase 5 (optional precision path). Extraction emits `Symbol` / `UnresolvedRef` records; `gwi-link` resolves imports to FQNs without executing repository code.

## Consequences

- Fast, offline, deterministic parses suitable for blob caching.
- Incomplete call graphs and limited type-aware resolution vs SCIP.
- Grammar upgrades may change spans; bump `analyzer_version` when extraction semantics change.
