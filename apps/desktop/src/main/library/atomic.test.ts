import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomicCreate, atomicWrite } from './atomic';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vx-atomic-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('atomicWrite', () => {
  it('replaces the file contents', async () => {
    const f = path.join(tmp, 'a.md');
    await fs.writeFile(f, 'old');
    await atomicWrite(f, Buffer.from('new'));
    expect(await fs.readFile(f, 'utf8')).toBe('new');
    expect(await fs.readdir(tmp)).toEqual(['a.md']);
  });

  it('leaves the original intact when the process dies before the rename', async () => {
    const f = path.join(tmp, 'a.md');
    await fs.writeFile(f, 'original');
    let tempSeen = '';
    const crash = new Error('simulated crash');
    await expect(
      atomicWrite(f, Buffer.from('half-written'), {
        beforeRename: async (temp) => {
          tempSeen = temp;
          // The temp file is complete and durable at this point.
          expect(await fs.readFile(temp, 'utf8')).toBe('half-written');
          throw crash;
        },
      }),
    ).rejects.toBe(crash);
    expect(await fs.readFile(f, 'utf8')).toBe('original');
    expect(path.basename(tempSeen)).toMatch(/^\.a\.md\.vx-tmp-[0-9a-f]{12}$/);
  });

  it('keeps the file mode on POSIX', async () => {
    if (process.platform === 'win32') return;
    const f = path.join(tmp, 'm.md');
    await fs.writeFile(f, 'x');
    await fs.chmod(f, 0o600);
    await atomicWrite(f, Buffer.from('y'));
    expect((await fs.stat(f)).mode & 0o777).toBe(0o600);
  });
});

describe('atomicCreate', () => {
  it('never clobbers', async () => {
    const f = path.join(tmp, 'n.md');
    await atomicCreate(f, Buffer.from('first'));
    await expect(atomicCreate(f, Buffer.from('second'))).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await fs.readFile(f, 'utf8')).toBe('first');
    expect(await fs.readdir(tmp)).toEqual(['n.md']);
  });
});
