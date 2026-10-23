/**
 * Data-integrity suite (SPECS 17, MUST): round-trip and no unrequested writes over the
 * committed fixture library.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeText, encodeText, sha256 } from '../src/main/library/encoding';
import { LibraryFs } from '../src/main/library/fileio';
import { readLibrary } from '../src/main/library/library';
import { LibraryRoot } from '../src/main/library/paths';
import { walkFiles } from '../src/main/library/walk';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/library');

async function snapshot(root: string): Promise<Map<string, { hash: string; mtimeMs: number; size: number }>> {
  const out = new Map<string, { hash: string; mtimeMs: number; size: number }>();
  const visit = async (dir: string): Promise<void> => {
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) await visit(abs);
      else {
        const st = await fs.stat(abs);
        out.set(path.relative(root, abs), {
          hash: sha256(await fs.readFile(abs)),
          mtimeMs: st.mtimeMs,
          size: st.size,
        });
      }
    }
  };
  await visit(root);
  return out;
}

describe('fixture library', () => {
  it('covers the SPECS 17 cases', async () => {
    const files: string[] = [];
    for await (const f of walkFiles(fixture)) files.push(f.rel);
    expect(files.some((f) => f.startsWith('Inbox/'))).toBe(true);
    expect(files.some((f) => f.endsWith('.pdf'))).toBe(true);
    expect(files.some((f) => f.endsWith('.csv'))).toBe(true);
    expect(files.some((f) => f.endsWith('.png'))).toBe(true);
    expect(files.filter((f) => f.endsWith('/Index.md')).length).toBeGreaterThan(1);
    expect(files).toContain('Academic/Old Course/notes.md');
    for (const d of ['Academic', 'Work', 'Personal'])
      expect(await fs.stat(path.join(fixture, d))).toBeTruthy();
  });
});

describe('round-trip: open and save with no edits gives identical bytes', () => {
  it('holds for every fixture note that does not mix line endings', async () => {
    let checked = 0;
    for await (const f of walkFiles(fixture)) {
      if (!f.rel.endsWith('.md')) continue;
      const bytes = await fs.readFile(f.abs);
      const d = decodeText(bytes);
      if (d.readOnly) continue; // Never saved (SPECS 4.8 rule 5).
      if (d.mixedEol) continue; // Saved in the dominant style (SPECS 4.8 rule 4), covered below.
      expect(encodeText(d.text, d.eol, d.bom).equals(bytes), f.rel).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('flags the mixed file, and the Latin-1 file is read-only', async () => {
    const mixed = decodeText(
      await fs.readFile(path.join(fixture, 'Academic/GNSS Study/Encoding/Mixed EOL.md')),
    );
    expect(mixed.mixedEol).toBe(true);
    const latin = decodeText(await fs.readFile(path.join(fixture, 'Academic/GNSS Study/Encoding/Latin1.md')));
    expect(latin.readOnly).toBe(true);
  });
});

describe('no unrequested writes', () => {
  let copy: string;
  beforeAll(async () => {
    copy = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'vx-integrity-')), 'library');
    await fs.cp(fixture, copy, { recursive: true, preserveTimestamps: true });
  });
  afterAll(async () => {
    await fs.rm(path.dirname(copy), { recursive: true, force: true });
  });

  it('opening, listing, reading and saving unedited notes changes nothing', async () => {
    const before = await snapshot(copy);
    expect(await readLibrary(copy)).not.toBeNull();
    const lfs = new LibraryFs(await LibraryRoot.create(copy), {
      trash: () => Promise.reject(new Error('no trash in this test')),
    });
    const visit = async (dir: string): Promise<void> => {
      for (const e of await lfs.list(dir)) {
        if (e.kind === 'folder') await visit(e.path);
        else if (e.path.endsWith('.md')) {
          const t = await lfs.read(e.path);
          // An autosave of an unedited buffer must be a no-op.
          if (!t.readOnly) await lfs.write(e.path, t.text, t.hash);
        } else {
          await lfs.readBinary(e.path);
        }
      }
    };
    await visit('');
    const after = await snapshot(copy);
    for (const [rel, b] of before) {
      expect(after.get(rel), rel).toEqual(b);
    }
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  });
});
