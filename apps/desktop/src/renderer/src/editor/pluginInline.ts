/**
 * Plugin inline decorations (SPECS 12.11.1, `ctx.inline`). Matches run over the visible
 * lines only, outside frontmatter, code, math, HTML, links and every other core syntax,
 * which always wins. A match becomes an inline widget; the source shows while the
 * cursor is inside it (unless the plugin opts out), and in source mode.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  hoverTooltip,
  type DecorationSet,
  type EditorView,
  type Tooltip,
  type ViewUpdate,
} from '@codemirror/view';
import type { InlineHost, InlineMatch, InlineSpec, InlineView, NoteRef } from '@ephemeris-notes/plugin-api';
import { refreshLinks, revealSource } from './context';
import { blockServices, noteRefOf } from './pluginBlock';

export interface RegisteredInline {
  owner: string;
  spec: InlineSpec;
}

/** Matches per plugin per viewport (SPECS 12.11.1). */
export const MAX_MATCHES = 500;

class InlineRegistry {
  private readonly entries: RegisteredInline[] = [];
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private warned = new Set<string>();

  register(entry: RegisteredInline): () => void {
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
  all(): readonly RegisteredInline[] {
    return this.entries;
  }
  get changeVersion(): number {
    return this.version;
  }
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  warnOnce(owner: string, ...a: unknown[]): void {
    if (this.warned.has(owner)) return;
    this.warned.add(owner);
    blockServices().log(owner, ...a);
  }
  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}

export const inlineRegistry = new InlineRegistry();

/** Core syntax plugins never see (SPECS 4.7, 12.11.1). */
const CORE = new Set([
  'Frontmatter',
  'FencedCode',
  'CodeBlock',
  'InlineCode',
  'MathBlock',
  'InlineMath',
  'EquationLabel',
  'CrossRef',
  'HTMLBlock',
  'HTMLTag',
  'CommentBlock',
  'Comment',
  'ProcessingInstructionBlock',
  'WikiLink',
  'Embed',
  'Link',
  'Image',
  'URL',
  'Autolink',
  'Tag',
  'BlockId',
]);

interface Found {
  entry: RegisteredInline;
  match: InlineMatch;
}

function excluded(state: EditorState, from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (n) => {
      if (!CORE.has(n.name)) return true;
      out.push([n.from, n.to]);
      return false;
    },
  });
  return out;
}

const overlaps = (ranges: Array<[number, number]>, a: number, b: number) =>
  ranges.some(([f, t]) => f < b && t > a);

/** Every accepted match in the visible ranges, first registration first. */
export function findMatches(view: EditorView): Found[] {
  const entries = inlineRegistry.all();
  if (!entries.length) return [];
  const state = view.state;
  let note: NoteRef | null = null;
  const out: Found[] = [];
  const taken: Array<[number, number]> = [];
  const counts = new Map<string, number>();
  for (const { from, to } of view.visibleRanges) {
    const core = excluded(state, from, to);
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      for (const entry of entries) {
        const re = entry.spec.match;
        if (!re.global || re.sticky) continue;
        re.lastIndex = 0;
        for (let m = re.exec(line.text); m; m = re.exec(line.text)) {
          if (m[0] === '') {
            re.lastIndex++;
            continue;
          }
          const a = line.from + m.index;
          const b = a + m[0].length;
          if (overlaps(core, a, b) || overlaps(taken, a, b)) continue;
          const n = counts.get(entry.owner) ?? 0;
          if (n >= MAX_MATCHES) {
            inlineRegistry.warnOnce(
              entry.owner,
              `more than ${MAX_MATCHES} inline matches in view; the rest stay text.`,
            );
            break;
          }
          note ??= noteRefOf(state);
          const match: InlineMatch = {
            text: m[0],
            groups: [...m],
            named: { ...(m.groups ?? {}) },
            from: a,
            to: b,
            line: line.number,
            note,
          };
          try {
            if (entry.spec.accept && !entry.spec.accept(match)) continue;
          } catch (err) {
            blockServices().log(entry.owner, 'inline accept failed', err);
            continue;
          }
          counts.set(entry.owner, n + 1);
          taken.push([a, b]);
          out.push({ entry, match });
        }
      }
      pos = line.to + 1;
    }
  }
  return out.sort((x, y) => x.match.from - y.match.from);
}

interface Mounted {
  view: InlineView | null;
  abort: AbortController;
}
const mounted = new WeakMap<HTMLElement, Mounted>();

class PluginInlineWidget extends WidgetType {
  constructor(
    readonly entry: RegisteredInline,
    readonly match: InlineMatch,
  ) {
    super();
  }

  override eq(o: PluginInlineWidget): boolean {
    return o.entry === this.entry && o.match.text === this.match.text;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'vx-inline';
    wrap.dataset.plugin = this.entry.owner;
    const abort = new AbortController();
    const st: Mounted = { view: null, abort };
    mounted.set(wrap, st);
    const owner = this.entry.owner;
    const text = this.match.text;
    const host: InlineHost = {
      readOnly: view.state.readOnly,
      signal: abort.signal,
      openOverlay: (opts) => blockServices().openOverlay(opts, owner),
      replace: async (next) => {
        if (abort.signal.aborted || view.state.readOnly || !wrap.isConnected || typeof next !== 'string')
          return false;
        let at: number;
        try {
          at = view.posAtDOM(wrap);
        } catch {
          return false;
        }
        // The match must still be there, unchanged.
        if (view.state.doc.sliceString(at, at + text.length) !== text) return false;
        if (next !== text)
          view.dispatch({
            changes: { from: at, to: at + text.length, insert: next },
            userEvent: `plugin.${owner}`,
          });
        return true;
      },
    };
    try {
      const r = this.entry.spec.widget(this.match, host);
      if (r instanceof HTMLElement) wrap.append(r);
      else {
        st.view = r;
        wrap.append(r.dom);
      }
    } catch (err) {
      blockServices().log(owner, 'inline widget failed', err);
      wrap.className = 'vx-inline vx-inline--error';
      wrap.textContent = text;
      wrap.title = `${owner}: ${err instanceof Error ? err.message : String(err)}`;
    }
    // A click outside the plugin's own controls puts the cursor in the source.
    wrap.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button, input, textarea, select, a')) return;
      if (this.entry.spec.revealOnCursor === false) return;
      e.preventDefault();
      try {
        view.dispatch({ selection: { anchor: view.posAtDOM(wrap) } });
        view.focus();
      } catch {
        // Detached.
      }
    });
    return wrap;
  }

  override updateDOM(dom: HTMLElement): boolean {
    const st = mounted.get(dom);
    if (!st?.view?.update) return false;
    try {
      return st.view.update(this.match) === true;
    } catch {
      return false;
    }
  }

  override destroy(dom: HTMLElement): void {
    const st = mounted.get(dom);
    if (!st) return;
    mounted.delete(dom);
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

function build(view: EditorView): { decorations: DecorationSet; found: Found[] } {
  const found = findMatches(view);
  const reveal = view.state.facet(revealSource);
  const decos: Range<Decoration>[] = [];
  for (const f of found) {
    const inside =
      reveal &&
      f.entry.spec.revealOnCursor !== false &&
      view.state.selection.ranges.some((r) => r.from <= f.match.to && r.to >= f.match.from);
    if (inside) continue;
    decos.push(
      Decoration.replace({ widget: new PluginInlineWidget(f.entry, f.match) }).range(
        f.match.from,
        f.match.to,
      ),
    );
  }
  return { decorations: Decoration.set(decos, true), found };
}

export const pluginInline = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    found: Found[];
    private version = inlineRegistry.changeVersion;
    constructor(view: EditorView) {
      ({ decorations: this.decorations, found: this.found } = build(view));
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        this.version !== inlineRegistry.changeVersion ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLinks)))
      ) {
        this.version = inlineRegistry.changeVersion;
        ({ decorations: this.decorations, found: this.found } = build(u.view));
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** The plugin's hover card, in the core preview-card surface. */
export const pluginInlineHover = hoverTooltip(
  (view, pos): Tooltip | null => {
    const found = view.plugin(pluginInline)?.found ?? [];
    const f = found.find((x) => x.entry.spec.hover && x.match.from <= pos && x.match.to >= pos);
    if (!f) return null;
    return {
      pos: f.match.from,
      end: f.match.to,
      above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = 'vx-preview-card';
        dom.dataset.plugin = f.entry.owner;
        let cleanup: void | (() => void);
        try {
          cleanup = f.entry.spec.hover?.(f.match, dom);
        } catch (err) {
          blockServices().log(f.entry.owner, 'inline hover failed', err);
        }
        return {
          dom,
          destroy: () => {
            try {
              if (typeof cleanup === 'function') cleanup();
            } catch {
              // Ignore.
            }
          },
        };
      },
    };
  },
  { hoverTime: 400 },
);
