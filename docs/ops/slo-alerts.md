# SLOs and alerts

## SLOs (initial targets)

| SLO | Target | Notes |
|---|---|---|
| API availability | ≥ 99.9% monthly | `/health` + authenticated critical routes; exclude planned maintenance |
| Analyze tip latency | p50 ≤ 2 min, p95 ≤ 10 min | Tip graph_ready for median demo-sized repos; exclude cold start / first clone of huge repos |
| Queue / workflow lag | p95 time-to-start ≤ 60 s | BullMQ wait or Temporal schedule-to-start for analysis |

Tighten or split by plan/tier once production baselines exist.

## Alerts (minimum set)

| Alert | Condition (sketch) | Severity |
|---|---|---|
| API down | Health check fail ≥ 2 min | P1 |
| Analyze tip SLO burn | Error budget burn on tip latency | P2 |
| Queue lag high | Lag / schedule-to-start above threshold 15+ min | P2 |
| Failed analysis workflows | Failure rate spike or stuck running | P2 |
| Neo4j disk | Free space < 20% | P1 |
| AI error rate | Provider/API errors above baseline | P3 |
| Quota exhaustion storm | Spike of 429/quota rejects per org or global | P3 |
| Secret scan / worker crash loops | Restart rate or block rate anomaly | P2 |

## Observability

- OpenTelemetry traces: API → orchestrator (BullMQ/Temporal) → workers
- Dashboards: tip latency, queue depth, Neo4j/ClickHouse saturation, AI spend proxies
- Page on P1; ticket/Slack for P2/P3 with runbook links
