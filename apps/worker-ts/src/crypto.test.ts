import { describe, expect, it } from 'vitest';
import { decryptPat, encryptPat } from './crypto';

describe('PAT encryption stub', () => {
  it('round-trips', () => {
    const cipher = encryptPat('ghp_test_token');
    expect(decryptPat(cipher)).toBe('ghp_test_token');
  });
});
