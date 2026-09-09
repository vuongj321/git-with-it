# Git With It

AI-powered software evolution platform. Phase 0–3: clone, parse/identity, sampled evolution, ClickHouse metrics, and product UI (graph / timeline / metrics / compare).

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) 9.15+
- Docker + Docker Compose
- Rust toolchain (for `gwi-git` / parse / metrics crates; see `rust-toolchain.toml`)
- System `git` on PATH (used by `gwi-git`)

> **Windows note:** Prefer WSL2 or run the worker inside Docker. OneDrive-synced paths can break ephemeral git workspaces.

## Quick start

```bash
cp .env.example .env
make up          # Postgres, Redis, MinIO, Neo4j, ClickHouse
pnpm install
pnpm db:migrate
pnpm db:seed
cargo build -p gwi-git -p gwi-parse -p gwi-link -p gwi-graph -p gwi-metrics --release
# put target/release/* on PATH, or set GWI_GIT_BIN / GWI_PARSE_BIN / …
pnpm dev
```

- Web: http://localhost:3000  
- API: http://localhost:4000/health  
- MinIO console: http://localhost:9001 (`gwiadmin` / `gwiadmin123`)
- ClickHouse HTTP: http://localhost:8123

Default login after seed: `admin@git-with-it.local` / `admin1234` (org slug `demo`).

See [docs/architecture/local-dev.md](docs/architecture/local-dev.md) for ports and service details.

## Workspace layout

```
apps/web          Next.js product UI (overview, graph, timeline, metrics, compare)
apps/api          NestJS control plane + Drizzle + ClickHouse metrics APIs
apps/worker-ts    BullMQ clone → enumerate → parse_commit → metrics_write → evolve
crates/gwi-git    Bare clone / fetch / blob / first-parent log / diff-tree
crates/gwi-parse  tree-sitter TS/JS + Python extractors
crates/gwi-link   Import → FQN resolution
crates/gwi-graph  Package/file graph builder
crates/gwi-metrics Architectural metrics from graph snapshots
testdata/         Mini repos + golden parse / evolution / metrics fixtures
packages/*        shared-types (sampling, gwi-diff, events, metrics), tsconfig, eslint
infra/            docker-compose + ClickHouse init + terraform stub
docs/adr/         Architecture Decision Records
```

## Phase 3 APIs

| Endpoint | Purpose |
|---|---|
| `GET /v1/repos/:id/metrics?names=&entity=&from=&to=` | Metric series |
| `GET /v1/repos/:id/metrics/heatmap?sha=&metric=&view=` | Heatmap values |
| `GET /v1/repos/:id/metrics/summary?sha=` | Overview cards |
| `GET /v1/repos/:id/metrics/delta?from=&to=` | Top movers |
| `GET /v1/repos/:id/commits?sampled=true` | Sampled first-parent commits |
| `GET /v1/repos/:id/graph?sha=` | Materialize graph at SHA |
| `GET /v1/repos/:id/graph/diff?from=&to=` | Node/edge/SCC diff |
| `GET /v1/repos/:id/timeline` | Typed `evolution_events` |
| `POST /v1/repos/:id/compare` | Body `{ from, to }` → diff payload |

## Product routes

`/[org]/repos/[repo]/{overview,graph,timeline,metrics,compare,insights}` — shareable `sha` / `from` / `to` / `metric` / `view` query params.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Turborepo parallel dev |
| `pnpm build` / `lint` / `test` | Pipeline tasks |
| `pnpm --filter @gwi/web test:e2e` | Playwright smoke (web server required) |
| `make up` / `make down` | Compose data plane |
