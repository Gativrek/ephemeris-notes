/**
 * Workspace actions shared by keys, menus and buttons: opening links and notes, new
 * notes, the daily note, rename and trash with the desk and documents following.
 */
import { splitTarget } from '@ephemeris-notes/markdown';
import type { OpenLinkRequest } from '../editor/context';
import { useCatalog } from '../lib/catalog';
import { errorMessage, unwrap, vx } from '../lib/vx';
import { useApp } from '../store/app';
import { workspaceStrings as s } from '../strings/workspace';
import { closeDoc, externalChange, getRecord, renamed, saveAll, useDocs } from './docs';
import { useWorkspace } from './store';

export const OPENABLE = /\.(md|pdf)$/i;

export function currentVault() {
  const app = useApp.getState();
  return app.vaults.find((v) => v.path === app.openVault) ?? null;
}

/** The folder new notes go to: the selected section (or the Vault root for Unfiled). */
export function currentFolder(): string | null {
  const v = currentVault();
  if (!v) return null;
  const sec = useWorkspace.getState().section;
  return sec && (sec === v.path || sec.startsWith(`${v.path}/`)) ? sec : v.path;
}

let notify: (msg: string) => void = (msg) => console.warn(msg);
export function setNotifier(fn: (msg: string) => void): void {
  notify = fn;
}
/** A short message in the status bar. */
export function notice(msg: string): void {
  notify(msg);
}

export function report(err: unknown): void {
  notify(errorMessage(err));
}

export function openPath(
  path: string,
  opts?: {
    background?: boolean;
    heading?: string | null;
    block?: string | null;
    line?: number;
    page?: number | null;
  },
): void {
  if (!OPENABLE.test(path)) {
    void vx().shell.revealInFolder(path);
    return;
  }
  const ws = useWorkspace.getState();
  ws.openItem(path, opts?.background ? { background: true } : undefined);
  if (!opts?.background && (opts?.heading || opts?.block || opts?.line || opts?.page)) {
    useWorkspace.setState({
      jump: {
        path,
        heading: opts.heading ?? null,
        block: opts.block ?? null,
        ...(opts.line ? { line: opts.line } : {}),
        ...(opts.page ? { page: opts.page } : {}),
      },
    });
  }
}

export function openLink(req: OpenLinkRequest): void {
  if (req.path) {
    openPath(req.path, { background: req.newItem, heading: req.heading, block: req.block, page: req.page });
    return;
  }
  // Missing note: offer to create it in the current section (SPECS 5 rule 5).
  const folder = currentFolder();
  if (!folder || !req.target) return;
  useWorkspace.setState({
    overlay: { kind: 'createMissing', target: splitTarget(req.target).target, folder },
  });
}

export async function createNoteIn(
  folder: string,
  title: string,
  template: string | null = null,
): Promise<string | null> {
  const v = currentVault();
  if (!v) return null;
  try {
    const path = await unwrap(vx().notes.create(v.path, folder, title, template));
    await useCatalog.getState().load();
    openPath(path);
    return path;
  } catch (err) {
    report(err);
    return null;
  }
}

/** Ctrl/Cmd+N: a new untitled note in the current section, ready to rename. */
export async function newNote(): Promise<void> {
  const folder = currentFolder();
  if (!folder) return;
  const path = await createNoteIn(folder, s.untitled);
  if (path) useWorkspace.setState({ renaming: path });
}

export async function openDailyNote(): Promise<void> {
  const v = currentVault();
  if (!v) return;
  try {
    const r = await unwrap(vx().notes.daily(v.path));
    await useCatalog.getState().load();
    openPath(r.path);
  } catch (err) {
    report(err);
  }
}

export async function newFolder(parent: string): Promise<void> {
  let name = 'New folder';
  for (let i = 2; useCatalog.getState().paths.some((p) => p.startsWith(`${parent}/${name}/`)); i++)
    name = `New folder ${i}`;
  try {
    const r = await unwrap(vx().fs.mkdir(`${parent}/${name}`));
    useWorkspace.setState({ renaming: r.path });
    useWorkspace.getState().setExpanded(parent, true);
  } catch (err) {
    report(err);
  }
}

/**
 * Rename or move (SPECS 5). When other notes link into `from`, ask first: "Update N
 * links in M notes" (the confirmation calls `performRename`).
 */
export async function renamePath(from: string, to: string): Promise<boolean> {
  if (from === to) return true;
  try {
    await saveAll();
    const impact = await unwrap(vx().index.linkImpact([from])).catch(() => ({ notes: [] }));
    if (impact.notes.length > 0) {
      useWorkspace.setState({ overlay: { kind: 'renameLinks', from, to, notes: impact.notes } });
      return false;
    }
    return await performRename(from, to, false);
  } catch (err) {
    report(err);
    return false;
  }
}

export async function performRename(from: string, to: string, updateLinks: boolean): Promise<boolean> {
  try {
    await saveAll();
    const r = await unwrap(vx().fs.rename(from, to, { updateLinks }));
    renamed(from, r.path);
    useWorkspace.getState().renamePath(from, r.path);
    // Notes rewritten in main: open ones reload in place.
    for (const p of r.updated) if (getRecord(p)) void externalChange(p);
    if (r.failed.length) report(new Error(s.rename.failed(r.failed.length)));
    void useCatalog.getState().load();
    return true;
  } catch (err) {
    report(err);
    return false;
  }
}

export async function trashPath(path: string): Promise<void> {
  try {
    // A folder takes its open notes with it.
    const inside = Object.keys(useDocs.getState().meta).filter((p) => p === path || p.startsWith(`${path}/`));
    for (const p of inside.length ? inside : [path]) await closeDoc(p).catch(() => undefined);
    await unwrap(vx().fs.trash(path));
    useWorkspace.getState().removePath(path);
    useWorkspace.setState((st) => ({ sectionsVersion: st.sectionsVersion + 1 }));
    void useCatalog.getState().load();
  } catch (err) {
    report(err);
  }
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

// ---- Sections (top-level folders of a Vault, SPECS 4.4) ----------------------------

/** Why `name` cannot be a section of the current Vault, or null. */
export function sectionNameProblem(name: string, from: string | null): string | null {
  const v = currentVault();
  if (!name) return s.section.empty;
  if (name.startsWith('.') || name.startsWith('_')) return s.section.hidden;
  if (/[\\/]/.test(name)) return s.section.slash;
  if (v && name.toLowerCase() === v.settings.daily.toLowerCase() && from !== `${v.path}/${v.settings.daily}`)
    return s.section.daily;
  const taken = v
    ? useCatalog
        .getState()
        .paths.filter((p) => p.startsWith(`${v.path}/`))
        .map((p) =>
          p
            .slice(v.path.length + 1)
            .split('/')[0]!
            .toLowerCase(),
        )
    : [];
  const self = from ? baseName(from).toLowerCase() : null;
  if (taken.includes(name.toLowerCase()) && name.toLowerCase() !== self) return s.section.exists;
  return null;
}

/** Creates the folder and selects it. Resolves with an error message, or null. */
export async function createSection(name: string): Promise<string | null> {
  const v = currentVault();
  if (!v) return null;
  // An empty folder is not in the file catalog: ask the disk too.
  if ((await vx().fs.stat(`${v.path}/${name}`)).ok) return s.section.exists;
  const r = await vx().fs.mkdir(`${v.path}/${name}`);
  if (!r.ok) return r.error.code === 'EXISTS' ? s.section.exists : r.error.message;
  await useCatalog.getState().load();
  useWorkspace.setState((st) => ({ sectionsVersion: st.sectionsVersion + 1 }));
  useWorkspace.getState().setSection(r.value.path);
  return null;
}

/** Renames a section; links into it are offered for update like any rename (SPECS 5). */
export async function renameSection(from: string, name: string): Promise<string | null> {
  const to = `${parentOf(from)}/${name}`;
  if (to === from) return null;
  // A case-only rename is the same folder; anything else must not exist yet.
  if (to.toLowerCase() !== from.toLowerCase() && (await vx().fs.stat(to)).ok) return s.section.exists;
  await renamePath(from, to);
  useWorkspace.setState((st) => ({ sectionsVersion: st.sectionsVersion + 1 }));
  return null;
}

/** Asks first, showing how many notes the section holds. */
export function askDeleteSection(path: string): void {
  const notes = useCatalog
    .getState()
    .paths.filter((p) => p.startsWith(`${path}/`) && /\.md$/i.test(p)).length;
  useWorkspace.setState({ overlay: { kind: 'deleteSection', path, notes } });
}
