/**
 * The performance fixture of SPECS 16: about 5,000 notes (roughly 60 MB of Markdown)
 * and 500 attachments across the three Domains, plus one 5,000-line note. Generated
 * into a temporary folder by e2e/perf.spec.ts; never committed.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DOMAINS = ['Academic', 'Work', 'Personal'] as const;
const VAULTS_PER_DOMAIN = 4;
const SECTIONS = ['Notes', 'Lectures', 'Projects', 'Reading', 'Meetings'];
export const PERF_NOTES = 5000;
const ATTACHMENTS = 500;

// A 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const WORDS = (
  'kalman filter estimate covariance innovation gain measurement update predict state noise ' +
  'satellite orbit pseudorange carrier phase ambiguity receiver clock bias ionosphere ' +
  'controller plant transfer function bode margin stability observer feedback loop ' +
  'navegação estimação ruído medição órbita receptor'
).split(' ');

/** Deterministic pseudo-random numbers, so every run measures the same library. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function paragraph(r: () => number, words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(WORDS[Math.floor(r() * WORDS.length)]!);
  out[0] = out[0]![0]!.toUpperCase() + out[0]!.slice(1);
  return `${out.join(' ')}.`;
}

function note(i: number, r: () => number, total: number): string {
  const lines: string[] = [
    '---',
    `tags: [perf, topic${i % 50}]`,
    `created: 2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    '---',
    '',
    `# Note ${i}`,
    '',
  ];
  // About 12 KB per note: sections with paragraphs, links, math and code.
  for (let h = 1; h <= 6; h++) {
    lines.push(`## Part ${h}`, '');
    for (let p = 0; p < 3; p++) lines.push(paragraph(r, 90), '');
    lines.push(`See [[Note ${Math.floor(r() * total)}]] and [[Note ${Math.floor(r() * total)}#Part 2]].`, '');
    if (h % 2 === 0) lines.push('$$', `x_{k+1} = A x_k + B u_k + w_{${h}}`, `$$ {#eq:n${i}p${h}}`, '');
    if (h === 3) lines.push('```python', 'def step(x, u):', '    return A @ x + B @ u', '```', '');
  }
  if (i % 10 === 0) lines.push(`![[img ${i % ATTACHMENTS}.png]]`, '');
  return lines.join('\n');
}

export interface PerfLibrary {
  root: string;
  /** Library-relative path of the 5,000-line note. */
  longNote: string;
  /** The Vault holding it. */
  vaultName: string;
}

export async function makePerfLibrary(root: string): Promise<PerfLibrary> {
  const put = async (rel: string, data: string | Buffer) => {
    const file = join(root, ...rel.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
  };
  const created = new Date().toISOString();
  await put('.ephemeris/library.json', JSON.stringify({ schema: 1, id: randomUUID(), created }));
  await mkdir(join(root, 'Inbox'), { recursive: true });
  const vaults: string[] = [];
  for (const d of DOMAINS)
    for (let v = 0; v < VAULTS_PER_DOMAIN; v++) {
      const path = `${d}/${d} Vault ${v + 1}`;
      vaults.push(path);
      await put(
        `${path}/.vault/vault.json`,
        JSON.stringify({ schema: 1, id: randomUUID(), name: `${d} Vault ${v + 1}`, created, order: v }),
      );
    }
  const r = rng(42);
  const jobs: Array<Promise<void>> = [];
  for (let i = 0; i < PERF_NOTES; i++) {
    const vault = vaults[i % vaults.length]!;
    const section = SECTIONS[Math.floor(i / vaults.length) % SECTIONS.length]!;
    jobs.push(put(`${vault}/${section}/Note ${i}.md`, note(i, r, PERF_NOTES)));
    if (jobs.length >= 200) await Promise.all(jobs.splice(0));
  }
  for (let a = 0; a < ATTACHMENTS; a++)
    jobs.push(put(`${vaults[a % vaults.length]}/_attachments/img ${a}.png`, PNG));
  await Promise.all(jobs);
  const long: string[] = ['# Long note', ''];
  for (let l = 0; long.length < 5000; l++) {
    if (l % 40 === 0) long.push(`## Block ${l / 40}`);
    else long.push(paragraph(r, 12));
  }
  const longNote = `${vaults[0]}/Notes/Long note.md`;
  await put(longNote, long.join('\n') + '\n');
  return { root, longNote, vaultName: 'Academic Vault 1' };
}
