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

## How to run

Lightweight control-plane probe (Node built-ins; no k6 required):

```bash
# API must be up (and preferably seeded) — see docs/architecture/local-dev.md
pnpm load-test
# or: node scripts/load-test.mjs
```

| Env | Default | Meaning |
|---|---|---|
| `API_URL` | `http://localhost:4000` | API base |
| `LOAD_TEST_CONCURRENCY` | `10` | Parallel GETs |
| `LOAD_TEST_REQUESTS` | `50` | Total GETs against `/v1/orgs` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | seed defaults | Optional login via `/v1/auth/login` |

The script checks `/health`, optionally authenticates, fires concurrent `/v1/orgs` GETs, prints p50/p95 latency and error rate, and exits non-zero if health fails or error rate > 5%.

For heavier envelope tests (staging only): scripted fixture repo + k6/vegeta against analyze APIs; capture tip p50/p95, full-run wall time, error rate, and worker-minute cost; store under ops notes and update SLO targets if the envelope shifts.
