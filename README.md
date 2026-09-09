# Git With It

AI-powered software evolution platform. Phase 0–5: clone, parse/identity (TS/JS/Python/Go/Java), sampled evolution, ClickHouse metrics, product UI, AI insights, plus hardening (quotas, Temporal dual-run, tenancy, GitHub App tip sync, SCIP flag path).

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

### AI insights (optional)

After `evolve`, the worker enqueues an `ai` job that ranks anomaly candidates, builds `evidence_v1` bundles, and (when enabled) generates schema-validated insights.

| Env | Purpose |
|---|---|
| `AI_PROVIDER` | `disabled` (default), `mock`, `openai`, or `anthropic` |
| `AI_MODEL` | Model id (default `mock-grounded-v1`) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Required only for live providers |

Use `AI_PROVIDER=mock` for local/CI narratives with no live key. With `disabled`, the run still finishes; the Insights UI shows an “AI disabled” banner.

## Workspace layout

```
apps/web          Next.js product UI (overview, graph, timeline, metrics, compare, insights)
apps/api          NestJS control plane + Drizzle + ClickHouse metrics + insights APIs
apps/worker-ts    BullMQ clone → … → metrics_write → evolve → ai
crates/gwi-git    Bare clone / fetch / blob / first-parent log / diff-tree
crates/gwi-parse  tree-sitter TS/JS + Python + Go + Java extractors
crates/gwi-link   Import → FQN resolution
crates/gwi-graph  Package/file graph builder
crates/gwi-metrics Architectural metrics from graph snapshots
testdata/         Mini repos + golden parse / evolution / metrics fixtures
packages/*        shared-types (sampling, gwi-diff, events, metrics, insights), tsconfig, eslint
infra/            docker-compose + ClickHouse init + terraform stub
docs/adr/         Architecture Decision Records
```

## Phase 3–4 APIs

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
| `GET /v1/repos/:id/insights?severity=&category=` | Insight feed |
| `GET /v1/repos/:id/insights/:insightId` | Insight detail |
| `GET /v1/repos/:id/entities/:entityId/insights` | Insights mentioning an entity |
| `POST /v1/repos/:id/runs/:runId/insights/regenerate` | Re-run AI for a completed sample |

| `POST /v1/repos/:id/insights/:insightId/dismiss` | Dismiss / snooze / feedback |
| `GET /v1/billing/usage?orgId=` | Plan + usage counters |
| `POST /v1/billing/checkout` | Stripe Team Checkout (or mock) |
| `POST /v1/github/webhook` | GitHub App push → tip reanalyze |

Insights are grounded in measured signals (metrics, diffs, evolution events)—not freeform repo chat.

### Phase 5 ops knobs

| Env | Purpose |
|---|---|
| `ORCHESTRATOR` | `bullmq` (default) or `temporal` dual-run |
| `SECRET_SCAN_MODE` | `off` \| `warn` \| `block` on clone |
| `STRIPE_*` | Team billing Checkout |
| `GITHUB_WEBHOOK_SECRET` | Hub signature verification |

## Product routes

`/[org]/repos/[repo]/{overview,graph,timeline,metrics,compare,insights}` — shareable `sha` / `from` / `to` / `metric` / `view` / `focus` / `severity` / `category` query params.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Turborepo parallel dev |
| `pnpm build` / `lint` / `test` | Pipeline tasks |
| `pnpm --filter @gwi/web test:e2e` | Playwright smoke (web server required) |
| `make up` / `make down` | Compose data plane |
