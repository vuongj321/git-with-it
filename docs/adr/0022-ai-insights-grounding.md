# ADR 0022: AI insights grounding

## Status

Accepted (Phase 4)

## Context

LLM narratives over architecture are useful only if they stay bound to measured signals. Ungrounded generation invents topology, numbers, or entities and destroys trust. CI must exercise the path without live provider keys.

## Decision

1. **Narrate evidence only.** The LLM may restate, rank, and explain facts present in an `evidence_v1` bundle (entities, metric snippets, evolution signals). It must not invent edges, SHAs, or quantities absent from the bundle.
2. **Empty signals skip the LLM.** If a candidate’s bundle has zero signals, the worker does not call a provider; the candidate is recorded without a published insight.
3. **Schema validation + repair.** Provider JSON is validated (Zod / shared insight schema). Citations must reference allowed entity and signal ids. On failure, one repair prompt retries; persistent failure marks `failed_validation` and does not publish.
4. **Mock provider for CI.** `AI_PROVIDER=mock` returns a deterministic, schema-valid insight from the bundle so unit/eval and optional pipelines run without API keys. `disabled` skips generation entirely.
5. **`evidence_hash` dedupe.** Bundles are hashed; identical evidence reuses prior insight generation / cache keys so reruns do not spam providers or duplicate narratives.

## Consequences

- Insights UI can show “based on measured signals” with links back to events/metrics.
- Provider adapters (OpenAI / Anthropic) share the same validate-then-publish gate.
- Ops can disable AI (`AI_PROVIDER=disabled`) without breaking analysis pipelines.
- Eval fixtures stay offline-friendly via the mock provider.
