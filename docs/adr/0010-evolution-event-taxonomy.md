# ADR 0010: Evolution event taxonomy and severity

## Status

Accepted (Phase 2)

## Context

The product needs a structural timeline without LLM narratives (Phase 4). Events must be deterministic and testable.

## Decision

Persist rows in `evolution_events` with typed enum:

| Type | Trigger | Default severity |
|---|---|---|
| `dependency_added` / `dependency_removed` | DEPENDS_ON/IMPORTS edge birth/death | info |
| `cycle_introduced` / `cycle_resolved` | SCC appearance/disappearance (Tarjan) | high / medium |
| `module_added` / `module_removed` | Package node birth/death | low |
| `rename_detected` | Entity rename chain (git `-M` or high confidence) | info |
| `coupling_spike` | Fan-in/out Δ ≥ threshold (default 5) | medium (high if ≥ 2×) |

Rules live in `@gwi/shared-types` (`eventsFromDiff`); thresholds in `sample_config` / `EventRuleConfig`. **No LLM** in Phase 2.

## Consequences

- CI goldens assert event types between known graph pairs
- Severity is advisory for UI sorting/filtering in Phase 3
