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

const MetricRowBody = z.object({
  repoId: z.string().uuid(),
  commitSha: z.string().min(7),
  topoIndex: z.number().int().min(0),
  authoredAt: z.string().nullable().optional(),
  entityId: z.string().uuid(),
  entityKind: z.string().min(1),
  metric: z.string().min(1),
  value: z.number(),
});

const MetricsWriteBody = z
  .object({
    sha: z.string().min(7).optional(),
    topoIndex: z.number().int().min(0).optional(),
    authoredAt: z.string().nullable().optional(),
    artifactUri: z.string().min(1).optional(),
    rows: z.array(MetricRowBody).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.rows && val.rows.length > 0) return;
    if (!val.sha || val.topoIndex == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sha+topoIndex (artifactUri optional) or rows required',
      });
    }
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

  it('accepts metrics write by artifact pointer', () => {
    const parsed = MetricsWriteBody.parse({
      sha: 'abcdef0123',
      topoIndex: 0,
      artifactUri: 'repos/x/graphs/abcdef0123.json',
    });
    expect(parsed.sha).toBe('abcdef0123');
    expect(parsed.topoIndex).toBe(0);
  });

  it('rejects empty metrics write body', () => {
    expect(() => MetricsWriteBody.parse({})).toThrow();
  });
});
