# ADR 0018: Quotas and Free/Team/Enterprise plan boundaries

## Status

Accepted (Phase 5)

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
