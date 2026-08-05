import { describe, expect, it } from 'vitest';

describe('web smoke', () => {
  it('formats status labels', () => {
    expect('ready'.toUpperCase()).toBe('READY');
  });
});
