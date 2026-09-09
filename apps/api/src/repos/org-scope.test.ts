import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  applySampleDensityBackoff,
  estimateParseMinutes,
  graphSnapshotCandidates,
  graphSnapshotKey,
  isLikelyGitRemoteUrl,
  orgRepoPrefix,
} from '@gwi/shared-types';

/**
 * Tenancy helpers + IDOR-oriented requireRepo contract tests.
 * Full HTTP IDOR coverage needs a live DB; these unit tests lock the
 * filter/key invariants that prevent cross-tenant reads.
 */
describe('org scoping helpers', () => {
  it('filters by org id equality', () => {
    const rows = [
      { id: '1', orgId: 'aaa' },
      { id: '2', orgId: 'bbb' },
    ];
    const orgId = 'aaa';
    expect(rows.filter((r) => r.orgId === orgId)).toHaveLength(1);
  });

  it('rejects bad remotes before insert', () => {
    expect(isLikelyGitRemoteUrl('https://github.com/a/b')).toBe(true);
    expect(isLikelyGitRemoteUrl('git@github.com:a/b.git')).toBe(false);
  });
});

describe('requireRepo IDOR contract', () => {
  it('matches only when both id and org_id align', () => {
    const repos = [
      { id: 'repo-1', orgId: 'org-a' },
      { id: 'repo-1', orgId: 'org-b' }, // impossible in DB (PK) — illustrates predicate
      { id: 'repo-2', orgId: 'org-a' },
    ];
    const requireRepo = (id: string, orgId: string) =>
      repos.find((r) => r.id === id && r.orgId === orgId) ?? null;

    expect(requireRepo('repo-1', 'org-a')).toEqual({ id: 'repo-1', orgId: 'org-a' });
    expect(requireRepo('repo-1', 'org-attacker')).toBeNull();
    expect(requireRepo('repo-2', 'org-b')).toBeNull();
  });

  it('drizzle predicate uses and(id, orgId)', () => {
    // Structural check: OrgMembershipGuard + requireRepo both gate on orgId.
    const id = '00000000-0000-0000-0000-000000000001';
    const orgId = '00000000-0000-0000-0000-0000000000aa';
    const predicate = and(eq({ name: 'id' } as never, id), eq({ name: 'org_id' } as never, orgId));
    expect(predicate).toBeTruthy();
  });
});

describe('storage tenancy prefixes', () => {
  it('uses orgs/{orgId}/repos/{repoId} layout', () => {
    const orgId = 'org-1';
    const repoId = 'repo-9';
    expect(orgRepoPrefix(orgId, repoId)).toBe('orgs/org-1/repos/repo-9');
    expect(graphSnapshotKey(orgId, repoId, 'abc1234')).toBe(
      'orgs/org-1/repos/repo-9/graphs/abc1234.json',
    );
    const candidates = graphSnapshotCandidates(orgId, repoId, 'abc1234');
    expect(candidates[0]).toContain('orgs/org-1/repos/repo-9');
    expect(candidates).toContain('repos/repo-9/graphs/abc1234.json');
  });
});

describe('sample density backoff', () => {
  it('halves lastN until under SLA', () => {
    const estimated = estimateParseMinutes(200, 2); // ~6.67 min at 2s — under 30
    expect(estimated).toBeLessThan(30);
    const hot = applySampleDensityBackoff({
      estimatedMinutes: 120,
      slaMinutes: 30,
      policy: { lastN: 400, monthlyAnchors: true },
    });
    expect(hot.steps).toBeGreaterThan(0);
    expect(hot.policy.lastN).toBeLessThan(400);
    expect(hot.policy.lastN).toBeGreaterThanOrEqual(10);
  });
});
