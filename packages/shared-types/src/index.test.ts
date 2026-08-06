import { describe, expect, it } from 'vitest';
import {
  CreateRepoBodySchema,
  entityId,
  GWI_ENTITY_NAMESPACE,
  isLikelyGitRemoteUrl,
  uuidv5,
} from './index';

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
