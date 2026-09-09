import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/** Mirrors repos.controller MetricsSeriesQuery / HeatmapQuery contracts. */
const MetricsSeriesQuery = z.object({
  names: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? 'fan_in,fan_out,complexity_proxy,loc,cycle_count')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  entity: z.string().uuid().optional(),
  from: z.string().min(7).optional(),
  to: z.string().min(7).optional(),
});

const HeatmapQuery = z.object({
  sha: z.string().min(7),
  metric: z.string().min(1).default('fan_in'),
  view: z.enum(['package', 'file']).default('package'),
});

const SummaryQuery = z.object({
  sha: z.string().min(7).optional(),
});

const MetricsDeltaQuery = z.object({
  from: z.string().min(7),
  to: z.string().min(7),
  metric: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

describe('metrics API query contracts', () => {
  it('parses series names list', () => {
    const parsed = MetricsSeriesQuery.parse({ names: 'fan_in,cycle_count' });
    expect(parsed.names).toEqual(['fan_in', 'cycle_count']);
  });

  it('defaults heatmap metric and view', () => {
    const parsed = HeatmapQuery.parse({ sha: 'abcdef0' });
    expect(parsed.metric).toBe('fan_in');
    expect(parsed.view).toBe('package');
  });

  it('allows optional summary sha', () => {
    expect(SummaryQuery.parse({}).sha).toBeUndefined();
    expect(SummaryQuery.parse({ sha: 'abcdef0123' }).sha).toBe('abcdef0123');
  });

  it('parses delta with limit', () => {
    const parsed = MetricsDeltaQuery.parse({
      from: 'aaa1111',
      to: 'bbb2222',
      limit: '10',
    });
    expect(parsed.limit).toBe(10);
  });
});
