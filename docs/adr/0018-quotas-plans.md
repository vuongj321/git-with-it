# ADR 0018: Quotas and Free/Team/Enterprise plan boundaries

## Status

Accepted (Phase 5) — amended: plan limits and enforcement are live; Stripe is **not** wired.

## Amendment (post-Phase 5)

Checked what actually shipped against the decision below:

1. Plans/tiers, `subscriptions`, `usage_counters` and enforcement at analyze/AI enqueue are live
   (`QuotasService.assertCanEnqueueAnalyze` / `assertCanEnqueueAi`, called from
   `repos.controller.ts`).
2. **Stripe Checkout was removed.** It was implemented (`POST /v1/billing/checkout`,
   `STRIPE_SECRET_KEY`, `STRIPE_TEAM_PRICE_ID`) but no UI or deploy consumed it, so the route, the
   env vars, and the `stripe_*` columns on `plans` / `subscriptions` are gone (migration
   `0008_drop_unused_columns.sql`). Plan assignment is now manual: `POST /v1/billing/dev/attach-team`
   (prod-guarded) or a direct `subscriptions` write.
3. The "admin UI surfaces usage" clause is still open — only `GET /v1/billing/usage` exists.

Reintroducing a payment provider should be its own ADR (webhook idempotency, dunning, proration are
not small).

## Context

Multi-tenant SaaS needs hard limits on repos, analysis compute, and AI calls to protect shared capacity and enable monetization. Soft product limits without billing tables will be bypassed or ad hoc.

## Decision

1. **Plans:** Free / Team / Enterprise with documented seat, repo, parse-minute, and AI-call ceilings (exact numbers live in seed/config, not hard-coded in workers).
2. **Tables (Postgres):**
   - `plans` — catalog (limits, Stripe price ids where applicable)
   - `subscriptions` — org → plan, status, period
   - `usage_counters` — period counters for `repos`, `parse_minutes`, `ai_calls` (and similar)
3. **Enforce at analyze enqueue and AI enqueue** (API/control plane): reject or soft-block with clear error when hard limit hit; grace period configurable for Team.
4. Team billing via Stripe Checkout; Enterprise is contact-sales / manual plan assignment.
5. Admin UI surfaces usage, soft vs hard limits, and grace.

## Consequences

- Analyze and AI paths must share one quota check helper; workers trust API pre-checks but may re-check for defense in depth.
- Free tier abuse is mitigated by counters + rate limits; not by obscurity.
- Changing plan limits is a data change, not a deploy, when stored in `plans`.
