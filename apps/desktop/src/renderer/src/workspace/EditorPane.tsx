import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { analyzeNote } from '@ephemeris-notes/markdown';
import { refreshLinks, type EditorContext } from '../editor/context';
import { parseMacros } from '../editor/math';
import { blockRegistry } from '../editor/registry';
import { inlineRegistry } from '../editor/pluginInline';
import {
  attrsCompartment,
  contentAttrs,
  editableCompartment,
  editableExtensions,
  editorExtensions,
  previewCompartment,
  previewExtensions,
  setDefaultExternalOpener,
} from '../editor/setup';
import { assetUrl } from '../lib/asset';
import { useCatalog } from '../lib/catalog';
import { useSettings } from '../lib/settings';
import { unwrap, vx } from '../lib/vx';
import { workspaceStrings as s } from '../strings/workspace';
import { currentVault, openLink, report } from './actions';
import {
  attachView,
  dismissMixedNotice,
  getRecord,
  keepMine,
  loadTheirs,
  noteEdited,
  openDoc,
  rememberState,
  restoreDeleted,
  saveDoc,
  setStateFactory,
  useDocs,
  type DocMeta,
} from './docs';
import { closeItem } from './Desk';
import { useWorkspace } from './store';
import { PdfViewer } from '../pdf/PdfViewer';
import { PluginViewPane, isViewId } from '../plugins/views';

/** Live statistics for the status bar and outline. */
export const editorStats = {
  listeners: new Set<() => void>(),
  line: 1,
  col: 1,
  words: 0,
  text: '',
  path: '',
  /** First and last visible lines (margin track, document map). */
  viewTop: 1,
  viewBottom: 1,
};

function emitViewport(view: EditorView): void {
  const doc = view.state.doc;
  // documentTop is the screen position of the document's top, so it already includes scrolling.
  const rect = view.scrollDOM.getBoundingClientRect();
  const height = view.contentHeight;
  const top = view.lineBlockAtHeight(Math.min(height, Math.max(0, rect.top - view.documentTop)));
  const bottom = view.lineBlockAtHeight(Math.min(height, Math.max(0, rect.bottom - view.documentTop)));
  const a = doc.lineAt(Math.min(top.from, doc.length)).number;
  const b = doc.lineAt(Math.min(bottom.from, doc.length)).number;
  if (a === editorStats.viewTop && b === editorStats.viewBottom) return;
  editorStats.viewTop = a;
  editorStats.viewBottom = b;
  for (const fn of editorStats.listeners) fn();
}

function emitStats(view: EditorView, path: string) {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  editorStats.line = line.number;
  editorStats.col = head - line.from + 1;
  editorStats.path = path;
  for (const fn of editorStats.listeners) fn();
}

const openExternal = (url: string) => void vx().shell.openExternal(url);
setDefaultExternalOpener(openExternal);

function makeContext(path: string): EditorContext {
  const vault = currentVault();
  return {
    path,
    vaultPath: vault?.path ?? null,
    resolve: (target) => useCatalog.getState().links.resolve(target, path),
    open: openLink,
    loadNote: async (p) => {
      const rec = getRecord(p);
      if (rec) return rec.state.doc.toString();
      try {
        return (await unwrap(vx().fs.read(p))).text;
      } catch {
        return null;
      }
    },
    assetUrl: (p) => assetUrl(p),
    linkText: (p) => useCatalog.getState().links.shortestLink(p),
    files: () => useCatalog.getState().paths,
    get numbering() {
      return useSettings.getState().get<'all' | 'labeled'>('math.numbering') === 'labeled'
        ? 'labeled'
        : 'all';
    },
    get macros() {
      return parseMacros(useSettings.getState().get('library.math.macros'));
    },
    get refFormat() {
      const f = useSettings.getState().get<string>('math.referenceFormat');
      return f === 'paren' || f === 'word' ? f : 'eq';
    },
    embedChain: [],
  };
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Paste or drop files: copy into the Vault's attachment folder, insert `![[name]]` (SPECS 4.5). */
async function insertFiles(view: EditorView, files: File[], at: number): Promise<void> {
  const vault = currentVault();
  if (!vault || view.state.readOnly) return;
  const links: string[] = [];
  for (const f of files) {
    const name = f.name && f.name !== 'image.png' ? f.name : s.pastedImage(stamp());
    try {
      const path = await unwrap(vx().notes.addAttachment(vault.path, name, await f.arrayBuffer()));
      await useCatalog.getState().load();
      links.push(`![[${useCatalog.getState().links.shortestLink(path)}]]`);
    } catch (err) {
      report(err);
    }
  }
  if (!links.length) return;
  const insert = links.join('\n');
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
    userEvent: 'input.paste',
  });
  view.focus();
}

const fileHandlers = EditorView.domEventHandlers({
  paste(e, view) {
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length) return false;
    e.preventDefault();
    void insertFiles(view, files, view.state.selection.main.head);
    return true;
  },
  drop(e, view) {
    const files = [...(e.dataTransfer?.files ?? [])];
    const internal = e.dataTransfer?.getData('application/x-vx-path');
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
    if (files.length) {
      e.preventDefault();
      void insertFiles(view, files, pos);
      return true;
    }
    if (internal) {
      // A file dragged from the tree: insert a link to it.
      e.preventDefault();
      const link = useCatalog.getState().links.shortestLink(internal);
      const text = /\.(png|jpe?g|gif|webp|svg|mp4|webm)$/i.test(internal) ? `![[${link}]]` : `[[${link}]]`;
      view.dispatch({
        changes: { from: pos, insert: text },
        selection: { anchor: pos + text.length },
        userEvent: 'input.drop',
      });
      return true;
    }
    return false;
  },
});

/** Opening a note puts the cursor below its frontmatter, so the properties render. */
function bodyStart(text: string): number {
  const m = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text);
  return m ? Math.min(text.length, m[0].length) : 0;
}

setStateFactory((path, text, readOnly) =>
  EditorState.create({
    doc: text,
    selection: { anchor: bodyStart(text) },
    extensions: [
      editorExtensions({
        ctx: makeContext(path),
        readOnly,
        source: useWorkspace.getState().source,
        spellcheck: useSettings.getState().get<boolean>('editor.spellcheck') !== false,
        openExternal,
        onUpdate: (view, docChanged) => {
          const p = editorStats.path || path;
          if (docChanged) noteEdited(p, view.state);
          else rememberState(p, view.state);
          emitStats(view, p);
        },
        extra: [
          fileHandlers,
          EditorView.domEventHandlers({
            blur: () => {
              if (editorStats.path) void saveDoc(editorStats.path);
              return false;
            },
          }),
        ],
      }),
    ],
  }),
);

function Banner({ meta }: { meta: DocMeta }) {
  const p = meta.path;
  const run = (fn: () => Promise<void>) => void fn().catch(report);
  if (meta.conflict === 'changed') {
    return (
      <div className="vx-banner vx-banner--warn" role="alert" data-testid="banner-changed">
        <span className="vx-banner__mark" aria-hidden="true" />
        <span className="vx-banner__text">{s.editor.changed}</span>
        <button type="button" className="vx-btn vx-btn--small" onClick={() => run(() => loadTheirs(p))}>
          {s.editor.loadTheirs}
        </button>
        <button
          type="button"
          className="vx-btn vx-btn--small vx-btn--primary"
          onClick={() => run(() => keepMine(p))}
        >
          {s.editor.keepMine}
        </button>
      </div>
    );
  }
  if (meta.conflict === 'deleted') {
    return (
      <div className="vx-banner vx-banner--warn" role="alert" data-testid="banner-deleted">
        <span className="vx-banner__mark" aria-hidden="true" />
        <span className="vx-banner__text">{s.editor.deleted}</span>
        <button type="button" className="vx-btn vx-btn--small" onClick={() => closeItem(p)}>
          {s.editor.close}
        </button>
        <button
          type="button"
          className="vx-btn vx-btn--small vx-btn--primary"
          onClick={() => run(() => restoreDeleted(p))}
        >
          {s.editor.restore}
        </button>
      </div>
    );
  }
  if (meta.error) {
    return (
      <div className="vx-banner vx-banner--warn" role="alert">
        <span className="vx-banner__mark" aria-hidden="true" />
        <span className="vx-banner__text">{s.editor.saveFailed(meta.error)}</span>
        <button type="button" className="vx-btn vx-btn--small" onClick={() => run(() => saveDoc(p))}>
          {s.editor.retry}
        </button>
      </div>
    );
  }
  if (meta.readOnly) {
    return (
      <div className="vx-banner" role="status">
        <span className="vx-banner__mark" aria-hidden="true" />
        <span className="vx-banner__text">{s.editor.readOnly}</span>
      </div>
    );
  }
  if (meta.noticeMixed) {
    return (
      <div className="vx-banner" role="status" data-testid="banner-mixed">
        <span className="vx-banner__mark" aria-hidden="true" />
        <span className="vx-banner__text">{s.editor.mixedEol}</span>
        <button type="button" className="vx-btn vx-btn--small" onClick={() => dismissMixedNotice(p)}>
          {s.editor.dismiss}
        </button>
      </div>
    );
  }
  return null;
}

/** Position of a heading, block ID or line in a document, for links into notes. */
function jumpTarget(
  state: EditorState,
  jump: { heading?: string | null; block?: string | null; line?: number },
): number | null {
  if (jump.line) return state.doc.line(Math.min(Math.max(1, jump.line), state.doc.lines)).from;
  const summary = analyzeNote(state.doc.toString());
  if (jump.heading) {
    const key = jump.heading.trim().toLowerCase();
    const h = summary.headings.find((x) => x.text.toLowerCase() === key);
    return h ? h.from : null;
  }
  if (jump.block) {
    const b = summary.blockIds.find((x) => x.id === jump.block);
    return b ? state.doc.lineAt(b.from).from : null;
  }
  return null;
}

let paneView: { view: EditorView; shown: () => string | null } | null = null;
/** The workspace editor while it shows a note (Insert Link). */
export function currentEditor(): EditorView | null {
  return paneView && paneView.shown() ? paneView.view : null;
}

export function EditorPane() {
  const active = useWorkspace((st) => st.desk.active);
  const source = useWorkspace((st) => st.source);
  const jump = useWorkspace((st) => st.jump);
  const meta = useDocs((st) => (active ? st.meta[active] : undefined));
  const catalogVersion = useCatalog((st) => st.version);
  const settings = useSettings((st) => st.values);
  const spellcheck = settings['editor.spellcheck'] !== false;
  const fontSize = Math.min(28, Math.max(12, Number(settings['editor.fontSize']) || 18));
  const lineWidth = Math.min(1200, Math.max(480, Number(settings['editor.lineWidth']) || 700));
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const shownRef = useRef<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shown, setShown] = useState(0);
  // A PDF or a plugin view (SPECS 12.11.4) takes the editor's place.
  const isView = isViewId(active);
  const isPdf = (!!active && /\.pdf$/i.test(active)) || isView;

  // One view for the pane; documents swap their states in and out.
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({ parent: hostRef.current, state: EditorState.create({ doc: '' }) });
    viewRef.current = view;
    paneView = { view, shown: () => shownRef.current };
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => emitViewport(view));
    };
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    // Blocks seen before their renderer registers re-render when it does (SPECS 12.3).
    const redraw = () =>
      queueMicrotask(() => viewRef.current === view && view.dispatch({ effects: refreshLinks.of(null) }));
    const offBlocks = blockRegistry.onChange(redraw);
    const offInline = inlineRegistry.onChange(redraw);
    const offRegistry = () => {
      offBlocks();
      offInline();
    };
    attachView({
      get path() {
        return shownRef.current ?? '';
      },
      set path(v: string) {
        shownRef.current = v;
        editorStats.path = v;
      },
      getState: () => view.state,
      setState: (st) => view.setState(st),
    });
    return () => {
      offRegistry();
      cancelAnimationFrame(frame);
      view.scrollDOM.removeEventListener('scroll', onScroll);
      attachView(null);
      paneView = null;
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Show the active note.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const previous = shownRef.current;
    if (previous && previous !== active) {
      rememberState(previous, view.state);
      void saveDoc(previous);
    }
    if (!active || isPdf) {
      shownRef.current = null;
      editorStats.path = '';
      view.setState(EditorState.create({ doc: '' }));
      return;
    }
    let live = true;
    setLoadError(null);
    void openDoc(active).then(
      (state) => {
        if (!live || useWorkspace.getState().desk.active !== active) return;
        shownRef.current = active;
        editorStats.path = active;
        view.setState(state);
        view.dispatch({
          effects: [
            refreshLinks.of(null),
            attrsCompartment.reconfigure(
              contentAttrs(useSettings.getState().get<boolean>('editor.spellcheck') !== false),
            ),
            previewCompartment.reconfigure(previewExtensions(useWorkspace.getState().source)),
            editableCompartment.reconfigure(
              editableExtensions(useDocs.getState().meta[active]?.readOnly ?? false),
            ),
          ],
        });
        emitStats(view, active);
        // Performance mark for the SPECS 16 measurement (e2e/perf.spec.ts).
        performance.mark('vx-note-shown');
        requestAnimationFrame(() => emitViewport(view));
        setShown((n) => n + 1);
        // Take focus unless the user is typing somewhere else (a rename field, the search box).
        requestAnimationFrame(() => {
          const el = document.activeElement;
          const busy =
            el &&
            el !== document.body &&
            !view.dom.contains(el) &&
            (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
          if (!busy && !useWorkspace.getState().renaming) view.focus();
        });
      },
      (err) => live && setLoadError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, [active, isPdf]);

  // Source mode, read-only state, link targets and math settings.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: previewCompartment.reconfigure(previewExtensions(source)) });
  }, [source]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableCompartment.reconfigure(editableExtensions(meta?.readOnly ?? false)),
    });
  }, [meta?.readOnly]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshLinks.of(null) });
  }, [catalogVersion, settings]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: attrsCompartment.reconfigure(contentAttrs(spellcheck)) });
  }, [spellcheck]);

  // Links into a note: scroll to the heading, block or line.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !jump || jump.path !== active || shownRef.current !== active) return;
    const pos = jumpTarget(view.state, jump);
    useWorkspace.setState({ jump: null });
    if (pos === null) return;
    view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 48 }),
    });
    view.focus();
  }, [jump, active, shown]);

  return (
    <div
      className="vx-main-body"
      style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}
    >
      {meta && <Banner meta={meta} />}
      {loadError && (
        <div className="vx-banner vx-banner--warn" role="alert">
          <span className="vx-banner__mark" aria-hidden="true" />
          <span className="vx-banner__text">{loadError}</span>
        </div>
      )}
      {!active && (
        <div className="vx-empty" data-testid="editor-empty">
          <span className="vx-empty__title">{s.editor.empty}</span>
          <span>{s.editor.emptyHint}</span>
        </div>
      )}
      {isView && active && <PluginViewPane key={active} id={active} onClose={() => closeItem(active)} />}
      {isPdf && !isView && active && (
        <PdfViewer key={active} path={active} page={jump?.path === active ? (jump.page ?? null) : null} />
      )}
      <div
        ref={hostRef}
        className={`vx-editor${source ? ' is-source' : ''}`}
        data-testid="editor"
        style={
          {
            display: active && !isPdf ? undefined : 'none',
            '--editor-font-size': `${fontSize}px`,
            '--editor-measure': `${lineWidth}px`,
          } as CSSProperties
        }
      />
    </div>
  );
}
