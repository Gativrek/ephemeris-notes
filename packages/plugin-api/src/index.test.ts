import { describe, expect, it } from 'vitest';
import { API_VERSION } from './index';

describe('plugin API', () => {
  it('is version 1.3.0 (cursor insertion and footers, SPECS 12.12)', () => {
    expect(API_VERSION).toBe('1.3.0');
  });
});
