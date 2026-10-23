import { describe, expect, it } from 'vitest';
import { API_VERSION } from '@vaults/plugin-api';
import { satisfies } from './semver';

describe('satisfies', () => {
  it.each([
    ['1.0.0', '^1.0.0', true],
    ['1.4.2', '^1.0.0', true],
    ['2.0.0', '^1.0.0', false],
    ['0.9.0', '^1.0.0', false],
    ['1.0.5', '~1.0.0', true],
    ['1.1.0', '~1.0.0', false],
    ['1.2.0', '>=1.0.0 <2.0.0', true],
    ['2.0.0', '>=1.0.0 <2.0.0', false],
    ['1.0.0', '1.x', true],
    ['1.0.0', '1', true],
    ['1.0.0', '1.0.0', true],
    ['1.0.1', '1.0.0', false],
    ['0.2.3', '^0.2.0', true],
    ['0.3.0', '^0.2.0', false],
    ['3.0.0', '^1.0.0 || ^3.0.0', true],
    ['1.0.0', 'garbage', false],
  ])('%s in %s is %s', (v, r, ok) => {
    expect(satisfies(v, r)).toBe(ok);
  });

  it('API_VERSION is 1.1.0, and v1 plugins still load (SPECS 12.9, 12.11)', () => {
    expect(API_VERSION).toBe('1.1.0');
    expect(satisfies(API_VERSION, '^1.0.0')).toBe(true);
    expect(satisfies(API_VERSION, '^1.1.0')).toBe(true);
    expect(satisfies(API_VERSION, '^2.0.0')).toBe(false);
  });
});
