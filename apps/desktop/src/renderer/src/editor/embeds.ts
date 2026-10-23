/**
 * Note embeds (`![[Note]]`, `![[Note#Heading]]`, SPECS 10.7): the target section,
 * rendered read-only by the same editor, in a framed block with a link to open it.
 * At most three levels deep, with cycle detection. Also the plugin block widget.
 */
import { WidgetType, type EditorView } from '@codemirror/view';
import { analyzeNote } from '@vaults/markdown';
import { editorContext, type EditorContext } from './context';
import { blockRegistry, type RenderBlock } from './registry';
import { linkAttrs } from './widgets';

const MAX_DEPTH = 3;

type ReadOnlyFactory = (parent: HTMLElement, text: string, ctx: EditorContext) => { destroy(): void };
let readOnlyFactory: ReadOnlyFactory | null = null;

/** setup.ts installs the factory (avoids an import cycle). */
export function setReadOnlyFactory(f: ReadOnlyFactory): void {
  readOnlyFactory = f;
}

/** The text of `heading`'s section: from the heading to the next one of the same or a higher level. */
export function sectionOf(text: string, heading: string | null): string | null {
  if (!heading) return text;
  const s = analyzeNote(text);
  const key = heading.trim().toLowerCase();
  const i = s.headings.findIndex((h) => h.text.toLowerCase() === key);
  if (i < 0) return null;
  const h = s.headings[i]!;
  const next = s.headings.slice(i + 1).find((x) => x.level <= h.level);
  return text.slice(h.from, next ? next.from : text.length).replace(/\s+$/, '\n');
}

export class NoteEmbedWidget extends WidgetType {
  private destroyFn: (() => void) | null = null;
  constructor(
    readonly path: string,
    readonly heading: string | null,
    readonly target: string,
  ) {
    super();
  }
  override eq(o: NoteEmbedWidget): boolean {
    return o.path === this.path && o.heading === this.heading;
  }
  toDOM(view: EditorView): HTMLElement {
    const ctx = view.state.facet(editorContext);
    const box = document.createElement('div');
    box.className = 'vx-embed';
    const bar = document.createElement('div');
    bar.className = 'vx-embed__bar';
    const link = document.createElement('span');
    link.className = 'vx-cm-link';
    linkAttrs(link, { target: this.target, heading: this.heading, block: null, page: null, path: this.path });
    link.textContent = this.heading ? `${this.target} › ${this.heading}` : this.target;
    bar.append(link);
    const body = document.createElement('div');
    body.className = 'vx-embed__body';
    box.append(bar, body);

    const chain = [...ctx.embedChain, ctx.path];
    if (chain.includes(this.path)) {
      body.textContent = 'This note embeds itself; the embed is not repeated.';
      body.classList.add('vx-block-note');
      return box;
    }
    if (chain.length > MAX_DEPTH) {
      body.textContent = 'Embeds are shown at most three levels deep.';
      body.classList.add('vx-block-note');
      return box;
    }
    void ctx.loadNote(this.path).then((text) => {
      if (text === null) {
        body.textContent = 'This note could not be read.';
        body.classList.add('vx-block-note');
        return;
      }
      const section = sectionOf(text, this.heading);
      if (section === null) {
        body.textContent = `No heading "${this.heading}" in this note.`;
        body.classList.add('vx-block-note');
        return;
      }
      if (!readOnlyFactory) return;
      const nested = readOnlyFactory(body, section, { ...ctx, path: this.path, embedChain: chain });
      this.destroyFn = () => nested.destroy();
      view.requestMeasure();
    });
    return box;
  }
  override destroy(): void {
    this.destroyFn?.();
    this.destroyFn = null;
  }
  override ignoreEvent(e: Event): boolean {
    return !(e.target as HTMLElement).closest('[data-vx-link]');
  }
}

/**
 * A fenced block drawn by a registered renderer (SPECS 10.10, 12.8): loading state
 * after 300 ms, error state with the source, the message and a Retry button.
 */
export class PluginBlockWidget extends WidgetType {
  private cleanup: (() => void) | null = null;
  private abort: AbortController | null = null;
  constructor(
    readonly language: string,
    readonly infoString: string,
    readonly args: RenderBlock['args'],
    readonly source: string,
    readonly from: number,
    readonly bodyFrom: number,
    readonly bodyTo: number,
  ) {
    super();
  }
  override eq(o: PluginBlockWidget): boolean {
    return o.language === this.language && o.source === this.source && o.infoString === this.infoString;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div');
    box.className = 'vx-plugin-block';
    box.dataset.language = this.language;
    void this.mount(box, view);
    box.addEventListener('dblclick', () => {
      view.dispatch({ selection: { anchor: this.bodyFrom } });
      view.focus();
    });
    return box;
  }

  private async mount(box: HTMLElement, view: EditorView): Promise<void> {
    const renderer = blockRegistry.get(this.language);
    if (!renderer) return;
    const ctx = view.state.facet(editorContext);
    this.abort?.abort();
    this.abort = new AbortController();
    box.replaceChildren();
    const el = document.createElement('div');
    el.className = 'vx-plugin-block__body';
    box.append(el);
    const loading = setTimeout(() => box.classList.add('is-loading'), 300);
    const fm = (() => {
      try {
        return (
          analyzeNote(view.state.doc.sliceString(0, Math.min(view.state.doc.length, 20000))).frontmatter
            ?.data ?? {}
        );
      } catch {
        return {};
      }
    })();
    const block: RenderBlock = {
      language: this.language,
      infoString: this.infoString.trim().split(/\s+/).slice(1).join(' '),
      args: this.args,
      source: this.source,
      version: view.state.doc.length ^ this.source.length,
      notePath: ctx.path,
      vaultPath: ctx.vaultPath,
      frontmatter: fm,
    };
    const signal = this.abort.signal;
    try {
      const result = await renderer.mount(el, block, {
        readOnly: view.state.readOnly,
        signal,
        updateSource: async (next) => {
          if (view.state.readOnly || signal.aborted) return false;
          view.dispatch({
            changes: { from: this.bodyFrom, to: this.bodyTo, insert: next },
            userEvent: `plugin.${renderer.owner}`,
          });
          return true;
        },
      });
      if (typeof result === 'function') this.cleanup = result;
    } catch (err) {
      box.replaceChildren(this.errorState(err, renderer.owner, () => void this.mount(box, view)));
    } finally {
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

  override destroy(): void {
    this.abort?.abort();
    try {
      this.cleanup?.();
    } catch {
      // A plugin's cleanup failing must not break the editor.
    }
    this.cleanup = null;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}
