/**
 * Sample density backoff when ETA exceeds SLA (Phase 5).
 *
 * Reduces `lastN` (and disables monthly anchors at the lowest tier) so tip-first
 * progressive delivery stays within the analyze tip latency budget.
 */

import type { SamplePolicy } from './sampling';

export type DensityBackoffInput = {
  /** Estimated parse-commit minutes for the current sample size. */
  estimatedMinutes: number;
  /** Soft SLA ceiling before backoff (default 30). */
  slaMinutes?: number;
  policy: SamplePolicy;
};

export type DensityBackoffResult = {
  policy: SamplePolicy;
  /** How many backoff steps were applied (0 = unchanged). */
  steps: number;
  reason?: string;
};

const LAST_N_FLOOR = 10;

/**
 * Halve `lastN` until estimated minutes fit under SLA or floor is reached.
 * At floor, also disable monthly anchors.
 */
export function applySampleDensityBackoff(
  input: DensityBackoffInput,
): DensityBackoffResult {
  const sla = input.slaMinutes ?? 30;
  let lastN = input.policy.lastN;
  let monthlyAnchors = input.policy.monthlyAnchors;
  let steps = 0;
  let estimated = input.estimatedMinutes;

  if (estimated <= sla) {
    return { policy: { lastN, monthlyAnchors }, steps: 0 };
  }

  while (estimated > sla && lastN > LAST_N_FLOOR) {
    lastN = Math.max(LAST_N_FLOOR, Math.floor(lastN / 2));
    steps += 1;
    // Assume cost scales roughly with sample count.
    estimated = estimated / 2;
  }

  if (estimated > sla && monthlyAnchors) {
    monthlyAnchors = false;
    steps += 1;
  }

  return {
    policy: { lastN, monthlyAnchors },
    steps,
    reason:
      steps > 0
        ? `density backoff ${steps} step(s) to fit ~${sla}m SLA (lastN=${lastN})`
        : undefined,
  };
}

/** Rough ETA helper: commits × secondsPerCommit / 60. */
export function estimateParseMinutes(
  sampleCount: number,
  secondsPerCommit = 2,
): number {
  return (sampleCount * secondsPerCommit) / 60;
}
