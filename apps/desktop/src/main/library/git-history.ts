/**
 * The Git timeline (SPECS 4.12): a note's versions from `git log --follow`, and the text
 * of one version from `git show`. Reads only: nothing here changes the repository. `git`
 * runs as in 4.11 (fixed arguments, no shell, no prompts); the library root must be the
 * repository.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { GitHistory, GitHistoryEntry } from '@shared/bridge';
import { decodeText } from './encoding';

export interface GitBytes {
  code: number;
  stdout: Buffer;
  stderr: string;
}
export type GitBytesRunner = (args: string[], cwd: string) => Promise<GitBytes>;

/** `git` with its output as bytes: versions keep their exact encoding until decoded here. */
export function execGitBytes(): GitBytesRunner {
  return (args, cwd) =>
    new Promise((resolve) => {
      execFile(
        'git',
        args,
        {
          cwd,
          windowsHide: true,
          timeout: 60_000,
          maxBuffer: 64 * 1024 * 1024,
          encoding: 'buffer',
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
            stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ''),
            stderr: String(stderr ?? '') || (err && code === -1 ? err.message : ''),
          });
        },
      );
    });
}

export const MAX_VERSIONS = 200;
const COMMIT = /^[0-9a-f]{40}$/;

/**
 * Parses `git log --follow --format=%x1e%H%x1f%at%x1f%an%x1f%s --numstat -z`: one record
 * per commit, its line counts as `added\tremoved\tpath\0`, or for a rename
 * `added\tremoved\t\0old\0new\0`. Each version gets the note's path at that commit.
 */
export function parseHistory(out: string, currentPath: string): GitHistoryEntry[] {
  const entries: GitHistoryEntry[] = [];
  let tracked = currentPath;
  for (const rec of out.split('\x1e').slice(1)) {
    const headEnd = rec.indexOf('\0');
    const head = (headEnd === -1 ? rec : rec.slice(0, headEnd)).split('\x1f');
    const [commit, at, author, subject] = head;
    if (!commit || !COMMIT.test(commit)) continue;
    let rest = headEnd === -1 ? '' : rec.slice(headEnd + 1).replace(/^\n/, '');
    let added = 0;
    let removed = 0;
    let pathThen = tracked;
    const stat = /^(\d+|-)\t(\d+|-)\t/.exec(rest);
    if (stat) {
      added = stat[1] === '-' ? 0 : Number(stat[1]);
      removed = stat[2] === '-' ? 0 : Number(stat[2]);
      rest = rest.slice(stat[0].length);
      if (rest.startsWith('\0')) {
        // A rename: the old path, then the new one. Older versions are at the old path.
        const [, from = '', to = ''] = rest.split('\0');
        pathThen = to || tracked;
        tracked = from || tracked;
      } else pathThen = tracked = rest.split('\0')[0] || tracked;
    }
    entries.push({
      commit,
      at: Number(at) * 1000,
      author: author ?? '',
      subject: subject ?? '',
      path: pathThen,
      added,
      removed,
    });
  }
  return entries;
}

const exists = (p: string) =>
  fs.stat(p).then(
    () => true,
    () => false,
  );

/** The versions of a note, newest first, and whether it has changes not committed yet. */
export async function noteHistory(run: GitBytesRunner, root: string, rel: string): Promise<GitHistory> {
  if (!(await exists(path.join(root, '.git')))) return { available: false, reason: 'notRepository' };
  const log = await run(
    [
      '-c',
      'core.quotePath=false',
      'log',
      '--follow',
      '--no-merges',
      `--max-count=${MAX_VERSIONS}`,
      '--format=%x1e%H%x1f%at%x1f%an%x1f%s',
      '--numstat',
      '-z',
      '--',
      rel,
    ],
    root,
  );
  if (log.code === -1) return { available: false, reason: 'noGit' };
  // A repository without commits yet: no versions, not an error.
  const entries = log.code === 0 ? parseHistory(log.stdout.toString('utf8'), rel) : [];
  const status = await run(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', rel], root);
  return { available: true, entries, uncommitted: status.code === 0 && status.stdout.length > 0 };
}

/** One version's text, as committed (decoded as notes are: LF text, its line ends noted). */
export async function noteVersion(
  run: GitBytesRunner,
  root: string,
  commit: string,
  relAtCommit: string,
): Promise<{ text: string } | null> {
  if (!COMMIT.test(commit)) return null;
  const show = await run(['show', `${commit}:${relAtCommit}`], root);
  if (show.code !== 0) return null;
  return { text: decodeText(new Uint8Array(show.stdout)).text };
}
