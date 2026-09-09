# ADR 0013: Complexity and maintainability proxies

## Status

Accepted (Phase 3)

## Context

True McCabe cyclomatic complexity needs a control-flow graph. Phase 3 parsers are tree-sitter structural extractors without CFG. UI heatmaps still need a useful signal.

## Decision

1. **`complexity_proxy`** — count of decision-ish tokens / nodes approximated from source (`if`, `else`, `while`, `for`, `case`, `catch`, `&&`, `||`, `?`, `?.`, `??`). **UI copy must not claim “cyclomatic complexity.”** Prefer “complexity proxy” / “decision-node approx.”

2. **`maintainability_proxy`** (0–100, higher = healthier) for heatmap coloring only:

```
burden = 0.4 * c_n + 0.3 * fi_n + 0.3 * loc_n
score  = clamp(100 - burden * 100, 0, 100)
```

where `*_n` are min–max normalized within the file cohort at that SHA.

## Consequences

- Heatmaps and tables label metrics explicitly as proxies
- Future SCIP/CFG upgrade can introduce a separate `cyclomatic` metric without renaming the proxy
