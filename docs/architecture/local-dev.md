# Local development — data plane

Bring up the Phase 0 dependencies with:

```bash
cp .env.example .env
make up
# or: docker compose -f infra/docker-compose.yml --env-file .env up -d
```

## Services & ports

| Service | Host ports | Credentials / notes |
|---|---|---|
| Postgres 16 | `5432` | `gwi` / `gwi`, db `gwi` — system of record |
| Redis 7 | `6379` | BullMQ clone queue + session stub |
| MinIO | `9000` (S3), `9001` (console) | `gwiadmin` / `gwiadmin123`, bucket `gwi-artifacts` |
| Neo4j 5 | `7474` (HTTP), `7687` (Bolt) | `neo4j` / `gwi-local-dev` — **provision only**, no writes in Phase 0 |
| ClickHouse | `8123` (HTTP), `9009` (native) | **provision only**, no writes in Phase 0 |

App processes (not in Compose by default):

| Process | Port |
|---|---|
| `apps/web` | `3000` |
| `apps/api` | `4000` |
| `apps/worker-ts` | (no HTTP; consumes BullMQ) |

## Migrations & seed

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
```

Seed creates org `demo`, admin `admin@git-with-it.local` / `admin1234`.

## gwi-git

```bash
cargo build -p gwi-git --release
export GWI_GIT_BIN="$PWD/target/release/gwi-git"   # Windows: target\release\gwi-git.exe
```

The worker shells out to this binary for bare clone / fetch. It never executes repository code.

## Windows / OneDrive

Ephemeral clone workspaces under `.tmp/workspaces` can fail on OneDrive-synced paths. Prefer:

1. WSL2 with the repo outside OneDrive, or
2. Running `apps/worker-ts` in Docker with a Linux volume for `WORKER_TMP_DIR`.

## Smoke checks

```bash
curl http://localhost:4000/health
curl http://localhost:9000/minio/health/live
```
