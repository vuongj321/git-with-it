# Terraform (Phase 5 scaffolding)

Cloud infra for **staging** and **prod**. Modules are outlined here; concrete `.tf` roots land as environments harden.

Local/dev remains Docker Compose (`infra/docker-compose.yml`).

## Environments

| Env | Purpose |
|---|---|
| `staging` | Ephemeral demo repos, dual-run orchestrator soak (`ORCHESTRATOR`), lower quotas |
| `prod` | Paying tenants; PITR, stricter secret scan (`SECRET_SCAN_MODE=block`) |

## Suggested module layout

```text
infra/terraform/
  modules/
    vpc/              # network, subnets, NAT, private endpoints
    k8s/              # EKS/GKE cluster + node groups + IRSA/Workload Identity
    postgres/         # managed PG 16 + PITR
    redis/            # managed Redis (BullMQ light jobs / cache)
    neo4j/            # Aura or self-managed operator binding
    clickhouse/       # managed or operator
    s3/               # artifacts + cold storage; versioning
    temporal/         # Temporal Cloud namespace + mTLS secrets wiring
    secrets/          # KMS CMKs, ExternalSecrets hooks
  envs/
    staging/
    prod/
```

## Dependency sketch

- VPC → K8s + data stores in private subnets
- K8s workloads pull images; consume PG, Redis, Neo4j, ClickHouse, S3, Temporal Cloud
- IAM: least privilege per service account (`api`, `worker-ts`, `worker-rust`, `temporal-worker`, `web`)

## Out of scope for this stub

- Full module source and remote state backends (add when first staging cluster is provisioned)
- Helm release values live under `infra/helm/gwi/`
