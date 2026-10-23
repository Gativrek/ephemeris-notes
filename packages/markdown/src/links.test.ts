import { describe, expect, it } from 'vitest';
import { LinkCatalog, hasExtension, vaultRootOf } from './links';

const PATHS = [
  'Academic/Knowledge/Concepts/Kalman Filter.md',
  'Academic/Knowledge/Concepts/Index.md',
  'Academic/GNSS Study/Notes/Intro.md',
  'Academic/GNSS Study/Notes/Index.md',
  'Academic/GNSS Study/Papers/paper.pdf',
  'Academic/GNSS Study/_attachments/diagram.png',
  'Work/Acme Robotics/Specs/Index.md',
  'Work/Acme Robotics/Specs/Navigation.md',
  'Archive/Old Obsidian note.md',
  'Archive/v1.2 notes.md',
  'Personal/Case/readme.md',
  'Personal/Case/README.md',
];
const cat = new LinkCatalog(PATHS, new Map([['Academic/Knowledge/Concepts/Kalman Filter.md', ['KF']]]));

describe('resolve', () => {
  it('matches unique file names library-wide, case-insensitively', () => {
    expect(cat.resolve('Kalman Filter', 'Work/Acme Robotics/Specs/Navigation.md')).toEqual({
      path: 'Academic/Knowledge/Concepts/Kalman Filter.md',
      candidates: [],
    });
    expect(cat.resolve('kalman filter', 'x.md').path).toBe('Academic/Knowledge/Concepts/Kalman Filter.md');
    expect(cat.resolve('paper.pdf', 'x.md').path).toBe('Academic/GNSS Study/Papers/paper.pdf');
  });

  it('prefers the same Vault, then the same Domain, for ambiguous names', () => {
    const fromGnss = cat.resolve('Index', 'Academic/GNSS Study/Notes/Intro.md');
    expect(fromGnss.path).toBe('Academic/GNSS Study/Notes/Index.md');
    expect(fromGnss.candidates).toHaveLength(3);
    expect(cat.resolve('Index', 'Work/Acme Robotics/Specs/Navigation.md').path).toBe(
      'Work/Acme Robotics/Specs/Index.md',
    );
    // Same Domain, then the shorter path.
    expect(cat.resolve('Index', 'Academic/Other/x.md').path).toBe('Academic/GNSS Study/Notes/Index.md');
    // No Vault or Domain preference: the shortest path, then alphabetical.
    expect(cat.resolve('Index', 'Archive/Old Obsidian note.md').path).toBe(
      'Work/Acme Robotics/Specs/Index.md',
    );
  });

  it('prefers an exact-case match among names differing only in case', () => {
    expect(cat.resolve('README', 'x.md')).toEqual({ path: 'Personal/Case/README.md', candidates: [] });
    expect(cat.resolve('readme', 'x.md').path).toBe('Personal/Case/readme.md');
  });

  it('matches paths from the root, from the Vault root, then as suffixes', () => {
    expect(cat.resolve('Academic/Knowledge/Concepts/Kalman Filter', 'Work/x.md').path).toBe(
      'Academic/Knowledge/Concepts/Kalman Filter.md',
    );
    expect(cat.resolve('Notes/Index', 'Academic/GNSS Study/Notes/Intro.md').path).toBe(
      'Academic/GNSS Study/Notes/Index.md',
    );
    expect(cat.resolve('Specs/Index', 'Academic/x.md').path).toBe('Work/Acme Robotics/Specs/Index.md');
    expect(cat.resolve('../Notes/Intro', 'Academic/GNSS Study/Papers/x.md').path).toBe(
      'Academic/GNSS Study/Notes/Intro.md',
    );
  });

  it('uses frontmatter aliases as alternative names', () => {
    expect(cat.resolve('KF', 'x.md').path).toBe('Academic/Knowledge/Concepts/Kalman Filter.md');
  });

  it('treats names with dots but no real extension as notes', () => {
    expect(cat.resolve('v1.2 notes', 'x.md').path).toBe('Archive/v1.2 notes.md');
    expect(hasExtension('v1.2 notes')).toBe(false);
    expect(hasExtension('paper.pdf')).toBe(true);
  });

  it('reports missing targets', () => {
    expect(cat.resolve('Missing Note', 'x.md')).toEqual({ path: null, candidates: [] });
    expect(cat.resolve('Nope/Index', 'x.md').path).toBeNull();
    expect(cat.resolve('', 'x.md').path).toBeNull();
  });
});

describe('shortestLink', () => {
  it('writes the file name when unique, else the shortest unique suffix', () => {
    expect(cat.shortestLink('Academic/Knowledge/Concepts/Kalman Filter.md')).toBe('Kalman Filter');
    expect(cat.shortestLink('Academic/GNSS Study/Notes/Index.md')).toBe('Notes/Index');
    expect(cat.shortestLink('Work/Acme Robotics/Specs/Index.md')).toBe('Specs/Index');
    expect(cat.shortestLink('Academic/Knowledge/Concepts/Index.md')).toBe('Concepts/Index');
    expect(cat.shortestLink('Academic/GNSS Study/Papers/paper.pdf')).toBe('paper.pdf');
  });

  it('round-trips: every written link resolves back to its target', () => {
    for (const p of PATHS) {
      const link = cat.shortestLink(p);
      expect(cat.resolve(link, 'Archive/elsewhere.md').path, link).toBe(p);
    }
  });

  it('lists ambiguous names', () => {
    expect(cat.ambiguousNames().map((a) => a.name)).toEqual(['Index.md', 'readme.md']);
  });
});

describe('vaultRootOf', () => {
  it('finds Domain/Vault for Vault content only', () => {
    expect(vaultRootOf('Academic/GNSS Study/Notes/Intro.md')).toBe('Academic/GNSS Study');
    expect(vaultRootOf('Archive/x.md')).toBeNull();
    expect(vaultRootOf('Academic/x.md')).toBeNull();
  });
});
