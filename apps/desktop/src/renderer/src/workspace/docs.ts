/**
 * Open documents: one CodeMirror state per open note (so undo history and cursor
 * survive desk switches), autosave 800 ms after the last edit and on blur, switch and
 * close (SPECS 4.8 rule 8), and the external-change rules of SPECS 4.9.
 */
import { EditorState, Transaction } from '@codemirror/state';
import { create } from 'zustand';
import type { TextFile } from '@shared/bridge';
import { BridgeError, errorMessage, unwrap, vx } from '../lib/vx';

export const AUTOSAVE_MS = 800;

export type Conflict = 'changed' | 'deleted' | null;

export interface DocMeta {
  path: string;
  dirty: boolean;
  saving: boolean;
  conflict: Conflict;
  readOnly: boolean;
  mixedEol: boolean;
  /** Shown once after opening a mixed-ending file (decision 25). */
  noticeMixed: boolean;
  error: string | null;
  lastSaved: number | null;
}

interface DocRecord {
  path: string;
  state: EditorState;
  /** Hash of the bytes on disk this document is based on. */
  hash: string;
  timer: ReturnType<typeof setTimeout> | null;
  saving: Promise<void> | null;
  /** Bumped on every edit, to know whether a save covered the latest text. */
  revision: number;
}

interface DocsStore {
  meta: Record<string, DocMeta>;
  patch(path: string, p: Partial<DocMeta>): void;
  drop(path: string): void;
}

export const useDocs = create<DocsStore>((set) => ({
  meta: {},
  patch(path, p) {
    set((s) => {
      const cur = s.meta[path];
      if (!cur) return s;
      return { meta: { ...s.meta, [path]: { ...cur, ...p } } };
    });
  },
  drop(path) {
    set((s) => {
      const { [path]: _gone, ...rest } = s.meta;
      return { meta: rest };
    });
  },
}));

const records = new Map<string, DocRecord>();
type StateFactory = (path: string, text: string, readOnly: boolean) => EditorState;
let factory: StateFactory | null = null;
/** The editor view reports the state it shows here, so saves see the latest text. */
let liveView: { path: string; getState(): EditorState; setState(s: EditorState): void } | null = null;

export function setStateFactory(f: StateFactory): void {
  factory = f;
}

export function attachView(v: typeof liveView): void {
  liveView = v;
}

function currentState(rec: DocRecord): EditorState {
  return liveView && liveView.path === rec.path ? liveView.getState() : rec.state;
}

function setRecordState(rec: DocRecord, state: EditorState): void {
  rec.state = state;
  if (liveView && liveView.path === rec.path) liveView.setState(state);
}

export function getRecord(path: string): DocRecord | undefined {
  return records.get(path);
}

export function isOpen(path: string): boolean {
  return records.has(path);
}

/** Loads a note (once) and returns its editor state. */
export async function openDoc(path: string): Promise<EditorState> {
  const existing = records.get(path);
  if (existing) return currentState(existing);
  if (!factory) throw new Error('Editor not ready');
  const file: TextFile = await unwrap(vx().fs.read(path));
  const again = records.get(path);
  if (again) return currentState(again);
  const state = factory(path, file.text, file.readOnly);
  records.set(path, { path, state, hash: file.hash, timer: null, saving: null, revision: 0 });
  useDocs.setState((s) => ({
    meta: {
      ...s.meta,
      [path]: {
        path,
        dirty: false,
        saving: false,
        conflict: null,
        readOnly: file.readOnly,
        mixedEol: file.mixedEol,
        noticeMixed: file.mixedEol && !file.readOnly,
        error: null,
        lastSaved: null,
      },
    },
  }));
  return state;
}

/** Called by the editor for every edit of the shown document. */
export function noteEdited(path: string, state: EditorState): void {
  const rec = records.get(path);
  if (!rec) return;
  rec.state = state;
  rec.revision++;
  useDocs.getState().patch(path, { dirty: true, error: null });
  if (rec.timer) clearTimeout(rec.timer);
  rec.timer = setTimeout(() => void saveDoc(path), AUTOSAVE_MS);
}

/** Keeps the stored state current without marking it dirty (cursor moves). */
export function rememberState(path: string, state: EditorState): void {
  const rec = records.get(path);
  if (rec) rec.state = state;
}

export async function saveDoc(path: string): Promise<void> {
  const rec = records.get(path);
  if (!rec) return;
  if (rec.timer) {
    clearTimeout(rec.timer);
    rec.timer = null;
  }
  if (rec.saving) await rec.saving;
  const meta = useDocs.getState().meta[path];
  if (!meta || !meta.dirty || meta.readOnly || meta.conflict) return;
  const revision = rec.revision;
  const text = currentState(rec).doc.toString();
  useDocs.getState().patch(path, { saving: true });
  rec.saving = (async () => {
    try {
      const r = await unwrap(vx().fs.write(path, text, rec.hash));
      rec.hash = r.hash;
      useDocs
        .getState()
        .patch(path, { saving: false, dirty: rec.revision !== revision, lastSaved: Date.now(), error: null });
    } catch (err) {
      const code = err instanceof BridgeError ? err.code : null;
      if (code === 'CONFLICT') useDocs.getState().patch(path, { saving: false, conflict: 'changed' });
      else if (code === 'NOT_FOUND') useDocs.getState().patch(path, { saving: false, conflict: 'deleted' });
      else useDocs.getState().patch(path, { saving: false, error: errorMessage(err) });
    } finally {
      rec.saving = null;
    }
  })();
  await rec.saving;
  // Edits made while saving get their own save.
  if (useDocs.getState().meta[path]?.dirty && !useDocs.getState().meta[path]?.conflict) {
    rec.timer = setTimeout(() => void saveDoc(path), AUTOSAVE_MS);
  }
}

export async function saveAll(): Promise<void> {
  await Promise.all([...records.keys()].map((p) => saveDoc(p)));
}

/** Closes a document after saving it. */
export async function closeDoc(path: string): Promise<void> {
  await saveDoc(path);
  const rec = records.get(path);
  if (rec?.timer) clearTimeout(rec.timer);
  records.delete(path);
  useDocs.getState().drop(path);
}

/** Replaces the whole text, keeping the cursor near where it was (external reloads). */
function replaceText(rec: DocRecord, text: string): void {
  const state = currentState(rec);
  const old = state.doc.toString();
  if (old === text) return;
  let start = 0;
  while (start < old.length && start < text.length && old.charCodeAt(start) === text.charCodeAt(start))
    start++;
  let endOld = old.length;
  let endNew = text.length;
  while (endOld > start && endNew > start && old.charCodeAt(endOld - 1) === text.charCodeAt(endNew - 1)) {
    endOld--;
    endNew--;
  }
  const tr = state.update({
    changes: { from: start, to: endOld, insert: text.slice(start, endNew) },
    annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)],
  });
  setRecordState(rec, tr.state);
}

/** SPECS 4.9: an open note changed on disk. */
export async function externalChange(path: string): Promise<void> {
  const rec = records.get(path);
  if (!rec) return;
  const meta = useDocs.getState().meta[path];
  if (!meta) return;
  if (meta.dirty || rec.timer || rec.saving) {
    useDocs.getState().patch(path, { conflict: 'changed' });
    return;
  }
  try {
    const file = await unwrap(vx().fs.read(path));
    if (file.hash === rec.hash) return;
    rec.hash = file.hash;
    replaceText(rec, file.text);
    useDocs.getState().patch(path, { conflict: null, readOnly: file.readOnly, mixedEol: file.mixedEol });
  } catch (err) {
    if (err instanceof BridgeError && err.code === 'NOT_FOUND')
      useDocs.getState().patch(path, { conflict: 'deleted' });
  }
}

export function externalDelete(path: string): void {
  if (records.has(path)) useDocs.getState().patch(path, { conflict: 'deleted' });
}

/** Keep Mine: the next save overwrites the file on disk. */
export async function keepMine(path: string): Promise<void> {
  const rec = records.get(path);
  if (!rec) return;
  const file = await unwrap(vx().fs.read(path));
  rec.hash = file.hash;
  useDocs.getState().patch(path, { conflict: null, dirty: true });
  await saveDoc(path);
}

/** Load Theirs: discard local edits. */
export async function loadTheirs(path: string): Promise<void> {
  const rec = records.get(path);
  if (!rec) return;
  const file = await unwrap(vx().fs.read(path));
  rec.hash = file.hash;
  if (rec.timer) clearTimeout(rec.timer);
  rec.timer = null;
  replaceText(rec, file.text);
  useDocs.getState().patch(path, { conflict: null, dirty: false, readOnly: file.readOnly });
}

/** Restore after an external deletion: writes the buffer back. */
export async function restoreDeleted(path: string): Promise<void> {
  const rec = records.get(path);
  if (!rec) return;
  const text = currentState(rec).doc.toString();
  const r = await unwrap(vx().fs.create(path, text));
  rec.hash = r.hash;
  useDocs.getState().patch(path, { conflict: null, dirty: false, lastSaved: Date.now() });
}

/** After a rename or move made by the app: the document follows its file. */
export function renamed(from: string, to: string): void {
  for (const [p, rec] of [...records]) {
    let next: string | null = null;
    if (p === from) next = to;
    else if (p.startsWith(`${from}/`)) next = to + p.slice(from.length);
    if (!next) continue;
    records.delete(p);
    rec.path = next;
    records.set(next, rec);
    const meta = useDocs.getState().meta[p];
    useDocs.getState().drop(p);
    if (meta) useDocs.setState((s) => ({ meta: { ...s.meta, [next]: { ...meta, path: next } } }));
    if (liveView && liveView.path === p) liveView.path = next;
  }
}

export function dismissMixedNotice(path: string): void {
  useDocs.getState().patch(path, { noticeMixed: false });
}

/** All open documents (for tests and the status bar). */
export function openPaths(): string[] {
  return [...records.keys()];
}
