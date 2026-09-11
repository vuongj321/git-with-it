import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EvidenceBundleSchema,
  InsightOutputSchema,
  type EvidenceBundle,
} from '@gwi/shared-types';

const fixturesDir = path.resolve(__dirname, '../../../testdata/insights');

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(',')}}`;
}

/** Mirror of worker mock insight for grounded eval without calling a live provider. */
function mockInsight(bundle: EvidenceBundle) {
  const primary = bundle.signals[0];
  const firstEntity = bundle.entities[0];
  const label = firstEntity?.name || firstEntity?.fqn || 'entity';
  return {
    headline: `${label} shows measurable architectural pressure`,
    narrative: [
      `Based on measured signals, ${label} was selected because ${primary?.label ?? 'its metrics changed materially'}.`,
      ...(bundle.allowedClaims ?? []).slice(0, 3),
    ]
      .filter(Boolean)
      .join(' '),
    severity: 'high' as const,
    category: 'drift' as const,
    entityIds: bundle.entities.map((e) => e.id),
    confidence: 0.7,
    suggestedActions: ['Inspect compare view for the cited commit range'],
    citedSignals: bundle.signals.slice(0, 3).map((s) => s.id),
  };
}

describe('AI insight eval fixtures', () => {
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.bundle.json'));

  it('loads at least one fixture', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`grounds ${file}`, () => {
      const raw = JSON.parse(
        readFileSync(path.join(fixturesDir, file), 'utf8'),
      ) as Record<string, unknown> & {
        expect: {
          callsLlm: boolean;
          citedSignalsInclude?: string[];
          entityIdsInclude?: string[];
        };
      };

      const { expect: expectation, ...bundleRaw } = raw;
      const bundle = EvidenceBundleSchema.parse({
        version: 'evidence_v1',
        ...bundleRaw,
      });

      const evidenceHash = sha256(canonicalize(bundle));
      expect(evidenceHash).toMatch(/^[a-f0-9]{64}$/);

      // Worker rule: empty signals never call the LLM.
      if (!expectation.callsLlm) {
        expect(bundle.signals).toHaveLength(0);
        return;
      }

      expect(bundle.signals.length).toBeGreaterThan(0);
      const output = mockInsight(bundle);
      const parsed = InsightOutputSchema.parse(output);
      for (const id of expectation.citedSignalsInclude ?? []) {
        expect(parsed.citedSignals).toContain(id);
      }
      for (const id of expectation.entityIdsInclude ?? []) {
        expect(parsed.entityIds).toContain(id);
      }
      for (const cited of parsed.citedSignals) {
        expect(bundle.signals.some((s) => s.id === cited)).toBe(true);
      }
    });
  }
});
