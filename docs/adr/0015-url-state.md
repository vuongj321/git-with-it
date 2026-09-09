# ADR 0015: Shareable URL state for exploration

## Status

Accepted (Phase 3)

## Context

Architecture exploration (SHA, compare range, heatmap metric, focus node) must be linkable for collaboration and bug reports.

## Decision

Product routes under `/[org]/repos/[repo]/{overview|graph|timeline|metrics|compare|insights}` encode exploration state as **search params**:

| Param | Meaning |
|---|---|
| `sha` | Materialize graph / metrics at SHA |
| `from` / `to` | Compare range |
| `focus` | Selected / ego-network center node id |
| `view` | `package` \| `file` |
| `metric` | Heatmap / series metric name |
| `depth` | Ego expand depth |
| `severity` / `type` | Timeline filters |

Client hook: `useRepoUrlState` (`apps/web/src/lib/url-state.ts`). Updates use `router.replace` by default to avoid history spam.

## Consequences

- Deep links open the same SHA/compare/heatmap view
- Timeline events navigate to Compare with `from`/`to` prefilled
