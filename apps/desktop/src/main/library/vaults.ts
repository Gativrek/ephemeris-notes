/**
 * Vaults (SPECS 4.3, 7, 8): discovery from `<Domain>/<Vault>/.vault/vault.json`,
 * creation, edits that preserve unknown keys, Domain moves and deletion to the trash.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CoverInput, Domain, VaultInfo, VaultInput, VaultMoveImpact } from '@shared/bridge';
import { fail } from '@shared/result';
import { decodeText, stripBom } from './encoding';
import type { LibraryFs } from './fileio';
import { DOMAIN_FOLDERS, DOMAINS } from './library';
import { sanitizeFolderName } from './paths';
import { isNote, walkFiles } from './walk';

export const VAULT_DIR = '.vault';
export const VAULT_FILE = 'vault.json';
export const NAME_MAX = 60;
export const COVER_MAX_BYTES = 25 * 1024 * 1024;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2.5;

const DEFAULT_SETTINGS = { attachments: '_attachments', templates: '_templates', daily: 'Daily' };

type RawVault = Record<string, unknown>;

export function domainOf(folder: string): Domain | null {
  for (const d of DOMAINS) if (DOMAIN_FOLDERS[d] === folder) return d;
  return null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Turns a parsed vault.json into VaultInfo, tolerating missing or odd fields. */
export function vaultFromJson(rel: string, raw: RawVault, stats: VaultStats): VaultInfo {
  const [domainFolder, folder] = rel.split('/') as [string, string];
  const cover = raw.cover && typeof raw.cover === 'object' ? (raw.cover as Record<string, unknown>) : null;
  const focus =
    cover?.focus && typeof cover.focus === 'object' ? (cover.focus as Record<string, unknown>) : {};
  const settings =
    raw.settings && typeof raw.settings === 'object' ? (raw.settings as Record<string, unknown>) : {};
  const str = (v: unknown, d: string) => (typeof v === 'string' && v.length > 0 ? v : d);
  const coverFile =
    cover && typeof cover.file === 'string' && /^[^/\\]+$/.test(cover.file) ? cover.file : null;
  return {
    path: rel,
    folder,
    domain: domainOf(domainFolder) ?? 'academic',
    id: str(raw.id, rel),
    name: str(raw.name, folder),
    created: str(raw.created, ''),
    order: num(raw.order, Number.MAX_SAFE_INTEGER),
    cover: coverFile
      ? {
          file: coverFile,
          focus: { x: clamp(num(focus.x, 0.5), 0, 1), y: clamp(num(focus.y, 0.5), 0, 1) },
          zoom: clamp(num(cover?.zoom, 1), ZOOM_MIN, ZOOM_MAX),
        }
      : null,
    settings: {
      attachments: str(settings.attachments, DEFAULT_SETTINGS.attachments),
      templates: str(settings.templates, DEFAULT_SETTINGS.templates),
      daily: str(settings.daily, DEFAULT_SETTINGS.daily),
    },
    sectionOrder: Array.isArray(raw.sectionOrder)
      ? raw.sectionOrder.filter((s): s is string => typeof s === 'string')
      : null,
    coverVersion: 0,
    noteCount: stats.noteCount,
    lastEdited: stats.lastEdited,
    broken: false,
  };
}

export interface VaultStats {
  noteCount: number;
  lastEdited: number | null;
}

export async function vaultStats(rootAbs: string, rel: string): Promise<VaultStats> {
  let noteCount = 0;
  let lastEdited: number | null = null;
  for await (const f of walkFiles(rootAbs, rel)) {
    if (!isNote(f.rel)) continue;
    noteCount++;
    if (lastEdited === null || f.mtimeMs > lastEdited) lastEdited = f.mtimeMs;
  }
  return { noteCount, lastEdited };
}

export function sortVaults(vaults: VaultInfo[]): VaultInfo[] {
  return [...vaults].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

export function validateName(name: unknown): string {
  if (typeof name !== 'string') fail('INVALID_ARGUMENT', 'Name must be text.');
  const trimmed = name.trim();
  if (trimmed.length === 0) fail('INVALID_ARGUMENT', 'Give the Vault a name.');
  if ([...trimmed].length > NAME_MAX) fail('INVALID_ARGUMENT', `Use at most ${NAME_MAX} characters.`);
  return trimmed;
}

const COVER_TYPES: Record<string, (b: Uint8Array) => boolean> = {
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) =>
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50,
};

/** Checks the bytes really are a png, jpg or webp image (the extension is not trusted). */
export function coverExtension(bytes: Uint8Array): 'png' | 'jpg' | 'webp' {
  if (bytes.byteLength > COVER_MAX_BYTES) fail('INVALID_ARGUMENT', 'The image is larger than 25 MB.');
  for (const [ext, test] of Object.entries(COVER_TYPES))
    if (test(bytes)) return ext as 'png' | 'jpg' | 'webp';
  fail('INVALID_ARGUMENT', 'Choose a PNG, JPG or WebP image.');
}

export class VaultStore {
  constructor(
    private readonly lfs: LibraryFs,
    /** Moves a folder; the app passes the rename with link updates (SPECS 5). */
    private readonly renamer: (from: string, to: string) => Promise<{ path: string }> = (f, t) =>
      lfs.rename(f, t),
  ) {}

  private get rootAbs(): string {
    return this.lfs.root.root;
  }

  private async readRaw(rel: string): Promise<{ raw: RawVault | null; broken: boolean }> {
    try {
      const file = await this.lfs.read(`${rel}/${VAULT_DIR}/${VAULT_FILE}`, { allowHidden: true });
      const parsed: unknown = JSON.parse(stripBom(file.text));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { raw: null, broken: true };
      return { raw: parsed as RawVault, broken: false };
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return { raw: null, broken: false };
      return { raw: null, broken: true };
    }
  }

  /** Folders directly inside a Domain folder (not hidden). */
  private async domainFolders(domain: Domain): Promise<string[]> {
    try {
      const entries = await fs.readdir(path.join(this.rootAbs, DOMAIN_FOLDERS[domain]), {
        withFileTypes: true,
      });
      return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async get(rel: string): Promise<VaultInfo | null> {
    const [domainFolder, folder, ...rest] = rel.split('/');
    if (!domainFolder || !folder || rest.length > 0 || !domainOf(domainFolder)) return null;
    const { raw, broken } = await this.readRaw(rel);
    if (!raw && !broken) return null;
    const stats = await vaultStats(this.rootAbs, rel);
    if (broken) return { ...vaultFromJson(rel, {}, stats), broken: true };
    const info = vaultFromJson(rel, raw ?? {}, stats);
    if (info.cover) {
      try {
        const st = await fs.stat(path.join(this.rootAbs, ...rel.split('/'), VAULT_DIR, info.cover.file));
        info.coverVersion = Math.round(st.mtimeMs);
      } catch {
        info.cover = null; // The file named in vault.json is missing: show a placeholder.
      }
    }
    return info;
  }

  async list(): Promise<VaultInfo[]> {
    const out: VaultInfo[] = [];
    for (const d of DOMAINS) {
      const folders = await this.domainFolders(d);
      const infos = await Promise.all(folders.map((f) => this.get(`${DOMAIN_FOLDERS[d]}/${f}`)));
      for (const v of infos) if (v) out.push(v);
    }
    return sortVaults(out);
  }

  /** Folders inside a Domain that are not Vaults (Settings > Library, "Make Vault"). */
  async nonVaultFolders(): Promise<Array<{ path: string; domain: Domain }>> {
    const out: Array<{ path: string; domain: Domain }> = [];
    for (const d of DOMAINS) {
      for (const f of await this.domainFolders(d)) {
        const rel = `${DOMAIN_FOLDERS[d]}/${f}`;
        const { raw, broken } = await this.readRaw(rel);
        if (!raw && !broken) out.push({ path: rel, domain: d });
      }
    }
    return out;
  }

  private async assertUniqueName(domain: Domain, name: string, exceptPath?: string): Promise<void> {
    const key = name.toLocaleLowerCase();
    for (const v of await this.list()) {
      if (v.domain === domain && v.path !== exceptPath && v.name.toLocaleLowerCase() === key) {
        fail('EXISTS', `A Vault named "${v.name}" already exists in this Domain.`);
      }
    }
  }

  /** A free folder name in `domain`: the sanitized name, then " 2", " 3"... */
  private async freeFolder(domain: Domain, base: string): Promise<string> {
    const taken = new Set((await this.domainFolders(domain)).map((f) => f.toLocaleLowerCase()));
    if (!taken.has(base.toLocaleLowerCase())) return base;
    for (let i = 2; ; i++) {
      const candidate = `${base} ${i}`;
      if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
    }
  }

  private async writeRaw(rel: string, raw: RawVault): Promise<void> {
    await this.lfs.writeBytes(
      `${rel}/${VAULT_DIR}/${VAULT_FILE}`,
      Buffer.from(JSON.stringify(raw, null, 2) + '\n', 'utf8'),
      {
        allowHidden: true,
      },
    );
  }

  private async writeCover(
    rel: string,
    cover: CoverInput,
    previous: string | null,
  ): Promise<RawVault['cover']> {
    const focus = { x: clamp(cover.focus.x, 0, 1), y: clamp(cover.focus.y, 0, 1) };
    const zoom = clamp(cover.zoom, ZOOM_MIN, ZOOM_MAX);
    if (!cover.bytes) {
      if (!previous) fail('INVALID_ARGUMENT', 'Choose an image first.');
      return { file: previous, focus, zoom };
    }
    const bytes = new Uint8Array(cover.bytes);
    const ext = coverExtension(bytes);
    const file = `cover.${ext}`;
    // The new image is written first; the old one goes to the trash only afterwards.
    await this.lfs.writeBytes(`${rel}/${VAULT_DIR}/${file}`, bytes, { allowHidden: true });
    if (previous && previous !== file) {
      await this.lfs.trash(`${rel}/${VAULT_DIR}/${previous}`, { allowHidden: true }).catch(() => undefined);
    }
    return { file, focus, zoom };
  }

  async create(input: VaultInput, now: Date = new Date()): Promise<VaultInfo> {
    const name = validateName(input.name);
    const domain = input.domain;
    await this.assertUniqueName(domain, name);
    const folder = await this.freeFolder(domain, sanitizeFolderName(name));
    const rel = `${DOMAIN_FOLDERS[domain]}/${folder}`;
    const existing = await this.list();
    const order =
      Math.max(
        0,
        ...existing
          .filter((v) => v.domain === domain && v.order < Number.MAX_SAFE_INTEGER)
          .map((v) => v.order),
      ) + 1;
    await this.lfs.mkdir(rel);
    await fs.mkdir(path.join(this.rootAbs, ...rel.split('/'), VAULT_DIR), { recursive: true });
    await this.lfs.mkdir(`${rel}/${DEFAULT_SETTINGS.attachments}`);
    const raw: RawVault = { schema: 1, id: randomUUID(), name, created: now.toISOString(), order };
    if (input.cover) raw.cover = await this.writeCover(rel, input.cover, null);
    raw.settings = { ...DEFAULT_SETTINGS };
    await this.writeRaw(rel, raw);
    const info = await this.get(rel);
    if (!info) fail('IO', 'The new Vault could not be read back.');
    return info;
  }

  /** Name and cover edits. Unknown keys in vault.json survive (SPECS 4.3). */
  async update(rel: string, input: Omit<VaultInput, 'domain'>): Promise<VaultInfo> {
    const current = await this.get(rel);
    if (!current) fail('NOT_FOUND', 'This Vault no longer exists.');
    if (current.broken) fail('INVALID_ARGUMENT', 'vault.json is not valid JSON. Fix it by hand first.');
    const { raw } = await this.readRaw(rel);
    const next: RawVault = { ...(raw ?? {}) };
    const name = validateName(input.name);
    if (name !== current.name) await this.assertUniqueName(current.domain, name, rel);
    next.name = name;
    if (input.cover === null) {
      delete next.cover;
    } else if (input.cover) {
      next.cover = await this.writeCover(rel, input.cover, current.cover?.file ?? null);
    }
    await this.writeRaw(rel, next);
    const info = await this.get(rel);
    if (!info) fail('IO', 'The Vault could not be read back.');
    return info;
  }

  /** What moving a Vault to another Domain affects (shown before confirming). */
  async moveImpact(rel: string): Promise<VaultMoveImpact> {
    const stats = await vaultStats(this.rootAbs, rel);
    const prefix = rel.toLocaleLowerCase() + '/';
    const linking: string[] = [];
    for await (const f of walkFiles(this.rootAbs)) {
      if (!isNote(f.rel) || f.rel.toLocaleLowerCase().startsWith(prefix)) continue;
      const text = decodeText(await fs.readFile(f.abs)).text.toLocaleLowerCase();
      if (
        text.includes(`[[${prefix}`) ||
        text.includes(`](${prefix}`) ||
        text.includes(`](${encodeURI(prefix)}`)
      ) {
        linking.push(f.rel);
      }
    }
    return { notes: stats.noteCount, linkingNotes: linking };
  }

  async move(rel: string, to: Domain): Promise<VaultInfo> {
    const current = await this.get(rel);
    if (!current) fail('NOT_FOUND', 'This Vault no longer exists.');
    if (current.domain === to) return current;
    await this.assertUniqueName(to, current.name);
    const folder = await this.freeFolder(to, current.folder);
    const dest = `${DOMAIN_FOLDERS[to]}/${folder}`;
    await this.renamer(rel, dest);
    const info = await this.get(dest);
    if (!info) fail('IO', 'The moved Vault could not be read back.');
    return info;
  }

  /** Moves the Vault folder to the OS trash after the name was typed (SPECS 8). */
  async remove(rel: string, typedName: unknown): Promise<void> {
    const current = await this.get(rel);
    if (!current) fail('NOT_FOUND', 'This Vault no longer exists.');
    if (typeof typedName !== 'string' || typedName.trim() !== current.name) {
      fail('INVALID_ARGUMENT', 'Type the Vault name exactly to delete it.');
    }
    await this.lfs.trash(rel);
  }

  /** Turns an existing Domain folder into a Vault by writing `.vault/vault.json`. */
  async makeVault(rel: string, now: Date = new Date()): Promise<VaultInfo> {
    const [domainFolder, folder, ...rest] = rel.split('/');
    const domain = domainFolder ? domainOf(domainFolder) : null;
    if (!domain || !folder || rest.length)
      fail('INVALID_ARGUMENT', 'Only folders directly inside a Domain can become Vaults.');
    if (await this.get(rel)) fail('EXISTS', 'This folder already is a Vault.');
    const name = [...folder].slice(0, NAME_MAX).join('');
    await this.assertUniqueName(domain, name);
    await fs.mkdir(path.join(this.rootAbs, ...rel.split('/'), VAULT_DIR), { recursive: true });
    const existing = await this.list();
    const order =
      Math.max(
        0,
        ...existing
          .filter((v) => v.domain === domain && v.order < Number.MAX_SAFE_INTEGER)
          .map((v) => v.order),
      ) + 1;
    await this.writeRaw(rel, {
      schema: 1,
      id: randomUUID(),
      name,
      created: now.toISOString(),
      order,
      settings: { ...DEFAULT_SETTINGS },
    });
    const info = await this.get(rel);
    if (!info) fail('IO', 'The Vault could not be read back.');
    return info;
  }
}
