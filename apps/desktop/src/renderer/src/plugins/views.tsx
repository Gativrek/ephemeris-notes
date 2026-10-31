/**
 * Plugin views (SPECS 12.11.4): full desk items next to notes and PDFs. A desk item id
 * is `view:<plugin>:<type>:<key>`. When the plugin is disabled or missing, the card
 * stays with "Needs <plugin>" and opens nothing.
 */
import { useEffect, useRef } from 'react';
import type { Disposable, NoteRef, ViewHost, ViewInstance } from '@ephemeris-notes/plugin-api';
import type { EditorContext } from '../editor/context';
import { createReadOnlyView } from '../editor/setup';
import { assetUrl } from '../lib/asset';
import { useCatalog } from '../lib/catalog';
import { vx } from '../lib/vx';
import { workspaceStrings as s } from '../strings/workspace';
import { useWorkspace } from '../workspace/store';
import { usePlugins, type ViewType } from './store';

export const VIEW_PREFIX = 'view:';
const TYPE = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** Saved view state is per machine and small (SPECS 12.11.4). */
export const MAX_VIEW_STATE = 16 * 1024;

export function isViewId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(VIEW_PREFIX);
}

export function viewId(owner: string, type: string, key = 'default'): string {
  return `${VIEW_PREFIX}${owner}:${type}:${encodeURIComponent(key)}`;
}

export function parseViewId(id: string): { owner: string; type: string; key: string } | null {
  if (!isViewId(id)) return null;
  const [owner, type, ...rest] = id.slice(VIEW_PREFIX.length).split(':');
  if (!owner || !type) return null;
  try {
    return { owner, type, key: decodeURIComponent(rest.join(':') || 'default') };
  } catch {
    return null;
  }
}

export function validViewType(type: string): boolean {
  return TYPE.test(type);
}

function viewTypeOf(id: string): ViewType | undefined {
  const p = parseViewId(id);
  return p ? usePlugins.getState().views.find((v) => v.owner === p.owner && v.type === p.type) : undefined;
}

function pluginName(owner: string): string {
  return usePlugins.getState().plugins.find((p) => p.info.manifest.id === owner)?.info.manifest.name ?? owner;
}

/** The desk card's title and icon. */
export function useViewCard(id: string): {
  title: string;
  icon: string | null;
  missing: string | null;
  dirty: boolean;
} {
  const vt = usePlugins((st) => {
    const p = parseViewId(id);
    return p ? st.views.find((v) => v.owner === p.owner && v.type === p.type) : undefined;
  });
  const override = usePlugins((st) => st.viewTitles[id]);
  const dirty = usePlugins((st) => st.viewDirty[id] ?? false);
  const state = useWorkspace((st) => st.viewStates[id]);
  const p = parseViewId(id);
  if (!vt)
    return { title: p?.type ?? id, icon: null, missing: s.views.needs(pluginName(p?.owner ?? '')), dirty };
  let title = override ?? '';
  if (!title) {
    try {
      title = vt.factory.title(state);
    } catch {
      title = vt.type;
    }
  }
  return { title, icon: vt.factory.icon ?? null, missing: null, dirty };
}

/** The view's title as text (window title). */
export function viewTitle(id: string): string {
  const vt = viewTypeOf(id);
  const override = usePlugins.getState().viewTitles[id];
  if (override) return override;
  if (!vt) return parseViewId(id)?.type ?? id;
  try {
    return vt.factory.title(useWorkspace.getState().viewStates[id]);
  } catch {
    return vt.type;
  }
}

const live = new Map<string, ViewInstance>();

/** Asks the view whether it may close (Ctrl/Cmd+W, the card's close). */
export async function requestViewClose(id: string): Promise<boolean> {
  const inst = live.get(id);
  if (!inst?.onRequestClose) return true;
  try {
    return (await inst.onRequestClose()) !== false;
  } catch (err) {
    console.error(`[plugin ${parseViewId(id)?.owner}] onRequestClose failed`, err);
    return true;
  }
}

/** Opens (or focuses) a view on the desk. */
export function openView(
  owner: string,
  type: string,
  opts: { key?: string; state?: unknown; pin?: boolean } = {},
): void {
  if (!validViewType(type)) throw new Error(`Invalid view type "${type}".`);
  const id = viewId(owner, type, opts.key);
  const ws = useWorkspace.getState();
  if (opts.state !== undefined) saveViewState(id, opts.state, owner);
  ws.openItem(id);
  if (opts.pin) ws.pin(id);
  ws.activate(id);
}

function saveViewState(id: string, state: unknown, owner: string): void {
  let json: string | undefined;
  try {
    json = JSON.stringify(state);
  } catch {
    json = undefined;
  }
  if (json === undefined || json.length > MAX_VIEW_STATE) {
    console.warn(`[plugin ${owner}] view state not saved: it must be JSON of at most 16 KB.`);
    return;
  }
  useWorkspace.getState().setViewState(id, JSON.parse(json));
}

function readOnlyContext(from: NoteRef | null): EditorContext {
  const path = from?.path ?? '';
  return {
    path,
    vaultPath: from?.vaultPath ?? null,
    resolve: (target) => useCatalog.getState().links.resolve(target, path),
    open: () => undefined,
    loadNote: async (p) => {
      const r = await vx().fs.read(p);
      return r.ok ? r.value.text : null;
    },
    assetUrl: (p) => assetUrl(p),
    linkText: (p) => useCatalog.getState().links.shortestLink(p),
    files: () => useCatalog.getState().paths,
    numbering: 'all',
    macros: {},
    refFormat: 'eq',
    embedChain: [],
  };
}

/** The desk item's body. */
export function PluginViewPane({ id, onClose }: { id: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const vt = usePlugins((st) => {
    const p = parseViewId(id);
    return p ? st.views.find((v) => v.owner === p.owner && v.type === p.type) : undefined;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el || !vt) return;
    const abort = new AbortController();
    const disposables: Disposable[] = [];
    const owner = vt.owner;
    const host: ViewHost = {
      signal: abort.signal,
      setTitle: (title) =>
        usePlugins.setState((st) => ({ viewTitles: { ...st.viewTitles, [id]: String(title) } })),
      setDirty: (dirty) => usePlugins.setState((st) => ({ viewDirty: { ...st.viewDirty, [id]: !!dirty } })),
      saveState: (state) => saveViewState(id, state, owner),
      close: onClose,
      renderMarkdown(target, markdown, from) {
        // Note typography without the editor's page padding, so it sits inside the view's layout.
        const wrap = document.createElement('div');
        wrap.className = 'vx-editor vx-view-markdown';
        target.append(wrap);
        const view = createReadOnlyView(
          wrap,
          String(markdown),
          readOnlyContext(from),
          (url) => void vx().shell.openExternal(url),
        );
        const d = {
          dispose: () => {
            view.destroy();
            wrap.remove();
          },
        };
        disposables.push(d);
        return d;
      },
    };
    let inst: ViewInstance | void;
    try {
      inst = vt.factory.render(el, useWorkspace.getState().viewStates[id], host);
      if (inst) live.set(id, inst);
    } catch (err) {
      console.error(`[plugin ${owner}] view render failed`, err);
      const p = document.createElement('p');
      p.className = 'vx-plugin-block__message';
      p.textContent = `${owner}: ${err instanceof Error ? err.message : String(err)}`;
      el.replaceChildren(p);
    }
    return () => {
      abort.abort();
      live.delete(id);
      try {
        inst?.dispose?.();
      } catch {
        // A plugin's dispose failing must not break the desk.
      }
      for (const d of disposables.splice(0)) d.dispose();
      el.replaceChildren();
      usePlugins.setState((st) => {
        const { [id]: _t, ...titles } = st.viewTitles;
        const { [id]: _d, ...dirty } = st.viewDirty;
        return { viewTitles: titles, viewDirty: dirty };
      });
    };
    // The view renders once per desk item and view type.
  }, [id, vt]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = parseViewId(id);
  if (!vt)
    return (
      <div className="vx-empty" data-testid="view-missing">
        <span className="vx-empty__title">{s.views.needs(pluginName(p?.owner ?? ''))}</span>
      </div>
    );
  return <div ref={ref} className="vx-plugin-view" data-plugin={vt.owner} data-testid="plugin-view" />;
}
