# Cold storage (ops)

Implements ADR 0019.

## What ages

- Fine-grained **symbol** edges (and related hot Neo4j detail) older than **N months**
- Does **not** age away: package/module graph rollups, recent tip slice, ClickHouse metrics, Postgres run metadata, snapshots/checkpoints required for rebuild

## Job sketch

1. Select edges/windows with `valid_to` (or last activity) older than N.
2. Export to S3: `orgs/{org_id}/repos/{repo_id}/cold/{window}.zst` (+ manifest checksum).
3. Verify checksum; then delete/detach from hot Neo4j.
4. Emit metrics: bytes aged, edges removed, failures.

## Restore

- Support ticket / admin API: materialize window → temporary Neo4j subgraph or offline query path.
- Expect higher latency; communicate “restore required” in UI for deep history.

## Knobs

| Knob | Meaning |
|---|---|
| `COLD_STORAGE_MONTHS` (or plan override) | Age threshold N |
| Enable/disable per org | Enterprise may keep longer hot retention |
| Dry-run | Export only, no Neo4j delete |

## Alerts

- Age job failure / checksum mismatch
- Unexpected hot Neo4j growth (job not running)
- S3 cold prefix error budget (403/5xx)
