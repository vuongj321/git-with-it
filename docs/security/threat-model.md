# Threat model

STRIDE-oriented notes for Git With It. Not a formal audit.

## Assets

- Repository content (clones, blobs, graphs)
- Org-scoped metadata, metrics, AI insights
- GitHub App credentials / encrypted PATs
- Shared infra (Postgres, Neo4j, Redis, S3, workers)

## Threats and mitigations

| Threat | STRIDE-ish | Mitigation |
|---|---|---|
| **Clone RCE** — malicious repo runs build/test on clone/parse | Spoofing / Elevation | **Parse-only:** tree-sitter extraction; no `npm install`, `go test`, or repository scripts. Clone timeout and `MAX_CLONE_BYTES` size cap. |
| **Cross-org read** | Tampering / Info disclosure | Every query path filters `org_id`; automated org-scope tests (`repos/org-scope.test.ts`). Neo4j `repo_id` on nodes; S3 prefixes `orgs/{org_id}/repos/{repo_id}/...`. |
| **Secret leakage** (PAT in logs, secrets in cloned trees) | Info disclosure | PATs encrypted at rest (AES-256-GCM, `PAT_ENCRYPTION_KEY`); `authorization` header redacted in API logs. Secret scan on clone — see `secret-scanning.md`. |
| **Resource abuse / cost DoS** | Denial of service | `MAX_CLONE_BYTES` cap; sample-density backoff; single-writer lease per repo. |
| **AuthZ bypass on APIs** | Elevation | NextAuth sessions; org membership guard on every org route; `pnpm audit` in CI. |
| **Poisoned artifacts in object store** | Tampering | Content-addressed parse cache; workers hold only S3/Redis credentials plus the service token. |

## Trust boundaries

- Browser → API (session)
- API → workers (internal service token)
- Workers → git remotes (PAT or GitHub App)
- Workers → Postgres / Neo4j / ClickHouse / S3 (service credentials; the API is the only writer)

Workers treat repository code as **untrusted input**, not executable software.
