/**
 * Note-level actions that write files on explicit user request (SPECS 4.5, 4.8 rule 3):
 * attachments with collision-safe names, templates, and daily notes.
 */
import path from 'node:path';
import type { VaultInfo } from '@shared/bridge';
import { fail } from '@shared/result';
import type { LibraryFs } from './fileio';
import { validateNewName } from './paths';

/** `name.png`, then `name 1.png`, `name 2.png`… (SPECS 4.5). */
export async function freeName(lfs: LibraryFs, folder: string, fileName: string): Promise<string> {
  const ext = path.posix.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? fileName : `${stem} ${i}${ext}`;
    const rel = folder ? `${folder}/${candidate}` : candidate;
    if (!(await lfs.exists(rel))) return rel;
  }
}

/** Makes a pasted or dropped file name safe for every OS. */
export function safeFileName(name: string, fallback = 'Attachment'): string {
  let out = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  out = out.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (!out) out = fallback;
  try {
    validateNewName(out);
  } catch {
    out = `${fallback}${path.posix.extname(out)}`;
  }
  return out;
}

export async function addAttachment(
  lfs: LibraryFs,
  vault: VaultInfo,
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  const folder = `${vault.path}/${vault.settings.attachments}`;
  if (!(await lfs.exists(folder))) await lfs.mkdir(folder);
  const rel = await freeName(lfs, folder, safeFileName(fileName));
  await lfs.createBytes(rel, bytes);
  return rel;
}

export interface TemplateVars {
  title: string;
  date: string;
  time: string;
  vault: string;
  domain: string;
}

/** `{{title}}`, `{{date}}`, `{{time}}`, `{{vault}}`, `{{domain}}`. No scripting. */
export function expandTemplate(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{\s*(title|date|time|vault|domain)\s*\}\}/g, (_, k: keyof TemplateVars) => vars[k]);
}

export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function localTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

const DOMAIN_NAMES: Record<string, string> = { academic: 'Academic', work: 'Work', personal: 'Personal' };

export function templateVars(vault: VaultInfo, title: string, now: Date): TemplateVars {
  return {
    title,
    date: localDate(now),
    time: localTime(now),
    vault: vault.name,
    domain: DOMAIN_NAMES[vault.domain] ?? '',
  };
}

export async function listTemplates(lfs: LibraryFs, vault: VaultInfo): Promise<string[]> {
  const folder = `${vault.path}/${vault.settings.templates}`;
  try {
    return (await lfs.list(folder))
      .filter((e) => e.kind === 'file' && e.name.toLowerCase().endsWith('.md'))
      .map((e) => e.path);
  } catch {
    return [];
  }
}

/** Creates `<folder>/<title>.md` (title made unique), from a template if given. */
export async function createNote(
  lfs: LibraryFs,
  vault: VaultInfo,
  folder: string,
  title: string,
  template: string | null,
  now: Date = new Date(),
): Promise<string> {
  const clean = safeFileName(title.replace(/\.md$/i, ''), 'Untitled');
  const rel = await freeName(lfs, folder, `${clean}.md`);
  const finalTitle = path.posix.basename(rel, '.md');
  let text = '';
  if (template) {
    if (!template.startsWith(`${vault.path}/${vault.settings.templates}/`))
      fail('INVALID_ARGUMENT', 'Templates come from the Vault template folder.');
    text = expandTemplate((await lfs.read(template)).text, templateVars(vault, finalTitle, now));
  }
  await lfs.create(rel, text);
  return rel;
}

/**
 * Opens today's daily note: `<Vault>/<daily>/YYYY-MM-DD.md`, created from
 * `_templates/Daily.md` if it exists, otherwise with a `# YYYY-MM-DD` heading.
 */
export async function dailyNote(
  lfs: LibraryFs,
  vault: VaultInfo,
  now: Date = new Date(),
): Promise<{ path: string; created: boolean }> {
  const date = localDate(now);
  const folder = `${vault.path}/${vault.settings.daily}`;
  const rel = `${folder}/${date}.md`;
  if (await lfs.exists(rel)) return { path: rel, created: false };
  if (!(await lfs.exists(folder))) await lfs.mkdir(folder);
  const template = `${vault.path}/${vault.settings.templates}/Daily.md`;
  let text = `# ${date}\n`;
  if (await lfs.exists(template))
    text = expandTemplate((await lfs.read(template)).text, templateVars(vault, date, now));
  await lfs.create(rel, text);
  return { path: rel, created: true };
}
