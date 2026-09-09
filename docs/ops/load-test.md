# Load test and capacity

## Target envelope

Approximate production-class fixture (blueprint):

- **~5M LOC** repository class
- **~10k sampled commits** on the first-parent / sampling path (not necessarily 10k full parses if density backoff engages)

Tip-first progressive delivery remains mandatory: users see tip graph before full backfill completes.

## Auto sample-density backoff

When ETA to finish (or queue pressure) exceeds SLA budgets:

1. Reduce sample density (wider stride / lower checkpoint frequency as configured).
2. Prefer tip + recent window; defer deep history.
3. Surface density mode on the run record for supportability.
4. Never disable org/repo isolation or idempotency to “go faster.”

## Capacity playbook (sketch)

| Symptom | Action |
|---|---|
| Parse queue lag | Scale `worker-ts` / Temporal workers; check Neo4j single-writer leases |
| Neo4j CPU/disk | Confirm cold-age job; reduce hot symbol retention N; package rollups only for deep history |
| ClickHouse insert lag | Batch size / partition checks; quota metric cardinality |
| Clone bandwidth | Rate-limit concurrent clones per org; cache bare repos in S3 |
| AI enqueue storms | Hard quotas (ADR 0018); circuit-break provider |

## How to run (placeholder)

- Scripted fixture repo + k6/vegeta against analyze APIs (staging only).
- Capture: tip p50/p95, full-run wall time, error rate, $ proxy (worker minutes).
- Store report under internal ops notes; update SLO targets if envelope shifts.
