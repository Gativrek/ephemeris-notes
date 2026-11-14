import { describe, expect, it } from 'vitest';
import { equationLabel, referenceText, summarize } from './noteEquations';

const NOTE = [
  '# Kalman Filter',
  '',
  '$$ x = Fx $$ {#eq:kf-predict}',
  '',
  '$$ P = FPF^T + Q $$',
  '',
  '$$ K = PH^T S^{-1} $$ {#eq:kf-gain}',
  '',
  '$$ K = 0 $$ {#eq:kf-gain}',
  '',
].join('\n');

describe('cross-note equation references', () => {
  it('reads eq: labels from a link, and nothing else', () => {
    expect(equationLabel('eq:kf-gain')).toBe('eq:kf-gain');
    expect(equationLabel(' eq:a_b:c ')).toBe('eq:a_b:c');
    expect(equationLabel('Gain and update')).toBeNull();
    expect(equationLabel('eq:')).toBeNull();
    expect(equationLabel(null)).toBeNull();
  });

  it('numbers as the note does, first use of a label only', () => {
    const all = summarize('K/Kalman Filter.md', NOTE, 'all');
    expect(all.title).toBe('Kalman Filter');
    expect(all.equations).toEqual([
      { label: 'eq:kf-predict', tex: 'x = Fx', number: '1', line: 3 },
      { label: 'eq:kf-gain', tex: 'K = PH^T S^{-1}', number: '3', line: 7 },
    ]);
    const labeled = summarize('K/Kalman Filter.md', NOTE, 'labeled');
    expect(labeled.equations.map((e) => e.number)).toEqual(['1', '2']);
  });

  it('reads "Note, Eq. (3)" in each reference format', () => {
    expect(referenceText('Kalman Filter', '3', 'eq')).toBe('Kalman Filter, Eq. (3)');
    expect(referenceText('Kalman Filter', '3', 'paren')).toBe('Kalman Filter, (3)');
    expect(referenceText('Kalman Filter', '3', 'word')).toBe('Kalman Filter, Equation 3');
    expect(referenceText('Kalman Filter', null, 'eq')).toBe('Kalman Filter, Eq. (?)');
  });
});
