/**
 * Following links (SPECS 10.2): a plain click on a rendered link, or Ctrl/Cmd+click
 * anywhere in a link's source. Hover previews after 500 ms. Autocomplete after `[[`,
 * headings after `#` and block IDs after `#^` (SPECS 10.1).
 */
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { EditorView, hoverTooltip, type Tooltip } from '@codemirror/view';
import { analyzeNote, splitTarget } from '@vaults/markdown';
import { editorContext, revealSource, type EditorContext, type OpenLinkRequest } from './context';
import { activeLines } from './livePreview';
import { equationCompletions } from './equations';

function requestFrom(el: HTMLElement, ctx: EditorContext, newItem: boolean): OpenLinkRequest | null {
  const target = el.dataset.target;
  if (target === undefined) return null;
  const path = el.dataset.path ?? ctx.resolve(target).path;
  return {
    path: path ?? null,
    target,
    heading: el.dataset.heading ?? null,
    block: el.dataset.block ?? null,
    page: el.dataset.page ? Number(el.dataset.page) : null,
    newItem,
  };
}

/** Link under a document position in source (for Ctrl/Cmd+click on the active line). */
function linkAtPos(view: EditorView, pos: number): { target: string; href: string | null } | null {
  const node = syntaxTree(view.state).resolveInner(pos, 1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (n.name === 'WikiLink' || n.name === 'Embed') {
      const t = n.getChild('WikiLinkTarget');
      return { target: t ? view.state.doc.sliceString(t.from, t.to) : '', href: null };
    }
    if (n.name === 'Link') {
      const url = n.getChild('URL');
      const href = url ? view.state.doc.sliceString(url.from, url.to) : '';
      return /^[a-z][a-z0-9+.-]*:/i.test(href)
        ? { target: '', href }
        : { target: decodeURISafe(href), href: null };
    }
    if (n.name === 'URL') return { target: '', href: view.state.doc.sliceString(n.from, n.to) };
  }
  return null;
}

function decodeURISafe(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

export type ExternalOpener = (url: string) => void;

export function linkClicks(openExternal: ExternalOpener) {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0 && e.button !== 1) return false;
      const ctx = view.state.facet(editorContext);
      const mod = e.ctrlKey || e.metaKey;
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-vx-link]');
      if (el) {
        // Rendered links follow on a plain click. Link source on the line being edited
        // is text: there, only Ctrl/Cmd+click follows.
        const inWidget = el.closest('[contenteditable="false"]') !== null;
        if (!inWidget && !mod && view.state.facet(revealSource)) {
          const line = view.state.doc.lineAt(view.posAtDOM(el)).number;
          if (activeLines(view.state).has(line)) return false;
        }
        e.preventDefault();
        if (el.dataset.href) {
          openExternal(el.dataset.href);
          return true;
        }
        const req = requestFrom(el, ctx, mod || e.button === 1);
        if (req) ctx.open(req);
        return true;
      }
      if (!mod) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return false;
      const link = linkAtPos(view, pos);
      if (!link) return false;
      e.preventDefault();
      if (link.href) {
        openExternal(link.href);
        return true;
      }
      const parts = splitTarget(link.target);
      ctx.open({ path: ctx.resolve(parts.target).path, ...parts, newItem: true });
      return true;
    },
  });
}

/** Read-only preview card of the target's first 12 lines (SPECS 10.2). */
export const linkPreview = hoverTooltip(
  async (view, pos): Promise<Tooltip | null> => {
    const node = syntaxTree(view.state).resolveInner(pos, 1);
    let link = null as null | { from: number; to: number; target: string };
    for (let n: typeof node | null = node; n; n = n.parent) {
      if (n.name === 'WikiLink' || n.name === 'Embed') {
        const t = n.getChild('WikiLinkTarget');
        link = { from: n.from, to: n.to, target: t ? view.state.doc.sliceString(t.from, t.to) : '' };
        break;
      }
    }
    if (!link) return null;
    const ctx = view.state.facet(editorContext);
    const parts = splitTarget(link.target);
    const path = ctx.resolve(parts.target).path;
    if (!path || !/\.md$/i.test(path)) return null;
    const text = await ctx.loadNote(path);
    if (text === null) return null;
    return {
      pos: link.from,
      end: link.to,
      above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = 'vx-preview-card';
        const title = document.createElement('div');
        title.className = 'vx-preview-card__title';
        title.textContent = path.replace(/\.md$/i, '');
        const body = document.createElement('div');
        body.className = 'vx-preview-card__body';
        body.textContent = text
          .replace(/^---\n[\s\S]*?\n---\n/, '')
          .split('\n')
          .slice(0, 12)
          .join('\n');
        dom.append(title, body);
        return { dom };
      },
    };
  },
  { hoverTime: 500 },
);

// ---- Autocomplete -----------------------------------------------------------

const headingCache = new Map<string, { at: number; headings: string[]; blocks: string[] }>();

async function targetOutline(ctx: EditorContext, path: string) {
  const hit = headingCache.get(path);
  if (hit && Date.now() - hit.at < 5000) return hit;
  const text = await ctx.loadNote(path);
  const s = analyzeNote(text ?? '');
  const entry = {
    at: Date.now(),
    headings: s.headings.map((h) => h.text),
    blocks: s.blockIds.map((b) => b.id),
  };
  headingCache.set(path, entry);
  return entry;
}

async function wikiCompletions(cx: CompletionContext): Promise<CompletionResult | null> {
  const before = cx.matchBefore(/!?\[\[[^\]\n[]*$/);
  if (!before) return null;
  const ctx = cx.state.facet(editorContext);
  const open = before.text.indexOf('[[') + 2;
  const typed = before.text.slice(open);
  const from = before.from + open;
  const after = cx.state.sliceDoc(cx.pos, cx.pos + 2);
  const close = after === ']]' ? '' : ']]';
  const hash = typed.indexOf('#');
  if (hash >= 0) {
    // Headings after `#`, block IDs after `#^`, in the target note.
    const target = typed.slice(0, hash);
    const path = target ? ctx.resolve(target).path : ctx.path;
    if (!path || !/\.md$/i.test(path)) return null;
    const outline = await targetOutline(ctx, path);
    const isBlock = typed[hash + 1] === '^';
    const start = from + hash + (isBlock ? 2 : 1);
    const items = isBlock ? outline.blocks : outline.headings;
    return {
      from: start,
      options: items.map((label) => ({
        label,
        type: isBlock ? 'constant' : 'property',
        apply: `${label}${close}`,
      })),
      validFor: /^[^\]|#\n]*$/,
    };
  }
  const options = ctx.files().map((p) => {
    const label = ctx.linkText(p);
    const folder = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    return { label, detail: folder, type: /\.md$/i.test(p) ? 'text' : 'variable', apply: `${label}${close}` };
  });
  return { from, options, validFor: /^[^\]|#\n]*$/ };
}

export const vaultAutocomplete = autocompletion({
  override: [wikiCompletions, equationCompletions],
  icons: false,
  activateOnTyping: true,
  maxRenderedOptions: 60,
});
