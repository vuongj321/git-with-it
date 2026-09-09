# ADR 0020: GitHub App permission surface (least privilege)

## Status

Accepted (Phase 5)

## Context

A thin GitHub App enables install, default-branch sync, and tip reanalyze on push without storing long-lived user PATs for every repo. Excess permissions increase blast radius if the App credentials leak.

## Decision

1. **Least privilege permissions:**
   - `contents: read` — clone/fetch default branch (and configured refs)
   - `metadata: read` — repo/org metadata for install listing
   - Optionally `checks: write` (or read) later for status/check runs — **off by default** until product needs it
2. **No** write access to contents, PRs, issues, or admin by default.
3. On **push** to the tracked default branch (or configured branch), enqueue **tip-only reanalyze** (not full historical resample unless requested).
4. Installation tokens are short-lived; encrypt App credentials / tokens at rest with KMS (see security docs). Prefer App install over user PAT where possible.

## Consequences

- Product cannot open PRs or mutate repos without a future ADR expanding scope.
- Push storms need debounce/coalesce so tip reanalyze does not stampede workers.
- Private repos work only after org install + org tenancy binding.
