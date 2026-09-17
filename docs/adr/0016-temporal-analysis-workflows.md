# ADR 0016: Temporal as system of record for analysis workflows

## Status

**Rejected** — reverted to [ADR 0001](0001-modular-monolith-bullmq.md). Scaffolding deleted.

## Context

BullMQ + Redis works for clone and short jobs, but multi-stage analysis (clone → enumerate_sample →
parse_commit → metrics_write → evolve → ai) can need durable sagas: heartbeats, cancel from UI,
child batch workflows, and resume after worker death. Phase 5 proposed Temporal for this and a
dual-run client/worker scaffold was written behind `ORCHESTRATOR=temporal`.

## Decision (as proposed, never adopted)

1. Temporal as the system of record for analysis workflows (`AnalysisRun` and child shard batches);
   activities wrap existing worker stages; idempotency keys stay `(repo_id, analyzer_version, sha, stage)`.
2. Dual-run then cutover via env `ORCHESTRATOR=bullmq|temporal` (default `bullmq`), worker entry
   `apps/worker-ts/src/temporal-worker.ts`.
3. After cutover, BullMQ retained only for light jobs (webhooks, email).
4. Long parse batches heartbeat; UI cancel maps to Temporal terminate/cancel.

## Why it was rejected

- **The soak never ran.** No environment ever set `ORCHESTRATOR=temporal`, so the second orchestrator
  only added drift: two code paths for one pipeline, kept in sync by hand.
- **The reliability gap is already covered.** Stages are idempotent at
  `(repo_id, analyzer_version, sha, stage)`, run state is mirrored in Postgres
  (`analysis_runs` / `jobs`), BullMQ retries with exponential backoff, and per-repo Neo4j writes are
  serialized by a Redis lease ([ADR 0011](0011-single-writer-neo4j.md)).
- **Operator surface doubled** (Temporal Cloud/self-host, namespace, mTLS secrets) with no measured
  driver. `@temporalio/*` were never declared dependencies — the paths only worked if someone
  installed them by hand.

## Consequences

- Deleted: `apps/api/src/temporal/**`, `apps/worker-ts/src/temporal/**`,
  `apps/worker-ts/src/temporal-worker.ts`, and the `ORCHESTRATOR`, `TEMPORAL_ADDRESS`,
  `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE` env vars. `POST /v1/repos/:id/analyze` no longer
  returns an `orchestrator` field.
- Long-run cancellation and cross-stage resume stay best-effort/manual. If durable sagas become a
  real requirement, reopen this with a measured failure mode (e.g. worker loss mid-parse) rather
  than a design preference.

