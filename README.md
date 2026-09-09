# Git With It

AI-powered software evolution platform. Phase 0–2: clone, parse/identity, sampled multi-commit evolution (temporal graphs, diffs, timeline events).

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) 9.15+
- Docker + Docker Compose
- Rust toolchain (for `gwi-git` / parse crates; see `rust-toolchain.toml`)
- System `git` on PATH (used by `gwi-git`)

> **Windows note:** Prefer WSL2 or run the worker inside Docker. OneDrive-synced paths can break ephemeral git workspaces.

## Quick start

```bash
cp .env.example .env
make up          # Postgres, Redis, MinIO, Neo4j, ClickHouse
pnpm install
pnpm db:migrate
pnpm db:seed
cargo build -p gwi-git -p gwi-parse -p gwi-link -p gwi-graph --release
# put target/release/* on PATH, or set GWI_GIT_BIN / GWI_PARSE_BIN / …
pnpm dev
```

- Web: http://localhost:3000  
- API: http://localhost:4000/health  
- MinIO console: http://localhost:9001 (`gwiadmin` / `gwiadmin123`)

Default login after seed: `admin@git-with-it.local` / `admin1234` (org slug `demo`).

See [docs/architecture/local-dev.md](docs/architecture/local-dev.md) for ports and service details.

## Workspace layout

```
apps/web          Next.js shell (repo detail: sample compare + timeline)
apps/api          NestJS control plane + Drizzle
apps/worker-ts    BullMQ clone → enumerate → parse_commit → evolve
crates/gwi-git    Bare clone / fetch / blob / first-parent log / diff-tree
crates/gwi-parse  tree-sitter TS/JS + Python extractors
crates/gwi-link   Import → FQN resolution
crates/gwi-graph  Package/file graph builder
testdata/         Mini repos + golden parse / evolution fixtures
packages/*        shared-types (sampling, gwi-diff, events), tsconfig, eslint
infra/            docker-compose + terraform stub
docs/adr/         Architecture Decision Records
```

## Phase 2 APIs

| Endpoint | Purpose |
|---|---|
| `GET /v1/repos/:id/commits?sampled=true` | Sampled first-parent commits |
| `GET /v1/repos/:id/graph?sha=` | Materialize graph at SHA (temporal filter) |
| `GET /v1/repos/:id/graph/diff?from=&to=` | Node/edge/SCC diff |
| `GET /v1/repos/:id/timeline` | Typed `evolution_events` |
| `POST /v1/repos/:id/compare` | Body `{ from, to }` → diff payload |

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Turborepo parallel dev |
| `pnpm build` / `lint` / `test` | Pipeline tasks |
| `make up` / `make down` | Compose data plane |
