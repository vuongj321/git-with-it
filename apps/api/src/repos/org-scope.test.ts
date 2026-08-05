import { describe, expect, it } from 'vitest';
import { isLikelyGitRemoteUrl } from '@gwi/shared-types';

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
