import { describe, expect, it } from 'vitest';
import { API_VERSION } from './index';

describe('plugin API', () => {
  it('is version 1.2.0 (block starters, SPECS 10.5)', () => {
    expect(API_VERSION).toBe('1.2.0');
  });
});
