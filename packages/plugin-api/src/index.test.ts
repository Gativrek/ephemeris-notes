import { describe, expect, it } from 'vitest';
import { API_VERSION } from './index';

describe('plugin API', () => {
  it('is version 1.0.0', () => {
    expect(API_VERSION).toBe('1.0.0');
  });
});
