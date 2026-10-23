/**
 * Optional git auto-commit (SPECS 4.11): when the library root is a git repository and
 * the setting is on, commit every change on an interval. Main process only, `git` from
 * PATH with fixed arguments and no shell. Never pushes, never runs while git is busy.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
}
export type GitRunner = (args: string[], cwd: string) => Promise<GitRun>;

export type GitResult = 'committed' | 'clean' | 'skipped' | 'failed' | 'unavailable';

export interface GitStatus {
  /** The library root holds a `.git` folder. */
  repo: boolean;
  enabled: boolean;
  intervalMinutes: number;
  last: { at: number; result: GitResult; message: string } | null;
}

export const GIT_ENABLED_KEY = 'git.autoCommit';
export const GIT_INTERVAL_KEY = 'git.intervalMinutes';

export function execGit(): GitRunner {
  return (args, cwd) =>
    new Promise((resolve) => {
      execFile(
        'git',
        args,
        {
          cwd,
          windowsHide: true,
          timeout: 120_000,
          maxBuffer: 16 * 1024 * 1024,
          // Never wait for credentials or an editor.
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' },
        },
        (err, stdout, stderr) => {
          const code = err
            ? typeof (err as { code?: unknown }).code === 'number'
              ? (err as { code: number }).code
              : -1
            : 0;
          resolve({
            code,
            stdout: String(stdout),
            stderr: String(stderr || (err && code === -1 ? err.message : '')),
          });
        },
      );
    });
}

const exists = (p: string) =>
  fs.stat(p).then(
    () => true,
    () => false,
  );

/** Markers of an operation in progress: committing then would interfere. */
const BUSY = ['index.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'];

export class GitAutoCommit {
  private root: string | null = null;
  private last: GitStatus['last'] = null;
  private lastRun = 0;
  private running: Promise<GitResult> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly run: GitRunner,
    private readonly settings: () => { enabled: boolean; intervalMinutes: number },
    private readonly appName = '{AppName}',
  ) {}

  setRoot(root: string | null): void {
    this.root = root;
    this.last = null;
    this.lastRun = Date.now();
  }

  /** Checks every 30 s whether the interval has passed. */
  start(checkMs = 30_000): void {
    this.stop();
    this.timer = setInterval(() => {
      const { enabled, intervalMinutes } = this.settings();
      if (enabled && this.root && Date.now() - this.lastRun >= intervalMinutes * 60_000)
        void this.commitNow();
    }, checkMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async status(): Promise<GitStatus> {
    const s = this.settings();
    return {
      repo: this.root ? await exists(path.join(this.root, '.git')) : false,
      enabled: s.enabled,
      intervalMinutes: s.intervalMinutes,
      last: this.last,
    };
  }

  /** One commit attempt now. Concurrent calls share the attempt in flight. */
  commitNow(now: () => Date = () => new Date()): Promise<GitResult> {
    this.running ??= this.attempt(now).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async attempt(now: () => Date): Promise<GitResult> {
    this.lastRun = Date.now();
    const root = this.root;
    const done = (result: GitResult, message: string) => {
      this.last = { at: Date.now(), result, message };
      return result;
    };
    if (!root) return done('unavailable', 'No library is open.');
    const dotGit = path.join(root, '.git');
    if (!(await exists(dotGit))) return done('unavailable', 'The library folder is not a git repository.');
    for (const marker of BUSY)
      if (await exists(path.join(dotGit, marker))) return done('skipped', `git is busy (${marker}).`);
    const status = await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], root);
    if (status.code !== 0) return done('failed', firstLine(status.stderr) || 'git status failed.');
    if (status.stdout.length === 0) return done('clean', 'Nothing to commit.');
    const add = await this.run(['add', '--all', '--', '.'], root);
    if (add.code !== 0) return done('failed', firstLine(add.stderr) || 'git add failed.');
    const stamp = now()
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
    const commit = await this.run(['commit', '--quiet', '-m', `${this.appName}: auto-commit ${stamp}`], root);
    if (commit.code !== 0)
      return done('failed', firstLine(commit.stderr || commit.stdout) || 'git commit failed.');
    const files = status.stdout.split('\0').filter(Boolean).length;
    return done('committed', `Committed ${files} ${files === 1 ? 'change' : 'changes'}.`);
  }
}

function firstLine(s: string): string {
  return (
    s
      .split(/\r?\n/)
      .find((l) => l.trim())
      ?.trim() ?? ''
  );
}
