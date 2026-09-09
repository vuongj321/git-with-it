# Enterprise seams (design stubs)

Design-only. Do not build full product unless a design partner funds it. APIs may expose stub routes/flags.

## SAML / OIDC SSO

- Org-level IdP metadata; map groups → roles (admin/member).
- AuthJS (or successor) enterprise provider; keep email/password for Free/Team until migration.

## SCIM

- Provision/deprovision users into org membership.
- Idempotent external ids; audit every mutate.

## Audit export

- Append-only audit log: authz, analyze start, secret-scan block, billing changes.
- Export: filtered JSON/CSV to S3 or customer bucket (customer-managed key optional).

## VPC / private link

- Private connectivity to customer Git hosts and/or private GWI endpoints.
- No shared-worker execution of customer build scripts (still parse-only / SCIP policy).

## Data residency

- Region pin per org (`us`, `eu`, …): PG, object store, Neo4j, ClickHouse, Temporal namespace.
- Cross-region replication off by default for Enterprise residency contracts.

## Portfolio (multi-repo)

- Read API aggregating package graphs / metrics across `repo_id`s in one org.
- UI: stub nav; enforce same org scoping as single-repo views.

## Jira / Linear

- Export insight → issue via OAuth app; map severity/entity link.
- Outbound only in v1; no inbound sync loops.

## Explicit non-goals (near term)

- Air-gapped appliance, VS Code extension, full PR review bot — separate tracks.
