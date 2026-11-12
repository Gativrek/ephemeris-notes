import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execGitBytes, noteHistory, noteVersion, parseHistory } from './git-history';

let hasGit = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true });
} catch {
  hasGit = false;
}

const H = (c: string) => c.repeat(40);

describe('parseHistory', () => {
  it('reads commits, line counts and renames, giving each version its path then', () => {
    const out = [
      `\x1e${H('a')}\x1f1794525551\x1fTester\x1ffourth\0\n1\t1\tA/Renamed.md\0`,
      `\x1e${H('b')}\x1f1794525550\x1fTester\x1frename\0\n0\t0\t\0A/Note é.md\0A/Renamed.md\0`,
      `\x1e${H('c')}\x1f1794525549\x1fTester\x1fsecond: add three\0\n1\t0\tA/Note é.md\0`,
      `\x1e${H('d')}\x1f1794525548\x1fTester\x1fmode only\0\n`,
      `\x1e${H('e')}\x1f1794525547\x1fTester\x1ffirst\0\n2\t0\tA/Note é.md\0`,
    ].join('');
    expect(parseHistory(out, 'A/Renamed.md')).toEqual([
      {
        commit: H('a'),
        at: 1794525551000,
        author: 'Tester',
        subject: 'fourth',
        path: 'A/Renamed.md',
        added: 1,
        removed: 1,
      },
      {
        commit: H('b'),
        at: 1794525550000,
        author: 'Tester',
        subject: 'rename',
        path: 'A/Renamed.md',
        added: 0,
        removed: 0,
      },
      {
        commit: H('c'),
        at: 1794525549000,
        author: 'Tester',
        subject: 'second: add three',
        path: 'A/Note é.md',
        added: 1,
        removed: 0,
      },
      {
        commit: H('d'),
        at: 1794525548000,
        author: 'Tester',
        subject: 'mode only',
        path: 'A/Note é.md',
        added: 0,
        removed: 0,
      },
      {
        commit: H('e'),
        at: 1794525547000,
        author: 'Tester',
        subject: 'first',
        path: 'A/Note é.md',
        added: 2,
        removed: 0,
      },
    ]);
  });
  it('counts binary changes as none and skips malformed records', () => {
    expect(parseHistory(`\x1enot-a-hash\x1f1\x1fx\x1fy\0\n`, 'a.md')).toEqual([]);
    expect(parseHistory(`\x1e${H('f')}\x1f1\x1fx\x1fy\0\n-\t-\ta.md\0`, 'a.md')[0]).toMatchObject({
      added: 0,
      removed: 0,
    });
  });
});

describe.skipIf(!hasGit)('note history in a repository', () => {
  let dir: string;
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true }).trim();
  const run = execGitBytes();
  const put = (rel: string, text: string) => writeFile(path.join(dir, ...rel.split('/')), text);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'vx-git-history-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('says when the library is not a repository', async () => {
    expect(await noteHistory(run, dir, 'a.md')).toEqual({ available: false, reason: 'notRepository' });
  });

  it('lists versions across a rename, reads each one, and notices uncommitted changes', async () => {
    git('init', '--quiet');
    // Repository-local settings only; nothing global is touched.
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.autocrlf', 'false');
    await mkdir(path.join(dir, 'Notes'));
    await put('Notes/Kalman é.md', 'one\r\ntwo\r\n');
    git('add', '--all');
    git('commit', '--quiet', '-m', 'first');
    await put('Notes/Kalman é.md', 'one\r\ntwo\r\nthree\r\n');
    git('commit', '--quiet', '-am', 'second');
    git('mv', 'Notes/Kalman é.md', 'Notes/Kalman Filter.md');
    git('commit', '--quiet', '-m', 'rename');
    await put('Notes/Kalman Filter.md', 'one\r\nTWO\r\nthree\r\n');
    git('commit', '--quiet', '-am', 'fourth');

    let h = await noteHistory(run, dir, 'Notes/Kalman Filter.md');
    expect(h.available && h.uncommitted).toBe(false);
    if (!h.available) throw new Error('no history');
    expect(h.entries.map((e) => [e.subject, e.path, e.added, e.removed])).toEqual([
      ['fourth', 'Notes/Kalman Filter.md', 1, 1],
      ['rename', 'Notes/Kalman Filter.md', 0, 0],
      ['second', 'Notes/Kalman é.md', 1, 0],
      ['first', 'Notes/Kalman é.md', 2, 0],
    ]);
    // Each version's own text, from its own path; CRLF decoded as notes are.
    const first = h.entries[3]!;
    expect(await noteVersion(run, dir, first.commit, first.path)).toEqual({ text: 'one\ntwo\n' });
    expect(await noteVersion(run, dir, h.entries[0]!.commit, h.entries[0]!.path)).toEqual({
      text: 'one\nTWO\nthree\n',
    });
    expect(await noteVersion(run, dir, first.commit, 'Notes/Kalman Filter.md')).toBeNull();
    expect(await noteVersion(run, dir, 'HEAD', first.path)).toBeNull();

    await put('Notes/Kalman Filter.md', 'changed, not committed\n');
    h = await noteHistory(run, dir, 'Notes/Kalman Filter.md');
    expect(h.available && h.uncommitted).toBe(true);
    // Reading changed nothing in git.
    expect(git('log', '--format=%s')).toBe('fourth\nrename\nsecond\nfirst');
    expect(git('status', '--porcelain')).toBe('M "Notes/Kalman Filter.md"');
  });

  it('gives an untracked note no versions, only uncommitted changes', async () => {
    await put('Notes/New.md', 'new\n');
    const h = await noteHistory(run, dir, 'Notes/New.md');
    expect(h).toEqual({ available: true, entries: [], uncommitted: true });
  });
});
