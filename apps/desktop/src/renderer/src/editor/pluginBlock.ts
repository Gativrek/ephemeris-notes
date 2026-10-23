/**
 * A fenced block drawn by a registered renderer (SPECS 10.10, 12.6, 12.8). The host
 * gives the plugin `updateSource` (one CodeMirror transaction, `plugin.<id>`, refused
 * when stale, read-only, gone or called during render), a loading state after 300 ms,
 * and an error state with the source, the message and a Retry button.
 */
import { syntaxTree } from '@codemirror/language';
import { WidgetType, type EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { BlockHost, BlockInfo, BlockView, Domain, OverlayOptions } from '@vaults/plugin-api';
import { analyzeNote, domainOf } from '@vaults/markdown';
import { editorContext } from './context';
import { blockRegistry, sourceVersion, type RegisteredRenderer } from './registry';

export interface BlockServices {
  openOverlay(opts: OverlayOptions, owner: string): ReturnType<BlockHost['openOverlay']>;
  log(owner: string, ...a: unknown[]): void;
}

let services: BlockServices = {
  openOverlay: () => ({ close: () => undefined, setTitle: () => undefined, setDirty: () => undefined }),
  log: (owner, ...a) => console.warn(`[${owner}]`, ...a),
};
/** The plugin host installs the overlay and log services. */
export function setBlockServices(s: BlockServices): void {
  services = s;
}

interface MountState {
  entry: RegisteredRenderer;
  view: BlockView | null;
  abort: AbortController;
  rendering: boolean;
}
const states = new WeakMap<HTMLElement, MountState>();

/** The FencedCode node holding `pos`, and its body range. */
function blockAt(
  view: EditorView,
  pos: number,
): { node: SyntaxNode; bodyFrom: number; bodyTo: number } | null {
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1);
  while (node && node.name !== 'FencedCode') node = node.parent;
  if (!node) {
    node = syntaxTree(view.state).resolveInner(Math.min(view.state.doc.length, pos + 1), 1);
    while (node && node.name !== 'FencedCode') node = node.parent;
  }
  if (!node) return null;
  const doc = view.state.doc;
  const first = doc.lineAt(node.from);
  const last = doc.lineAt(node.to);
  const closes = last.number > first.number && /^\s*(`{3,}|~{3,})\s*$/.test(last.text);
  const bodyFrom = Math.min(first.to + 1, node.to);
  const bodyTo = closes ? Math.max(bodyFrom, last.from - 1) : node.to;
  return { node, bodyFrom, bodyTo };
}

export class PluginBlockWidget extends WidgetType {
  constructor(
    readonly language: string,
    readonly infoString: string,
    readonly args: BlockInfo['args'],
    readonly source: string,
    readonly from: number,
  ) {
    super();
  }

  override eq(o: PluginBlockWidget): boolean {
    return o.language === this.language && o.source === this.source && o.infoString === this.infoString;
  }

  private info(view: EditorView): BlockInfo {
    const ctx = view.state.facet(editorContext);
    let frontmatter: Record<string, unknown>;
    try {
      frontmatter =
        analyzeNote(view.state.doc.sliceString(0, Math.min(view.state.doc.length, 20000))).frontmatter
          ?.data ?? {};
    } catch {
      frontmatter = {};
    }
    const domain = ctx.vaultPath ? (domainOf(ctx.vaultPath)?.toLowerCase() as Domain | undefined) : undefined;
    return {
      language: this.language,
      infoString: this.infoString.trim().split(/\s+/).slice(1).join(' '),
      args: this.args,
      source: this.source,
      version: sourceVersion(this.source),
      note: { path: ctx.path, vaultPath: ctx.vaultPath, domain: domain ?? null, frontmatter },
    };
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div');
    box.className = 'vx-plugin-block';
    box.dataset.language = this.language;
    void this.mount(box, view);
    box.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('button, input, textarea, select, a')) return;
      const at = blockAt(view, view.posAtDOM(box));
      if (!at) return;
      view.dispatch({ selection: { anchor: at.bodyFrom } });
      view.focus();
    });
    return box;
  }

  /** Source changed: let the plugin update in place when it can (BlockView.update). */
  override updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const st = states.get(dom);
    const entry = blockRegistry.get(this.language);
    if (!st || !entry || st.entry !== entry || !st.view?.update || st.rendering) return false;
    try {
      return st.view.update(this.info(view)) === true;
    } catch (err) {
      services.log(entry.owner, 'update failed', err);
      return false;
    }
  }

  private async mount(box: HTMLElement, view: EditorView): Promise<void> {
    const entry = blockRegistry.get(this.language);
    if (!entry) return;
    const old = states.get(box);
    if (old) {
      old.abort.abort();
      try {
        old.view?.dispose?.();
      } catch {
        // A plugin's dispose failing must not break the editor.
      }
    }
    const st: MountState = { entry, view: null, abort: new AbortController(), rendering: true };
    states.set(box, st);
    box.replaceChildren();
    box.classList.remove('is-error');
    const el = document.createElement('div');
    el.className = 'vx-plugin-block__body';
    box.append(el);
    const loading = setTimeout(() => box.classList.add('is-loading'), 300);
    const signal = st.abort.signal;
    const owner = entry.owner;
    const host: BlockHost = {
      readOnly: view.state.readOnly,
      signal,
      openOverlay: (opts) => services.openOverlay(opts, owner),
      updateSource: async (next, opts) => {
        if (st.rendering) {
          services.log(owner, 'updateSource called during render: refused (SPECS 12.6).');
          return false;
        }
        if (signal.aborted || view.state.readOnly || !box.isConnected || typeof next !== 'string')
          return false;
        let pos: number;
        try {
          pos = view.posAtDOM(box);
        } catch {
          return false;
        }
        const at = blockAt(view, pos);
        if (!at) return false;
        const current = view.state.doc.sliceString(at.bodyFrom, at.bodyTo);
        if (opts?.expectedVersion !== undefined && opts.expectedVersion !== sourceVersion(current))
          return false;
        if (current === next) return true;
        view.dispatch({
          changes: { from: at.bodyFrom, to: at.bodyTo, insert: next },
          userEvent: `plugin.${owner}`,
        });
        return true;
      },
    };
    try {
      const result = await entry.renderer.render(el, this.info(view), host);
      st.view = result ?? null;
    } catch (err) {
      services.log(owner, 'render failed', err);
      box.classList.add('is-error');
      box.replaceChildren(this.errorState(err, owner, () => void this.mount(box, view)));
    } finally {
      st.rendering = false;
      clearTimeout(loading);
      box.classList.remove('is-loading');
      view.requestMeasure();
    }
  }

  private errorState(err: unknown, owner: string, retry: () => void): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'vx-plugin-block__error';
    const pre = document.createElement('pre');
    pre.className = 'vx-plugin-block__source';
    pre.textContent = this.source;
    const msg = document.createElement('p');
    msg.className = 'vx-plugin-block__message';
    msg.textContent = `${owner}: ${err instanceof Error ? err.message : String(err)}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vx-btn vx-btn--small';
    btn.textContent = 'Retry';
    btn.addEventListener('click', retry);
    wrap.append(pre, msg, btn);
    return wrap;
  }

  override destroy(dom: HTMLElement): void {
    const st = states.get(dom);
    if (!st) return;
    states.delete(dom);
    st.abort.abort();
    try {
      st.view?.dispose?.();
    } catch {
      // A plugin's dispose failing must not break the editor.
    }
  }

  override ignoreEvent(): boolean {
    return true;
  }
}
