# ADR 0014: Sigma.js + Graphology for graph visualization

## Status

Accepted (Phase 3)

## Context

Package/file graphs at sample SHAs can reach hundreds to low thousands of nodes. Canvas/SVG libraries struggle past a few thousand edges; WebGL is required for interactive exploration.

## Decision

Use **Sigma.js 3** (WebGL renderer) with **Graphology** as the in-browser graph model, plus Force Atlas 2 for layouts under ~2k nodes. The API returns **capped slices** (`view=package|file`, `limit`); the UI never requests the full symbol graph by default.

Compare mode styles added edges/nodes green, removed red, and persisted amber.

## Consequences

- Graph route is a full-bleed canvas with chrome controls (not card-heavy)
- Truncation messaging when the server cap applies
- Layout positions are client-computed for MVP; optional checkpoint-stored layouts later
