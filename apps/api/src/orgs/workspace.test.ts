import { describe, expect, it } from 'vitest';
import { normalizeEmail, personalSlugForUser } from './orgs.service';

describe('personalSlugForUser', () => {
  it('builds a stable u- prefix slug from uuid', () => {
    expect(personalSlugForUser('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('u-a1b2c3d4e5f6');
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Admin@Example.COM ')).toBe('admin@example.com');
  });
});
