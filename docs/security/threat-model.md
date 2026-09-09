# Threat model (Phase 5)

STRIDE-oriented notes for Git With It multi-tenant SaaS. Not a formal audit.

## Assets

- Customer git content (clones, blobs, graphs)
- Org-scoped metadata, metrics, AI insights
- GitHub App credentials / encrypted PATs
- Shared infra (PG, Neo4j, Redis, S3, workers)

## Threats and mitigations

| Threat | STRIDE-ish | Mitigation |
|---|---|---|
| **Clone RCE** — malicious repo runs build/test on clone/parse | Spoofing / Elevation | **Parse-only default:** tree-sitter extraction; no `npm install`, `go test`, or customer scripts. SCIP path: allowlisted invoke only (ADR 0017). Timeouts, file/size limits. |
| **IDOR / cross-tenant read** | Tampering / Info disclosure | Every query path filters `org_id`; automated IDOR tests. Neo4j `repo_id` on nodes; S3 prefixes `orgs/{org_id}/repos/{repo_id}/...`. |
| **SCIP / indexer build execution** | Elevation | Never run untrusted build scripts in shared SaaS. Prefer pre-index upload. Feature flag `scip_enabled` gated by policy. |
| **Secret leakage** (PAT in logs, secrets in cloned trees) | Info disclosure | KMS-encrypt PATs/App secrets at rest; scrub logs. **gitleaks** (or equiv.) on clone — see `secret-scanning.md`. |
| **Quota abuse / cost DoS** | Denial of service | Enforce plans at analyze + AI enqueue (ADR 0018); clone size/file limits; sample-density backoff; rate limits. |
| **AuthZ bypass on APIs** | Elevation | AuthJS sessions; org membership checks; pen-test / dependency scanning in CI. |
| **Poisoned artifacts in object store** | Tampering | Content-addressed where possible; checksums on cold-age writes; least-privilege IAM for workers. |

## Trust boundaries

- Browser → API (session)
- API → workers / Temporal (internal)
- Workers → git remotes (customer or GitHub App)
- Workers → PG / Neo4j / ClickHouse / S3 (service credentials)

Workers treat repository code as **untrusted input**, not executable software.
