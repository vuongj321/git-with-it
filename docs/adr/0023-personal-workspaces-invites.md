# ADR 0023: Personal workspaces and team invites

## Status

Accepted

## Context

Product UX treats organizations as optional: individuals should use the full app without joining a team. Teams exist so multiple people can share one analyzed repository (one `repo_id`) without re-running the pipeline. The control plane was already org-scoped for tenancy, quotas, storage, and GitHub binding.

## Decision

1. **Every user gets a personal workspace** — an `organizations` row with `kind=personal`, created on `POST /v1/auth/register` (and seed for the admin). Quotas, repos, and routes continue to use `orgId`.
2. **Team orgs** (`kind=team`) are created via `POST /v1/orgs` and are the only orgs that accept **email invites** (`org_invites`). Accepting an invite adds a membership; it does not remove the personal workspace.
3. There is no nullable `orgId` and no cross-tenant analysis dedupe in this phase. Sharing analysis means membership in the same team org.

## Consequences

- Web login/signup lands on the personal org by default; invite links join teams.
- Billing remains per-org (personal Free + team Free/Team independently).
- Invite delivery is link-based for MVP (no required SMTP).
