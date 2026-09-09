# Backup and restore

## Postgres

- **PITR** via managed provider (e.g. RDS/Cloud SQL continuous WAL) or equivalent.
- Daily logical dump optional for portable DR drills.
- Restore: spin recovery instance → point-in-time → validate migrations → cut DNS/app DSN.

## Neo4j

- Scheduled backups (Aura automatic or operator dump/volume snapshot).
- Restore to new instance; re-point workers; if graph is suspect, prefer **rebuild-from-git** for affected repos.

## Object storage (S3 / MinIO)

- **Versioning** on artifact buckets (`gwi-artifacts` and cold prefixes).
- Lifecycle rules for noncurrent versions; MFA delete optional in prod.

## ClickHouse

- Snapshot or backup of metrics tables per provider practice; metrics are rebuildable from analysis if needed (costly).

## Runbook: rebuild-from-git

When Neo4j or graph artifacts for a repo are lost/corrupt:

1. Confirm bare clone / fetch still available in object store or re-clone via App/PAT.
2. Enqueue full resample analyze with current `analyzer_version` (orchestrator flag unchanged).
3. Wait tip `graph_ready`; backfill samples; verify package graph + metrics row counts.
4. Re-run cold-age job if retention requires (ADR 0019).
5. Document incident; do not restore Neo4j from backup *and* rebuild the same repo without clearing stale nodes.

## Drill cadence

Quarterly: PG PITR restore to scratch, one repo rebuild-from-git, S3 version restore of a checkpoint object.
