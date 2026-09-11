# ADR 0016: Temporal as system of record for analysis workflows

## Status

Accepted (Phase 5) — evolves ADR 0001

## Context

BullMQ + Redis works for clone and short jobs, but multi-stage analysis (clone → sample → parse → graph → metrics → evolve → AI) needs durable sagas: heartbeats, cancel from UI, child batch workflows, and resume after worker death. ADR 0001 deferred Temporal; Phase 5 hardens orchestration.

## Decision

1. **Temporal** is the system of record for analysis workflows (`AnalysisRun` and child shard batches). Activities wrap existing worker stages (`clone` → `enumerate` → `parse_commit` → `metrics` → `evolve` → `ai`); idempotency keys remain `(repo_id, analyzer_version, sha, stage)`.
2. **Dual-run then cutover:** staging runs BullMQ and Temporal in parallel for soak; production cutover via env `ORCHESTRATOR=bullmq|temporal` (default `bullmq` until soak passes). Worker entry: `apps/worker-ts/src/temporal-worker.ts`.
3. After cutover, BullMQ is retained only for light jobs (webhooks, email, Stripe) or removed once unused.
4. Long parse batches heartbeat; UI cancel maps to Temporal terminate/cancel.

## Consequences

- Operator surface grows (Temporal Cloud or self-host); local DX may keep BullMQ via flag.
- Chaos kill mid-run must resume without duplicate Neo4j/ClickHouse writes (activity idempotency tests required).
- Job mirror / run status in Postgres continues to serve UI; Temporal history is authoritative for workflow state.
- `@temporalio/client` (API) and `@temporalio/worker` (worker-ts) are optional installs until cutover.
