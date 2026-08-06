# Git With It

AI-powered software evolution platform. Phase 0 foundations plus Phase 1 parse/identity work-in-progress: tree-sitter extractors (`gwi-parse`), entity registry, and single-SHA Neo4j graphs.

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) 9.15+
- Docker + Docker Compose
- Rust toolchain (for `gwi-git`; see `rust-toolchain.toml`)
- System `git` on PATH (used by `gwi-git`)

> **Windows note:** Prefer WSL2 or run the worker inside Docker. OneDrive-synced paths can break ephemeral git workspaces.

## Quick start

```bash
cp .env.example .env
make up          # Postgres, Redis, MinIO, Neo4j, ClickHouse
pnpm install
pnpm db:migrate
pnpm db:seed
cargo build -p gwi-git --release
# put target/release/gwi-git on PATH, or set GWI_GIT_BIN
pnpm dev
```

- Web: http://localhost:3000  
- API: http://localhost:4000/health  
- MinIO console: http://localhost:9001 (`gwiadmin` / `gwiadmin123`)

Default login after seed: `admin@git-with-it.local` / `admin1234` (org slug `demo`).

See [docs/architecture/local-dev.md](docs/architecture/local-dev.md) for ports and service details.

## Workspace layout

```
apps/web          Next.js shell
apps/api          NestJS control plane + Drizzle
apps/worker-ts    BullMQ clone / parse / graph_write worker
crates/gwi-git    Bare clone / fetch / blob CLI
crates/gwi-parse  tree-sitter TS/JS + Python extractors
crates/gwi-link   Import → FQN resolution
crates/gwi-graph  Package/file graph builder
testdata/         Mini repos + golden parse fixtures
packages/*        shared-types, tsconfig, eslint-config
infra/            docker-compose + terraform stub
docs/adr/         Architecture Decision Records
```

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Turborepo parallel dev |
| `pnpm build` / `lint` / `test` | Pipeline tasks |
| `make up` / `make down` | Compose data plane |
