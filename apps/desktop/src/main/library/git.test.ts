import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execGit, GitAutoCommit } from './git';

let hasGit = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true });
} catch {
  hasGit = false;
}

describe.skipIf(!hasGit)('git auto-commit', () => {
  let dir: string;
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true }).trim();

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'vx-git-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const make = () => {
    const g = new GitAutoCommit(execGit(), () => ({ enabled: true, intervalMinutes: 10 }), 'Vaults');
    g.setRoot(dir);
    return g;
  };

  it('reports a folder that is not a repository', async () => {
    const g = make();
    expect(await g.commitNow()).toBe('unavailable');
    expect((await g.status()).repo).toBe(false);
  });

  it('commits changes, then finds nothing to commit', async () => {
    git('init', '--quiet');
    // Repository-local identity only; nothing global is touched.
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    await writeFile(path.join(dir, 'Note.md'), '# Note\n');
    const g = make();
    expect(await g.commitNow(() => new Date('2026-10-23T03:00:00Z'))).toBe('committed');
    expect(git('log', '--format=%s')).toBe('Vaults: auto-commit 2026-10-23T03:00:00Z');
    expect((await g.status()).last?.message).toBe('Committed 1 change.');
    expect(await g.commitNow()).toBe('clean');
    await writeFile(path.join(dir, 'Note.md'), '# Note\n\nMore.\n');
    expect(await g.commitNow()).toBe('committed');
    expect(git('rev-list', '--count', 'HEAD')).toBe('2');
  });

  it('skips while git is busy', async () => {
    git('init', '--quiet');
    await writeFile(path.join(dir, '.git', 'index.lock'), '');
    await writeFile(path.join(dir, 'Note.md'), '# Note\n');
    expect(await make().commitNow()).toBe('skipped');
  });
});
