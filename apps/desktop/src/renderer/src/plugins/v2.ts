/**
 * The v2 services of a plugin's `ctx` (SPECS 12.11, API 1.1.0): inline decorations,
 * index extractors, outline contributions, views and note edits. Every registration
 * goes through `track`, so disabling the plugin removes it.
 */
import type {
  Disposable,
  EditorAccess,
  ExtractorSpec,
  FooterRegistry,
  IndexQuery,
  IndexRecord,
  InlineRegistry,
  NoteEditor,
  OutlineRegistry,
  PluginIndex,
  ViewRegistry,
} from '@ephemeris-notes/plugin-api';
import { noteRefOf } from '../editor/pluginBlock';
import { footerRegistry } from '../editor/pluginFooter';
import { inlineRegistry } from '../editor/pluginInline';
import { unwrap, vx } from '../lib/vx';
import { currentEditor, editorStats } from '../workspace/EditorPane';
import { editOpenDoc, getRecord, saveDoc } from '../workspace/docs';
import { recentlyActedIn, wireActivity } from './activity';
import { newKey, usePlugins } from './store';
import { openView, validViewType } from './views';

type Track = (fn: () => void) => Disposable;
interface Log {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

export function inlineService(id: string, track: Track): InlineRegistry {
  return {
    register(spec) {
      if (!spec || !(spec.match instanceof RegExp))
        throw new Error('inline.register needs a `match` RegExp.');
      if (!spec.match.global || spec.match.sticky)
        throw new Error('inline.register: `match` must have the g flag and not the y flag.');
      if (typeof spec.widget !== 'function') throw new Error('inline.register needs a `widget` function.');
      return track(inlineRegistry.register({ owner: id, spec }));
    },
  };
}

// ---- Index extractors -----------------------------------------------------------

/** Extractors stay registered across library switches: the new index worker gets them again. */
const extractorSpecs = new Map<string, { plugin: string; spec: ExtractorSpec }>();
let wiredLibrary = false;
function wireLibrary(): void {
  if (wiredLibrary) return;
  wiredLibrary = true;
  vx().library.onChanged((lib) => {
    if (!lib) return;
    for (const { plugin, spec } of extractorSpecs.values())
      void vx()
        .index.registerExtractor(plugin, spec)
        .catch(() => undefined);
  });
}

export function indexService(id: string, track: Track, log: Log): PluginIndex {
  wireLibrary();
  return {
    registerExtractor(spec) {
      const key = `${id}/${String((spec as { id?: unknown }).id)}`;
      extractorSpecs.set(key, { plugin: id, spec });
      // Plain data crosses to the index worker; a bad spec is reported, not thrown later.
      void vx()
        .index.registerExtractor(id, JSON.parse(JSON.stringify(spec)))
        .then((r) => {
          if (!r.ok) log.error(`extractor "${String(spec.id)}" refused: ${r.error.message}`);
        });
      return track(() => {
        extractorSpecs.delete(key);
        void vx().index.unregisterExtractor(id, String(spec.id));
      });
    },
    async query(q: IndexQuery): Promise<IndexRecord[]> {
      return unwrap(vx().index.queryRecords(id, JSON.parse(JSON.stringify(q))));
    },
    onChanged(cb) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const off = vx().index.onRecords((plugins) => {
        if (!plugins.includes(id)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          try {
            cb();
          } catch (err) {
            log.error('index.onChanged failed', err);
          }
        }, 200);
      });
      return track(() => {
        if (timer) clearTimeout(timer);
        off();
      });
    },
  };
}

// ---- Outline, views ---------------------------------------------------------------

export function outlineService(id: string, track: Track): OutlineRegistry {
  return {
    contribute(fn) {
      if (typeof fn !== 'function') throw new Error('outline.contribute needs a function.');
      const key = newKey();
      usePlugins.setState((s) => ({ outline: [...s.outline, { key, owner: id, fn }] }));
      return track(() => usePlugins.setState((s) => ({ outline: s.outline.filter((c) => c.key !== key) })));
    },
  };
}

export function viewsService(id: string, track: Track): ViewRegistry {
  return {
    register(type, factory) {
      if (!validViewType(type)) throw new Error(`views.register: invalid type "${type}".`);
      if (!factory || typeof factory.render !== 'function' || typeof factory.title !== 'function')
        throw new Error('views.register needs a factory with title() and render().');
      const vid = `${id}:${type}`;
      usePlugins.setState((s) => ({
        views: [...s.views.filter((v) => v.id !== vid), { id: vid, owner: id, type, factory }],
      }));
      return track(() => usePlugins.setState((s) => ({ views: s.views.filter((v) => v.id !== vid) })));
    },
    async open(type, opts) {
      openView(id, type, opts ?? {});
    },
  };
}

// ---- Note edits ---------------------------------------------------------------------

const MAX_EDIT_BYTES = 1024 * 1024;

/** Library-relative with forward slashes; main validates it again (SPECS 4.8). */
function normalizeRelPath(p: string): string {
  return String(p)
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '');
}

type EditResult = Awaited<ReturnType<NoteEditor['edit']>>;

function validEdits(
  edits: unknown,
  length: number,
): Array<{ from: number; to: number; insert: string }> | null {
  if (!Array.isArray(edits)) return null;
  let last = -1;
  let size = 0;
  const out: Array<{ from: number; to: number; insert: string }> = [];
  for (const e of edits as Array<Record<string, unknown>>) {
    if (!e || typeof e !== 'object') return null;
    const { from, to, insert } = e;
    if (!Number.isInteger(from) || !Number.isInteger(to) || typeof insert !== 'string') return null;
    const f = from as number;
    const t = to as number;
    if (f < 0 || t < f || t > length || f < last) return null;
    size += insert.length;
    last = t;
    out.push({ from: f, to: t, insert });
  }
  return size <= MAX_EDIT_BYTES ? out : null;
}

export function notesService(id: string, log: Log): NoteEditor {
  wireActivity();
  const read = async (raw: string) => {
    const path = normalizeRelPath(raw);
    // An open note with unsaved edits is saved first, so text and hash agree with the disk.
    if (getRecord(path)) await saveDoc(path);
    const f = await unwrap(vx().fs.read(path));
    return { path, file: f };
  };
  return {
    async read(raw) {
      const { file } = await read(raw);
      return { text: file.text, hash: file.hash };
    },
    async edit(raw, edits, opts): Promise<EditResult> {
      // User-initiated only (SPECS 12.11.5): the plugin's UI must have just been used.
      if (!navigator.userActivation?.isActive || !recentlyActedIn(id)) {
        log.warn('notes.edit refused: it needs a user action (a click or key press) in the plugin.');
        return { ok: false, reason: 'notAllowed' };
      }
      if (!opts || typeof opts.expectedHash !== 'string' || typeof opts.reason !== 'string' || !opts.reason)
        return { ok: false, reason: 'invalid' };
      let path: string;
      let file;
      try {
        ({ path, file } = await read(raw));
      } catch (err) {
        const code = (err as { code?: string }).code;
        return { ok: false, reason: code === 'NOT_FOUND' ? 'notFound' : 'invalid' };
      }
      if (file.readOnly) return { ok: false, reason: 'readOnly' };
      if (file.hash !== opts.expectedHash) return { ok: false, reason: 'conflict' };
      const list = validEdits(edits, file.text.length);
      if (!list) return { ok: false, reason: 'invalid' };
      const userEvent = `plugin.${id}`;
      if (getRecord(path)) {
        // Open: one transaction in the note's own history, then the normal save.
        const view = currentEditor();
        if (view && editorStats.path === path) view.dispatch({ changes: list, userEvent });
        else editOpenDoc(path, list, userEvent);
        await saveDoc(path);
        const after = await unwrap(vx().fs.read(path));
        log.info(`edited ${path}: ${opts.reason}`);
        return { ok: true, hash: after.hash };
      }
      let text = '';
      let pos = 0;
      for (const e of list) {
        text += file.text.slice(pos, e.from) + e.insert;
        pos = e.to;
      }
      text += file.text.slice(pos);
      const r = await vx().fs.write(path, text, opts.expectedHash);
      if (!r.ok) return { ok: false, reason: r.error.code === 'CONFLICT' ? 'conflict' : 'invalid' };
      log.info(`edited ${path}: ${opts.reason}`);
      return { ok: true, hash: r.value.hash };
    },
  };
}

// ---- 1.3.0: cursor insertion and note footers (SPECS 12.12) ---------------------------

export function footerService(id: string, track: Track): FooterRegistry {
  return {
    register(spec) {
      if (!spec || typeof spec.render !== 'function')
        throw new Error('footers.register needs a `render` function.');
      return track(footerRegistry.register({ owner: id, spec }));
    },
  };
}

export function editorService(id: string, log: Log): EditorAccess {
  wireActivity();
  return {
    activeNote() {
      const view = currentEditor();
      return view ? noteRefOf(view.state) : null;
    },
    async insertText(text) {
      if (typeof text !== 'string') return false;
      // User-initiated only, as notes.edit (SPECS 12.11.5).
      if (!navigator.userActivation?.isActive || !recentlyActedIn(id)) {
        log.warn(
          'editor.insertText refused: it needs a user action (a command, or a click or key press in the plugin).',
        );
        return false;
      }
      const view = currentEditor();
      if (!view || view.state.readOnly) return false;
      const sel = view.state.selection.main;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor: sel.from + text.length },
        userEvent: `plugin.${id}`,
        scrollIntoView: true,
      });
      view.focus();
      return true;
    },
  };
}
