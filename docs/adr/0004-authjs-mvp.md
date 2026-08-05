# ADR 0004: Auth.js-compatible credentials for MVP auth

## Status

Accepted (Phase 0)

## Context

Clerk reduces auth build time but increases vendor lock-in before tenancy patterns stabilize. Full enterprise SSO is out of scope for Phase 0.

## Decision

Use **Auth.js (NextAuth) on `apps/web`** with a **Credentials** provider that validates against the API (`POST /v1/auth/login`). Sessions are HS256 JWTs signed with the shared `AUTH_SECRET` / `NEXTAUTH_SECRET`. The NestJS API accepts the same Bearer JWT via `JwtOrSessionAuthGuard` and enforces tenancy with `OrgMembershipGuard`.

Clerk remains a deferred option for hosted SSO later.

## Consequences

- One secret shared between web and API for local/dev.
- Password hashes live in Postgres (`users.password_hash`); seed creates an admin membership.
- Service-to-service worker callbacks use a derived service token from `AUTH_SECRET` (not a user session).
