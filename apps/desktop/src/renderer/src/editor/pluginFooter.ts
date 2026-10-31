/**
 * Plugin note footers (SPECS 12.12, `ctx.footers`): block widgets after a note's last line,
 * in the main editor's live preview only. A footer is drawn once per note shown and keeps
 * its DOM while the note is edited; the plugin updates it itself.
 */
import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import type { FooterSpec, FooterView } from '@ephemeris-notes/plugin-api';
import { editorContext } from './context';
import { blockServices, noteRefOf } from './pluginBlock';

export interface RegisteredFooter {
  owner: string;
  spec: FooterSpec;
}

class FooterRegistry {
  private readonly entries: RegisteredFooter[] = [];
  private readonly listeners = new Set<() => void>();

  register(entry: RegisteredFooter): () => void {
    this.entries.push(entry);
    this.changed();
    return () => {
      const i = this.entries.indexOf(entry);
      if (i >= 0) {
        this.entries.splice(i, 1);
        this.changed();
      }
    };
  }
  all(): readonly RegisteredFooter[] {
    return this.entries;
  }
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed(): void {
    for (const fn of this.listeners) fn();
  }
}

export const footerRegistry = new FooterRegistry();

/**
 * A footer's live state, by its element: CodeMirror keeps the DOM of an equal widget and
 * destroys through the newer widget object, so the state cannot live on the widget.
 */
const mounted = new WeakMap<HTMLElement, { abort: AbortController; view: FooterView | void }>();

class FooterWidget extends WidgetType {
  constructor(
    readonly entry: RegisteredFooter,
    readonly path: string,
  ) {
    super();
  }

  override eq(o: FooterWidget): boolean {
    return o.entry === this.entry && o.path === this.path;
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vx-plugin-footer';
    el.dataset.plugin = this.entry.owner;
    const abort = new AbortController();
    let footer: FooterView | void = undefined;
    try {
      footer = this.entry.spec.render(el, noteRefOf(view.state), { signal: abort.signal });
    } catch (err) {
      el.replaceChildren();
      blockServices().log(this.entry.owner, 'footer render failed', err);
    }
    mounted.set(el, { abort, view: footer });
    return el;
  }

  override destroy(dom: HTMLElement): void {
    const m = mounted.get(dom);
    if (!m) return;
    mounted.delete(dom);
    m.abort.abort();
    try {
      m.view?.dispose?.();
    } catch (err) {
      blockServices().log(this.entry.owner, 'footer dispose failed', err);
    }
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const refreshFooters = StateEffect.define<null>();

function build(state: EditorState): DecorationSet {
  const entries = footerRegistry.all();
  // Not in embeds, help pages or read-only files.
  if (!entries.length || state.readOnly) return Decoration.none;
  const path = state.facet(editorContext).path;
  const end = state.doc.length;
  return Decoration.set(
    entries.map((entry) =>
      Decoration.widget({ widget: new FooterWidget(entry, path), block: true, side: 1 }).range(end),
    ),
  );
}

const footerField = StateField.define<DecorationSet>({
  create: build,
  update(decos, tr) {
    const refresh =
      tr.effects.some((e) => e.is(refreshFooters)) || tr.startState.readOnly !== tr.state.readOnly;
    // On an edit the widgets move to the new end; equal widgets keep their DOM.
    return refresh || tr.docChanged ? build(tr.state) : decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Editors showing footers, so a plugin enabled or disabled updates them. */
const live = new Set<EditorView>();
footerRegistry.onChange(() => {
  for (const v of live) v.dispatch({ effects: refreshFooters.of(null) });
});
const trackFooters = ViewPlugin.define((view) => {
  live.add(view);
  return { destroy: () => live.delete(view) };
});

export const pluginFooters = [footerField, trackFooters];
