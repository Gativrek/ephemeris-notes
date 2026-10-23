import { describe, expect, it } from 'vitest';
import { API_VERSION } from './index';

describe('plugin API', () => {
  it('is version 1.1.0 (v2 additions, SPECS 12.11)', () => {
    expect(API_VERSION).toBe('1.1.0');
  });
});
