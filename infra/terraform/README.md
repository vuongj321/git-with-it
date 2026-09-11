# Terraform (Phase 5 scaffolding)

Cloud infra for **staging** and **prod**. Modules and env roots now have stub `.tf` files (variables + locals + outputs, provider-free) so `terraform fmt` / `terraform validate` can run without cloud credentials. Real provider resources land when staging is first provisioned.

Local/dev remains Docker Compose (`infra/docker-compose.yml`).

## Environments

| Env | Purpose |
|---|---|
| `staging` | Ephemeral demo repos, dual-run orchestrator soak (`ORCHESTRATOR`), lower quotas |
| `prod` | Paying tenants; PITR, stricter secret scan (`SECRET_SCAN_MODE=block`) |

## Layout

```text
infra/terraform/
  modules/
    vpc/              # stub — network, subnets, NAT, private endpoints
    k8s/              # stub — EKS/GKE cluster + node groups + IRSA/Workload Identity
    postgres/         # stub — managed PG 16 + PITR
    redis/            # stub — managed Redis (BullMQ light jobs / cache)
    neo4j/            # (outlined) Aura or self-managed operator binding
    clickhouse/       # (outlined) managed or operator
    s3/               # stub — artifacts + cold storage; versioning
    temporal/         # (outlined) Temporal Cloud namespace + mTLS secrets wiring
    secrets/          # stub — KMS CMKs, ExternalSecrets hooks
  envs/
    staging/main.tf   # wires module stubs
    prod/main.tf      # wires module stubs
```

## Dependency sketch

- VPC → K8s + data stores in private subnets
- K8s workloads pull images; consume PG, Redis, Neo4j, ClickHouse, S3, Temporal Cloud
- IAM: least privilege per service account (`api`, `worker-ts`, `worker-rust`, `temporal-worker`, `web`)

## Out of scope for current stubs

- Cloud provider blocks and remote state backends (add when first staging cluster is provisioned)
- Helm release values live under `infra/helm/gwi/`
