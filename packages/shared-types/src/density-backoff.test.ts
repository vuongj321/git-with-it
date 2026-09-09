import { describe, expect, it } from 'vitest';
import {
  applySampleDensityBackoff,
  estimateParseMinutes,
} from './density-backoff';

describe('applySampleDensityBackoff', () => {
  it('no-ops when under SLA', () => {
    const r = applySampleDensityBackoff({
      estimatedMinutes: 10,
      slaMinutes: 30,
      policy: { lastN: 100, monthlyAnchors: true },
    });
    expect(r.steps).toBe(0);
    expect(r.policy.lastN).toBe(100);
  });

  it('backs off aggressively for huge ETAs', () => {
    const r = applySampleDensityBackoff({
      estimatedMinutes: estimateParseMinutes(10_000, 2),
      slaMinutes: 30,
      policy: { lastN: 10_000, monthlyAnchors: true },
    });
    expect(r.policy.lastN).toBeLessThan(10_000);
    expect(r.policy.lastN).toBeGreaterThanOrEqual(10);
    expect(r.steps).toBeGreaterThan(2);
    expect(estimateParseMinutes(r.policy.lastN, 2)).toBeLessThanOrEqual(30);
  });
});
