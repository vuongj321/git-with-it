import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CreateRepoBodySchema,
  computeMetrics,
  diffGraphs,
  entityId,
  eventsFromDiff,
  findSccs,
  GWI_ENTITY_NAMESPACE,
  isLikelyGitRemoteUrl,
  sampleFirstParentCommits,
  uuidv5,
  type GraphSnapshot,
  type WalkedCommit,
} from './index';

const goldensDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../testdata/goldens',
);

describe('isLikelyGitRemoteUrl', () => {
  it('accepts https github urls', () => {
    expect(isLikelyGitRemoteUrl('https://github.com/org/repo.git')).toBe(true);
  });

  it('rejects non-http schemes', () => {
    expect(isLikelyGitRemoteUrl('ftp://example.com/repo.git')).toBe(false);
  });

  it('rejects invalid urls', () => {
    expect(isLikelyGitRemoteUrl('not-a-url')).toBe(false);
  });
});

describe('CreateRepoBodySchema', () => {
  it('requires orgId and remoteUrl', () => {
    const parsed = CreateRepoBodySchema.safeParse({
      remoteUrl: 'https://github.com/org/repo.git',
      orgId: '11111111-1111-1111-1111-111111111111',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('entityId / uuidv5', () => {
  it('uses the documented namespace derived from DNS + git-with-it.entity.v1', () => {
    expect(GWI_ENTITY_NAMESPACE).toBe('73061f4c-6213-5e3a-a533-3a7162bb434f');
    expect(
      uuidv5('git-with-it.entity.v1', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
    ).toBe(GWI_ENTITY_NAMESPACE);
  });

  it('is deterministic across calls', () => {
    const a = entityId(
      '11111111-1111-1111-1111-111111111111',
      'function',
      'src/pay.ts#charge',
    );
    const b = entityId(
      '11111111-1111-1111-1111-111111111111',
      'function',
      'src/pay.ts#charge',
    );
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('changes when kind or fqn changes', () => {
    const base = entityId(
      '11111111-1111-1111-1111-111111111111',
      'function',
      'src/pay.ts#charge',
    );
    expect(
      entityId('11111111-1111-1111-1111-111111111111', 'method', 'src/pay.ts#charge'),
    ).not.toBe(base);
    expect(
      entityId(
        '11111111-1111-1111-1111-111111111111',
        'function',
        'src/pay.ts#refund',
      ),
    ).not.toBe(base);
  });
});

function commit(
  sha: string,
  depth: number,
  authoredAt: Date,
): WalkedCommit {
  return {
    sha,
    parentShas: [],
    authoredAt,
    message: sha,
    depthFromTip: depth,
  };
}

describe('sampleFirstParentCommits', () => {
  it('always includes tip and last N window', () => {
    const walked = Array.from({ length: 10 }, (_, i) =>
      commit(`c${i}`, i, new Date('2024-01-01T00:00:00Z')),
    );
    const samples = sampleFirstParentCommits(walked, {
      lastN: 3,
      monthlyAnchors: false,
    });
    expect(samples.map((s) => s.sha)).toEqual(['c2', 'c1', 'c0']);
    expect(samples.map((s) => s.topoIndex)).toEqual([0, 1, 2]);
    expect(samples[samples.length - 1]!.reason).toBe('tip');
  });

  it('adds monthly anchors beyond the window', () => {
    const walked = [
      commit('tip', 0, new Date('2024-06-15T00:00:00Z')),
      commit('w1', 1, new Date('2024-06-01T00:00:00Z')),
      commit('old', 5, new Date('2024-01-10T00:00:00Z')),
      commit('older', 6, new Date('2024-01-01T00:00:00Z')),
    ];
    const samples = sampleFirstParentCommits(walked, {
      lastN: 2,
      monthlyAnchors: true,
    });
    const shas = samples.map((s) => s.sha);
    expect(shas).toContain('tip');
    expect(shas).toContain('w1');
    expect(shas).toContain('old');
    expect(samples.find((s) => s.sha === 'old')?.reason).toBe('monthly_anchor');
  });
});

describe('findSccs / cycle_introduced golden', () => {
  it('detects a new cycle between shas', () => {
    const from: GraphSnapshot = {
      sha: 'aaa1111',
      nodes: [
        { id: 'file:a.ts', kind: 'file', fqn: 'a.ts', name: 'a.ts' },
        { id: 'file:b.ts', kind: 'file', fqn: 'b.ts', name: 'b.ts' },
      ],
      edges: [
        { from: 'file:a.ts', to: 'file:b.ts', rel: 'DEPENDS_ON' },
      ],
    };
    const to: GraphSnapshot = {
      sha: 'bbb2222',
      nodes: from.nodes,
      edges: [
        { from: 'file:a.ts', to: 'file:b.ts', rel: 'DEPENDS_ON' },
        { from: 'file:b.ts', to: 'file:a.ts', rel: 'DEPENDS_ON' },
      ],
    };
    expect(findSccs(from.edges, from.nodes.map((n) => n.id))).toHaveLength(0);
    expect(findSccs(to.edges, to.nodes.map((n) => n.id))).toHaveLength(1);

    const diff = diffGraphs(from, to);
    expect(diff.sccsAdded).toHaveLength(1);
    const events = eventsFromDiff(diff);
    expect(events.some((e) => e.type === 'cycle_introduced')).toBe(true);
    expect(events.some((e) => e.type === 'dependency_added')).toBe(true);
  });
});

describe('rename_detected golden', () => {
  it('aligns renamed file ids and emits rename_detected', () => {
    const from: GraphSnapshot = {
      sha: 'ccc3333',
      nodes: [
        { id: 'file:src/old.ts', kind: 'file', fqn: 'src/old.ts', name: 'old.ts' },
      ],
      edges: [],
    };
    const to: GraphSnapshot = {
      sha: 'ddd4444',
      nodes: [
        { id: 'file:src/new.ts', kind: 'file', fqn: 'src/new.ts', name: 'new.ts' },
      ],
      edges: [],
    };
    const renameMap = new Map([['file:src/old.ts', 'file:src/new.ts']]);
    const diff = diffGraphs(from, to, { renameMap });
    expect(diff.nodesRenamed).toHaveLength(1);
    expect(diff.nodesAdded).toHaveLength(0);
    expect(diff.nodesRemoved).toHaveLength(0);
    const events = eventsFromDiff(diff);
    expect(events.some((e) => e.type === 'rename_detected')).toBe(true);
  });
});

describe('metrics-cycle golden', () => {
  it('matches fan_in/out and cycle_count at two SHAs', () => {
    const golden = JSON.parse(
      readFileSync(path.join(goldensDir, 'metrics-cycle.json'), 'utf8'),
    ) as {
      repoId: string;
      expect: Record<
        string,
        {
          cycle_count: number;
          file_fan_out?: Record<string, number>;
          file_fan_in?: Record<string, number>;
        }
      >;
    };

    const from: GraphSnapshot = {
      sha: 'aaa1111',
      nodes: [
        { id: 'file:a.ts', kind: 'file', fqn: 'a.ts', name: 'a.ts' },
        { id: 'file:b.ts', kind: 'file', fqn: 'b.ts', name: 'b.ts' },
      ],
      edges: [{ from: 'file:a.ts', to: 'file:b.ts', rel: 'DEPENDS_ON' }],
    };
    const to: GraphSnapshot = {
      sha: 'bbb2222',
      nodes: from.nodes,
      edges: [
        { from: 'file:a.ts', to: 'file:b.ts', rel: 'DEPENDS_ON' },
        { from: 'file:b.ts', to: 'file:a.ts', rel: 'DEPENDS_ON' },
      ],
    };

    const rowsA = computeMetrics({
      repoId: golden.repoId,
      snapshot: from,
      topoIndex: 0,
    });
    const rowsB = computeMetrics({
      repoId: golden.repoId,
      snapshot: to,
      topoIndex: 1,
    });

    expect(
      rowsA.find((r) => r.metric === 'cycle_count' && r.entityKind === 'repo')
        ?.value,
    ).toBe(golden.expect.aaa1111.cycle_count);
    expect(
      rowsB.find((r) => r.metric === 'cycle_count' && r.entityKind === 'repo')
        ?.value,
    ).toBe(golden.expect.bbb2222.cycle_count);

    const fanOutA = (fqn: string) =>
      rowsA.find(
        (r) =>
          r.metric === 'fan_out' &&
          r.entityId === entityId(golden.repoId, 'file', fqn),
      )?.value;
    const fanInB = (fqn: string) =>
      rowsB.find(
        (r) =>
          r.metric === 'fan_in' &&
          r.entityId === entityId(golden.repoId, 'file', fqn),
      )?.value;

    expect(fanOutA('a.ts')).toBe(golden.expect.aaa1111.file_fan_out!['a.ts']);
    expect(fanOutA('b.ts')).toBe(golden.expect.aaa1111.file_fan_out!['b.ts']);
    expect(fanInB('a.ts')).toBe(golden.expect.bbb2222.file_fan_in!['a.ts']);
    expect(fanInB('b.ts')).toBe(golden.expect.bbb2222.file_fan_in!['b.ts']);
  });
});
