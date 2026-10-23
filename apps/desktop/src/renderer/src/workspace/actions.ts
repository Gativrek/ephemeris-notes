/**
 * Workspace actions shared by keys, menus and buttons: opening links and notes, new
 * notes, the daily note, rename and trash with the desk and documents following.
 */
import { splitTarget } from '@vaults/markdown';
import type { OpenLinkRequest } from '../editor/context';
import { useCatalog } from '../lib/catalog';
import { errorMessage, unwrap, vx } from '../lib/vx';
import { useApp } from '../store/app';
import { workspaceStrings as s } from '../strings/workspace';
import { closeDoc, renamed, saveDoc } from './docs';
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
export function report(err: unknown): void {
  notify(errorMessage(err));
}

export function openPath(
  path: string,
  opts?: { background?: boolean; heading?: string | null; block?: string | null; line?: number },
): void {
  if (!OPENABLE.test(path)) {
    void vx().shell.revealInFolder(path);
    return;
  }
  const ws = useWorkspace.getState();
  ws.openItem(path, opts?.background ? { background: true } : undefined);
  if (!opts?.background && (opts?.heading || opts?.block || opts?.line)) {
    useWorkspace.setState({
      jump: {
        path,
        heading: opts.heading ?? null,
        block: opts.block ?? null,
        ...(opts.line ? { line: opts.line } : {}),
      },
    });
  }
}

export function openLink(req: OpenLinkRequest): void {
  if (req.path) {
    openPath(req.path, { background: req.newItem, heading: req.heading, block: req.block });
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

/** Rename or move. Link updates arrive with the index in M3 (SPECS 5). */
export async function renamePath(from: string, to: string): Promise<boolean> {
  if (from === to) return true;
  try {
    await saveDoc(from);
    // TODO(M3): offer "Update N links in M notes" before renaming (SPECS 5).
    const r = await unwrap(vx().fs.rename(from, to, { updateLinks: false }));
    renamed(from, r.path);
    useWorkspace.getState().renamePath(from, r.path);
    void useCatalog.getState().load();
    return true;
  } catch (err) {
    report(err);
    return false;
  }
}

export async function trashPath(path: string): Promise<void> {
  try {
    for (const p of [path]) await closeDoc(p).catch(() => undefined);
    await unwrap(vx().fs.trash(path));
    useWorkspace.getState().removePath(path);
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
