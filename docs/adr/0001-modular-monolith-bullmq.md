# ADR 0001: Modular monolith + BullMQ (not Temporal yet)

## Status

Accepted (Phase 0)

## Context

Git With It needs async work for cloning (and later parse/graph/metrics). Temporal is the long-term orchestration target for long-running, multi-step analyses, but it adds operator and cognitive overhead on day one.

## Decision

Ship a **modular NestJS monolith** for the control plane and use **Redis + BullMQ** for the Phase 0 `clone` queue. Workers are separate processes (`apps/worker-ts`) sharing the monorepo and types package. Keep clear module boundaries so Temporal (or NATS) can replace BullMQ later without rewriting domain logic.

## Consequences

- Fast local DX: Compose Redis + one worker process.
- Limited workflow semantics (no native sagas/heartbeats) until Phase 5 hardening.
- Job mirror table in Postgres supports UI status without querying Redis.
