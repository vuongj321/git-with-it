import { describe, expect, it } from 'vitest';
import { CreateRepoBodySchema, isLikelyGitRemoteUrl } from './index';

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
