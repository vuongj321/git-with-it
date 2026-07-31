---
name: Phase 3 Metrics UI
overview: Ship the ClickHouse metrics pipeline and the primary Next.js product UI—interactive graph, architectural timeline, metrics charts, and compare views—so users can explore how architecture and quality signals evolve over sampled history.
todos:
  - id: p3-metrics-engine
    content: Implement gwi-metrics catalog (loc, fan-in/out, cycles, complexity proxy) aligned to graph SHA
    status: pending
  - id: p3-clickhouse-api
    content: ClickHouse schema, metrics_write job, idempotent inserts, Redis-cached metrics APIs
    status: pending
  - id: p3-web-routes
    content: "Next.js routes: overview, graph, timeline, metrics, compare + URL state"
    status: pending
  - id: p3-graph-viz
    content: "Sigma/Graphology graph: package view, expand, heatmap, diff overlay, side panel"
    status: pending
  - id: p3-timeline-metrics-compare
    content: Timeline event UI + metrics charts/tables + compare metric deltas
    status: pending
  - id: p3-tests-polish
    content: Playwright smoke tests, metric goldens, design tokens ADR
    status: pending
isProject: false
---

# Phase 3 — Metrics + UI (3 weeks)

Depends on: [Phase 2 — Evolution](phase_2_evolution_7a6fc744.plan.md)  
Parent: [Git With It Blueprint](git_with_it_blueprint_dc3c8bbe.plan.md)

**Goal:** Persist architectural metrics as a historical time series and deliver the core product experience: overview, interactive graph, timeline, metrics explorer, and compare—backed by Phase 2 diffs and events.

**Exit criteria**

- `gwi-metrics` writes per-entity / per-package metrics to ClickHouse for every sampled commit
- APIs serve metric series, heatmaps, and aggregate rollups with Redis caching
- Next.js app: Overview, Graph, Timeline, Metrics, Compare routes are usable on a demo repo
- Graph supports package view, node expand (ego network), complexity/coupling heatmap modes, and diff overlay (added/removed edges)
- Timeline renders evolution events by month/severity; Metrics page charts fan-in/out, cycles, size, complexity proxy
- Compare view picks two SHAs and visualizes `graph/diff` + key metric deltas
- Responsive desktop + usable mobile read-only; CI visual/smoke tests on critical routes

---

## Scope

**In:** ClickHouse schema + writers; metrics catalog; metrics APIs; full product UI; graph viz (Sigma.js + Graphology); ECharts (or Observable Plot) for series; layout persistence for checkpoints; query caching.

**Out:** AI insight generation (Phase 4 — UI may show empty Insights tab/placeholder); Temporal; SCIP; billing; advanced NL graph query.

---

## Workstreams

### 1. Metrics engine (`gwi-metrics`)

Compute at each sampled commit (package and file granularity for MVP; symbol optional for tip only):

| Metric | Level | Notes |
|---|---|---|
| `loc` / `file_size` | file | From appearance |
| `fan_in` / `fan_out` | file, package | From DEPENDS_ON/IMPORTS |
| `dependency_count` | package | Distinct outbound deps |
| `cycle_member` | package | Boolean / SCC id |
| `cycle_count` | repo | Package-graph SCC count |
| `complexity_proxy` | file | tree-sitter: decision nodes approx (if/while/case/&&/||) — not full McCabe claim in UI copy |
| `churn` | file | Optional: blobs touched in window |
| `maintainability_proxy` | file | Simple weighted combo for heatmap — document formula in ADR |

Emit rows after graph delta apply for that SHA so graph and metrics stay aligned.

### 2. ClickHouse schema

```
metrics_entity (
  repo_id UUID,
  commit_sha String,
  topo_index UInt32,
  authored_at DateTime,
  entity_id UUID,
  entity_kind LowCardinality(String),
  metric LowCardinality(String),
  value Float64
) ENGINE = MergeTree
PARTITION BY repo_id
ORDER BY (repo_id, metric, entity_id, topo_index)
```

Repo-level rollups table or materialized view for overview cards (`cycle_count`, totals).

Retention: keep all sampled points for MVP; document cold-path later.

### 3. Metrics pipeline job

Extend Phase 2 saga: after `graph_write_delta` → `metrics_write` → (existing checkpoint/evolve).

Idempotent inserts keyed by `(repo_id, commit_sha, entity_id, metric)` — use ReplacingMergeTree or delete-before-insert per commit shard.

### 4. Metrics APIs

- `GET /v1/repos/:id/metrics?names=&entity=&from=&to=` — series
- `GET /v1/repos/:id/metrics/heatmap?sha=&metric=&view=package|file` — values for graph coloring
- `GET /v1/repos/:id/metrics/summary?sha=` — overview cards
- `GET /v1/repos/:id/metrics/delta?from=&to=` — top movers

Cache keys in Redis (blueprint §17); invalidate on `analysis_run` completion.

### 5. Frontend architecture

Routes under `apps/web`:

```
/[org]/[repo]/overview
/[org]/[repo]/graph
/[org]/[repo]/timeline
/[org]/[repo]/metrics
/[org]/[repo]/compare
/[org]/[repo]/insights   # placeholder CTA → Phase 4
```

**URL state:** `sha`, `from`, `to`, `focus`, `view`, `metric`, `depth` as search params (shareable).

**Data:** TanStack Query; API client from `packages/api-client`.

### 6. Graph visualization

- **Library:** Sigma.js + Graphology (WebGL); server returns capped slices
- Default **package** graph at `sha`
- Click node → side panel (FQN, metrics at sha, links)
- Expand → fetch ego network `depth=1..2`, merge into client graph
- **Heatmap mode:** color by metric from heatmap API
- **Compare mode:** fetch diff; style added edges/nodes green, removed red; persisted amber
- Layout: Force Atlas 2 (or similar) client-side for &lt;2k nodes; optional server-stored positions per checkpoint for stable animation between SHAs
- Empty/loading/error states; hard cap messaging when truncated

### 7. Timeline UI

- Architectural timeline (not raw git log): group evolution events by month
- Filters: severity, event type
- Click event → navigate to Compare with `from`/`to` prefilled + highlight entities

### 8. Metrics UI

- Repo summary cards at selected SHA
- Multi-series chart for selected entity/package over sampled history
- Top fan-in / complexity tables
- Cycle list at SHA (packages in SCCs)

### 9. Overview + Compare

- **Overview:** run status, tip summary metrics, latest high-severity events, CTA into Graph/Timeline
- **Compare:** dual SHA pickers, metric delta table, embedded diff graph

### 10. Design constraints (product)

- One job per section; graph is the hero on Graph route (full-bleed canvas, controls as chrome—not card soup)
- Colorblind-safe heatmap palette; avoid generic “AI purple” chrome
- Prefer clear engineering aesthetic; typography via a distinctive non-default font pair already chosen in design tokens

### 11. Performance

- Prefetch tip graph on overview
- Redis cache for graph slices + metric series
- Virtualize long timeline lists
- Debounce SHA scrubber if added

---

## ADRs

1. ClickHouse as metrics SoR (Postgres not used for time series)
2. Complexity proxy definition and UI wording (no false “cyclomatic” claims without real CFG)
3. Sigma.js + Graphology for graph viz
4. Shareable URL state for sha/compare/metric

---

## Test plan

- Metrics golden: known fixture → expected fan_in/out and cycle_count at two SHAs
- API contract tests for metrics + heatmap
- Playwright smoke: load demo repo overview → graph → timeline → metrics → compare
- Manual perf check: package graph ≤ 500 nodes interacts at 60fps target on reference laptop

---

## Risks

- Metric/graph skew if metrics job runs on stale graph — tie to same topo_index completion barrier
- Browser OOM on oversized graphs — enforce server caps; never send full symbol graph by default
- Heatmap misleading with proxy metrics — clear labels and docs
- Phase 2 light UI debt — replace JSON/table stubs rather than stacking duplicate pages

---

## Deliverables checklist

- [ ] gwi-metrics + ClickHouse schema + metrics_write job
- [ ] Metrics/heatmap/summary/delta APIs + Redis cache
- [ ] Overview, Graph, Timeline, Metrics, Compare UIs
- [ ] Heatmap + diff overlay on graph
- [ ] Insights placeholder route
- [ ] Playwright smoke + metric goldens
- [ ] ADRs merged
