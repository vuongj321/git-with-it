# ADR 0008: First-parent sampling policy

## Status

Accepted (Phase 2)

## Context

Analyzing every commit is expensive. Users still need tip-accurate architecture and a sparse history of structural change. Merge commits introduce diamond topologies that complicate temporal edge validity.

## Decision

- Walk **first-parent** history from the default-branch tip only.
- Sampler (configurable per run via `sample_config`):
  - Always include tip
  - Last **N** commits (default **100**)
  - Plus **one calendar-month anchor** outside the recent window when `monthlyAnchors` is true
- Persist all walked commits in `commits`; selected set in `commit_samples` + `analysis_runs.sample_shas`
- Assign monotonic `topo_index` on the **sampled** set (0 = oldest sample → tip)
- Merge-commit / full DAG topology is **deferred**

## Consequences

- Evolution timeline follows the mainline story, not every feature-branch merge nuance
- Product copy should note that density is sampled; progressive densification can come later
- Compare/diff APIs operate on sampled SHAs (with hop limits when checkpoints are missing)
