import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CreateRepoBodySchema,
  computeMetrics,
  diffGraphs,
  entityId,
  eventsFromDiff,
  findSccs,
  graphRefToEntityId,
  GWI_ENTITY_NAMESPACE,
  isEntityUuid,
  isLikelyGitRemoteUrl,
  sampleFirstParentCommits,
  uuidv5,
  type GraphSnapshot,
  type WalkedCommit,
} from './index';

const goldensDir = path.resolve(__dirname, '../../../testdata/goldens');

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
  it('detects a new cycle between shas from evolution-cycle.json', () => {
    const golden = JSON.parse(
      readFileSync(path.join(goldensDir, 'evolution-cycle.json'), 'utf8'),
    ) as { fromSha: string; toSha: string; expectEventTypes: string[] };

    const from: GraphSnapshot = {
      sha: golden.fromSha,
      nodes: [
        { id: 'file:a.ts', kind: 'file', fqn: 'a.ts', name: 'a.ts' },
        { id: 'file:b.ts', kind: 'file', fqn: 'b.ts', name: 'b.ts' },
      ],
      edges: [
        { from: 'file:a.ts', to: 'file:b.ts', rel: 'DEPENDS_ON' },
      ],
    };
    const to: GraphSnapshot = {
      sha: golden.toSha,
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
    const repoId = '11111111-1111-1111-1111-111111111111';
    const events = eventsFromDiff(diff, { repoId });
    for (const t of golden.expectEventTypes) {
      expect(events.some((e) => e.type === t)).toBe(true);
    }
    const cycle = events.find((e) => e.type === 'cycle_introduced')!;
    expect(cycle.entityIds.every(isEntityUuid)).toBe(true);
    expect(cycle.entityIds).toContain(entityId(repoId, 'file', 'a.ts'));
    expect(cycle.entityIds).toContain(entityId(repoId, 'file', 'b.ts'));
  });
});

describe('rename_detected golden', () => {
  it('aligns renamed file ids from evolution-rename.json', () => {
    const golden = JSON.parse(
      readFileSync(path.join(goldensDir, 'evolution-rename.json'), 'utf8'),
    ) as {
      fromSha: string;
      toSha: string;
      rename: { from: string; to: string };
      expectEventTypes: string[];
    };

    const from: GraphSnapshot = {
      sha: golden.fromSha,
      nodes: [
        { id: golden.rename.from, kind: 'file', fqn: 'src/old.ts', name: 'old.ts' },
      ],
      edges: [],
    };
    const to: GraphSnapshot = {
      sha: golden.toSha,
      nodes: [
        { id: golden.rename.to, kind: 'file', fqn: 'src/new.ts', name: 'new.ts' },
      ],
      edges: [],
    };
    const renameMap = new Map([[golden.rename.from, golden.rename.to]]);
    const diff = diffGraphs(from, to, { renameMap });
    expect(diff.nodesRenamed).toHaveLength(1);
    expect(diff.nodesAdded).toHaveLength(0);
    expect(diff.nodesRemoved).toHaveLength(0);
    const repoId = '11111111-1111-1111-1111-111111111111';
    const events = eventsFromDiff(diff, { repoId });
    for (const t of golden.expectEventTypes) {
      expect(events.some((e) => e.type === t)).toBe(true);
    }
    const rename = events.find((e) => e.type === 'rename_detected')!;
    expect(rename.entityIds).toEqual([
      entityId(repoId, 'file', 'src/old.ts'),
      entityId(repoId, 'file', 'src/new.ts'),
    ]);
  });
});

describe('graphRefToEntityId', () => {
  it('maps file/pkg graph ids to UUIDv5', () => {
    const repoId = '11111111-1111-1111-1111-111111111111';
    expect(graphRefToEntityId(repoId, 'file:src/a.ts')).toBe(
      entityId(repoId, 'file', 'src/a.ts'),
    );
    expect(graphRefToEntityId(repoId, 'pkg:@scope/pkg')).toBe(
      entityId(repoId, 'package', '@scope/pkg'),
    );
    const uuid = entityId(repoId, 'file', 'x.ts');
    expect(graphRefToEntityId(repoId, uuid)).toBe(uuid);
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

    const expectA = golden.expect.aaa1111!;
    const expectB = golden.expect.bbb2222!;

    expect(
      rowsA.find((r) => r.metric === 'cycle_count' && r.entityKind === 'repo')
        ?.value,
    ).toBe(expectA.cycle_count);
    expect(
      rowsB.find((r) => r.metric === 'cycle_count' && r.entityKind === 'repo')
        ?.value,
    ).toBe(expectB.cycle_count);

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

    expect(fanOutA('a.ts')).toBe(expectA.file_fan_out!['a.ts']);
    expect(fanOutA('b.ts')).toBe(expectA.file_fan_out!['b.ts']);
    expect(fanInB('a.ts')).toBe(expectB.file_fan_in!['a.ts']);
    expect(fanInB('b.ts')).toBe(expectB.file_fan_in!['b.ts']);
  });
});
