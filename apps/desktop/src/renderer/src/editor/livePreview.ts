/**
 * Live preview (SPECS 10.1): inactive lines render formatted; the line or block that
 * holds the cursor (or any selection) shows its source. Inline decorations for the
 * visible ranges; block-level replacements live in blocks.ts.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';
import { splitTarget } from '@ephemeris-notes/markdown';
import { editorContext, refreshLinks, revealSource } from './context';
import { isCodeLanguage } from './languages';
import { blockRegistry } from './registry';
import { EqRefWidget, equationByLabel, formatRef } from './equations';
import { PdfPageWidget } from './pdfWidget';
import {
  CheckboxWidget,
  CodeBarWidget,
  EmptyWidget,
  HrWidget,
  IMAGE_EXT,
  ImageWidget,
  InlineMathWidget,
  LinkWidget,
  VIDEO_EXT,
  VideoWidget,
} from './widgets';

const hide = Decoration.replace({});
const mark = (cls: string, attrs?: Record<string, string>) =>
  Decoration.mark({ class: cls, ...(attrs ? { attributes: attrs } : {}) });
const lineDeco = (cls: string, attrs?: Record<string, string>) =>
  Decoration.line({ class: cls, ...(attrs ? { attributes: attrs } : {}) });

const HEADING = /^(ATX|Setext)Heading([1-6])$/;

/** Line numbers (1-based) touched by the selection. Empty when source is never revealed. */
export function activeLines(state: EditorState): Set<number> {
  const out = new Set<number>();
  if (!state.facet(revealSource)) return out;
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return out;
}

/**
 * True when any selection range touches the lines of [from, to]: the line or block that
 * holds the cursor shows its source (SPECS 10.1), including text after a block on its
 * last line.
 */
export function rangeActive(state: EditorState, from: number, to: number): boolean {
  if (!state.facet(revealSource)) return false;
  const a = state.doc.lineAt(from).from;
  const b = state.doc.lineAt(to).to;
  return state.selection.ranges.some((r) => r.from <= b && r.to >= a);
}

/** Position of the first level-1 heading, which takes the note-title style. */
function firstTitleHeading(state: EditorState): number {
  const tree = syntaxTree(state);
  for (let c = tree.topNode.firstChild; c; c = c.nextSibling) {
    if (c.name === 'ATXHeading1' || c.name === 'SetextHeading1') return c.from;
    if (c.name !== 'Frontmatter' && c.name !== 'BlankLine') {
      // Body text before the first heading: a later H1 is still the title (Obsidian-like).
      continue;
    }
  }
  return -1;
}

/** An embed that is alone on its line renders as a block (blocks.ts), not inline. */
export function embedAloneOnLine(state: EditorState, from: number, to: number): boolean {
  const line = state.doc.lineAt(from);
  return line.text.slice(0, from - line.from).trim() === '' && line.text.slice(to - line.from).trim() === '';
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const ctx = state.facet(editorContext);
  const active = activeLines(state);
  const isActiveAt = (pos: number) => active.has(state.doc.lineAt(pos).number);
  const decos: Range<Decoration>[] = [];
  const titleAt = firstTitleHeading(state);
  const tree = syntaxTree(state);

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node: SyntaxNodeRef) => {
        const name = node.name;
        const nf = node.from;
        const nt = node.to;

        // Block-level replacements are drawn by blocks.ts when inactive.
        if (name === 'MathBlock' || name === 'Frontmatter') {
          if (name === 'MathBlock' && rangeActive(state, nf, nt)) {
            for (let l = state.doc.lineAt(nf).number; l <= state.doc.lineAt(nt).number; l++) {
              decos.push(lineDeco('vx-math-src').range(state.doc.line(l).from));
            }
          }
          if (name === 'Frontmatter' && rangeActive(state, nf, nt)) {
            for (let l = state.doc.lineAt(nf).number; l <= state.doc.lineAt(nt).number; l++) {
              decos.push(lineDeco('vx-cm-meta').range(state.doc.line(l).from));
            }
          }
          return false;
        }
        if (name === 'Table' && !rangeActive(state, nf, nt)) return false;

        const heading = HEADING.exec(name);
        if (heading) {
          const level = Number(heading[2]);
          const cls = level === 1 && nf === titleAt ? 'vx-cm-title' : `vx-cm-h${level}`;
          decos.push(lineDeco(cls).range(state.doc.lineAt(nf).from));
          if (heading[1] === 'Setext') decos.push(lineDeco(cls).range(state.doc.lineAt(nt).from));
          return true;
        }

        switch (name) {
          case 'HeaderMark': {
            if (isActiveAt(nf)) {
              decos.push(mark('vx-cm-mark').range(nf, nt));
              return false;
            }
            const line = state.doc.lineAt(nf);
            // `# ` at the start (and an optional closing `#` run); the setext underline line.
            const end = Math.min(line.to, nt + (state.doc.sliceString(nt, nt + 1) === ' ' ? 1 : 0));
            if (end > nf) decos.push(hide.range(nf, end));
            return false;
          }
          case 'Blockquote':
            for (let l = state.doc.lineAt(nf).number; l <= state.doc.lineAt(nt).number; l++) {
              decos.push(lineDeco('vx-cm-quote').range(state.doc.line(l).from));
            }
            return true;
          case 'QuoteMark':
            if (!isActiveAt(nf)) {
              const after = state.doc.sliceString(nt, nt + 1) === ' ' ? nt + 1 : nt;
              decos.push(hide.range(nf, after));
            } else decos.push(mark('vx-cm-mark').range(nf, nt));
            return false;
          case 'StrongEmphasis':
            decos.push(mark('vx-cm-strong').range(nf, nt));
            return true;
          case 'Emphasis':
            decos.push(mark('vx-cm-em').range(nf, nt));
            return true;
          case 'Strikethrough':
            decos.push(mark('vx-cm-strike').range(nf, nt));
            return true;
          case 'EmphasisMark':
          case 'StrikethroughMark':
            decos.push((isActiveAt(nf) ? mark('vx-cm-mark') : hide).range(nf, nt));
            return false;
          case 'InlineCode': {
            decos.push(mark('vx-cm-code').range(nf, nt));
            if (!isActiveAt(nf)) {
              const marks = node.node.getChildren('CodeMark');
              for (const m of marks) decos.push(hide.range(m.from, m.to));
            }
            return false;
          }
          case 'Escape':
            if (!isActiveAt(nf)) decos.push(hide.range(nf, nf + 1));
            return false;
          case 'HorizontalRule':
            if (!isActiveAt(nf)) decos.push(Decoration.replace({ widget: new HrWidget() }).range(nf, nt));
            else decos.push(mark('vx-cm-mark').range(nf, nt));
            return false;
          case 'ListMark':
            decos.push(mark('vx-cm-mark').range(nf, nt));
            return false;
          case 'TaskMarker': {
            const sel = state.selection.main;
            const inside = state.facet(revealSource) && sel.from <= nt && sel.to >= nf;
            const checked = /x/i.test(state.doc.sliceString(nf + 1, nf + 2));
            if (!inside)
              decos.push(Decoration.replace({ widget: new CheckboxWidget(checked, nf) }).range(nf, nt));
            if (checked) {
              const line = state.doc.lineAt(nf);
              if (nt + 1 < line.to) decos.push(mark('vx-cm-task-done').range(nt + 1, line.to));
            }
            return false;
          }
          case 'Tag':
            decos.push(mark('vx-cm-tag').range(nf, nt));
            return false;
          case 'BlockId':
            decos.push(mark('vx-cm-blockid').range(nf, nt));
            return false;
          case 'CrossRef': {
            const text = state.doc.sliceString(nf, nt);
            // Equation references render as "Eq. (3)"; @fig: and @tbl: stay reserved text.
            if (text.startsWith('@eq:') && !isActiveAt(nf)) {
              const label = text.slice(1);
              const eq = equationByLabel(state, label);
              decos.push(
                Decoration.replace({
                  widget: new EqRefWidget(label, formatRef(eq?.number ?? null, ctx.refFormat), !eq),
                }).range(nf, nt),
              );
            } else decos.push(mark('vx-cm-link').range(nf, nt));
            return false;
          }
          case 'HTMLTag':
          case 'HTMLBlock':
          case 'Comment':
          case 'CommentBlock':
          case 'ProcessingInstructionBlock':
            decos.push(mark('vx-cm-html').range(nf, nt));
            return false;
          case 'InlineMath': {
            const content = node.node.getChild('MathContent');
            const marks = node.node.getChildren('MathMark');
            const display = marks.length > 0 && marks[0]!.to - marks[0]!.from === 2;
            if (!isActiveAt(nf) && content) {
              decos.push(
                Decoration.replace({
                  widget: new InlineMathWidget(state.doc.sliceString(content.from, content.to), display),
                }).range(nf, nt),
              );
            } else decos.push(mark('vx-math-src').range(nf, nt));
            return false;
          }
          case 'WikiLink':
          case 'Embed': {
            const n = node.node;
            const t = n.getChild('WikiLinkTarget');
            const a = n.getChild('WikiLinkAlias');
            const raw = t ? state.doc.sliceString(t.from, t.to) : '';
            const parts = splitTarget(raw);
            const res = ctx.resolve(parts.target);
            const embed = name === 'Embed';
            if (isActiveAt(nf)) {
              const marks = n.getChildren('WikiLinkMark');
              for (const m of marks) decos.push(mark('vx-cm-mark').range(m.from, m.to));
              const em = n.getChild('EmbedMark');
              if (em) decos.push(mark('vx-cm-mark').range(em.from, em.to));
              if (t) {
                decos.push(
                  mark(res.path ? 'vx-cm-link' : 'vx-cm-link vx-cm-link--missing', {
                    'data-vx-link': '1',
                    'data-target': parts.target,
                    ...(res.path ? { 'data-path': res.path } : {}),
                    ...(parts.heading ? { 'data-heading': parts.heading } : {}),
                    ...(parts.page !== null ? { 'data-page': String(parts.page) } : {}),
                  }).range(t.from, t.to),
                );
              }
              return false;
            }
            const alias = a ? state.doc.sliceString(a.from, a.to) : null;
            if (embed && res.path) {
              const width =
                alias && /^\d+(x\d+)?$/.test(alias.trim()) ? Number(alias.trim().split('x')[0]) : null;
              if (IMAGE_EXT.test(res.path)) {
                decos.push(
                  Decoration.replace({
                    widget: new ImageWidget(ctx.assetUrl(res.path), parts.target, width),
                  }).range(nf, nt),
                );
                return false;
              }
              if (/\.pdf$/i.test(res.path)) {
                decos.push(
                  Decoration.replace({ widget: new PdfPageWidget(res.path, parts.page, parts.target) }).range(
                    nf,
                    nt,
                  ),
                );
                return false;
              }
              if (VIDEO_EXT.test(res.path)) {
                decos.push(
                  Decoration.replace({ widget: new VideoWidget(ctx.assetUrl(res.path), width) }).range(
                    nf,
                    nt,
                  ),
                );
                return false;
              }
              // A note or PDF embed alone on its line is a block (blocks.ts).
              if (embedAloneOnLine(state, nf, nt) && /\.md$/i.test(res.path)) return false;
            }
            const shown =
              alias ??
              (parts.heading
                ? `${parts.target} › ${parts.heading}`
                : parts.page !== null
                  ? `${parts.target}, page ${parts.page}`
                  : parts.target);
            decos.push(
              Decoration.replace({
                widget: new LinkWidget({
                  text: shown || raw,
                  target: parts.target,
                  heading: parts.heading,
                  block: parts.block,
                  page: parts.page,
                  path: res.path,
                  candidates: res.candidates,
                  pdf: /\.pdf$/i.test(res.path ?? parts.target),
                }),
              }).range(nf, nt),
            );
            return false;
          }
          case 'Link':
          case 'Image': {
            const n = node.node;
            const marks = n.getChildren('LinkMark');
            const url = n.getChild('URL');
            const href = url ? state.doc.sliceString(url.from, url.to).replace(/^<|>$/g, '') : '';
            const external = /^[a-z][a-z0-9+.-]*:/i.test(href);
            if (isActiveAt(nf) || marks.length < 2) {
              if (url) decos.push(mark('vx-cm-url').range(url.from, url.to));
              return true;
            }
            const textFrom = marks[0]!.to;
            const textTo = marks[1]!.from;
            if (name === 'Image' && !external) {
              let decoded = href;
              try {
                decoded = decodeURI(href);
              } catch {
                // Keep the raw href.
              }
              const res = ctx.resolve(decoded);
              if (res.path && IMAGE_EXT.test(res.path)) {
                decos.push(
                  Decoration.replace({
                    widget: new ImageWidget(
                      ctx.assetUrl(res.path),
                      state.doc.sliceString(textFrom, textTo),
                      null,
                    ),
                  }).range(nf, nt),
                );
                return false;
              }
            }
            let attrs: Record<string, string>;
            let cls = 'vx-cm-link';
            if (external) attrs = { 'data-vx-link': '1', 'data-href': href };
            else {
              let decoded = href;
              try {
                decoded = decodeURI(href);
              } catch {
                // Keep the raw href.
              }
              const parts = splitTarget(decoded);
              const res = ctx.resolve(parts.target);
              if (!res.path) cls += ' vx-cm-link--missing';
              attrs = {
                'data-vx-link': '1',
                'data-target': parts.target,
                ...(res.path ? { 'data-path': res.path } : {}),
                ...(parts.heading ? { 'data-heading': parts.heading } : {}),
              };
            }
            decos.push(hide.range(nf, textFrom));
            if (textTo > textFrom) decos.push(mark(cls, attrs).range(textFrom, textTo));
            decos.push(hide.range(textTo, nt));
            return false;
          }
          case 'URL':
            // Bare autolinks.
            if (
              node.node.parent?.name === 'Autolink' ||
              node.node.parent?.name === 'Document' ||
              node.node.parent?.name === 'Paragraph'
            ) {
              decos.push(
                mark('vx-cm-link', { 'data-vx-link': '1', 'data-href': state.doc.sliceString(nf, nt) }).range(
                  nf,
                  nt,
                ),
              );
            }
            return false;
          case 'FencedCode':
            codeBlock(state, node, decos);
            return false;
          default:
            return true;
        }
      },
    });
  }
  return Decoration.set(decos, true);
}

/** Code lines styled as the CodeBlock card; the fences become a bar when inactive. */
function codeBlock(state: EditorState, node: SyntaxNodeRef, decos: Range<Decoration>[]): void {
  const n = node.node;
  const info = n.getChild('CodeInfo');
  const infoText = info ? state.doc.sliceString(info.from, info.to) : '';
  const lang = infoText.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const active = rangeActive(state, node.from, node.to);
  // Registered renderers draw the whole block when inactive (blocks.ts).
  if (!active && lang && blockRegistry.get(lang)) return;
  const first = state.doc.lineAt(node.from);
  const last = state.doc.lineAt(node.to);
  const marks = n.getChildren('CodeMark');
  const closed = marks.length > 1 && state.doc.lineAt(marks[marks.length - 1]!.from).number > first.number;
  const bodyEndLine = closed ? last.number - 1 : last.number;
  let ln = 1;
  for (let l = first.number; l <= last.number; l++) {
    const line = state.doc.line(l);
    const isFence = l === first.number || (closed && l === last.number);
    const classes = ['vx-cm-codeline'];
    if (l === first.number) classes.push('vx-cm-codeline--first');
    if (l === last.number) classes.push('vx-cm-codeline--last');
    if (isFence) classes.push('vx-cm-codeline--fence');
    decos.push(
      lineDeco(classes.join(' '), isFence ? undefined : { 'data-ln': String(ln++) }).range(line.from),
    );
  }
  if (!active) {
    const name = infoText.trim().split(/\s+/).slice(1).join(' ');
    const body =
      first.number + 1 <= bodyEndLine
        ? state.doc.sliceString(state.doc.line(first.number + 1).from, state.doc.line(bodyEndLine).to)
        : '';
    let label = lang ? lang.toUpperCase() : '';
    if (lang && !isCodeLanguage(lang)) label = `${lang.toUpperCase()} · No renderer for \`${lang}\``;
    decos.push(
      Decoration.replace({ widget: new CodeBarWidget(label, name, body) }).range(first.from, first.to),
    );
    if (closed && last.to > last.from)
      decos.push(Decoration.replace({ widget: new EmptyWidget() }).range(last.from, last.to));
  }
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private registryVersion = blockRegistry.changeVersion;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      const lines = (s: EditorState) => [...activeLines(s)].join(',');
      const refresh = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLinks)));
      if (
        u.docChanged ||
        u.viewportChanged ||
        refresh ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        this.registryVersion !== blockRegistry.changeVersion ||
        (u.selectionSet && lines(u.startState) !== lines(u.state)) ||
        u.startState.facet(editorContext) !== u.state.facet(editorContext)
      ) {
        this.registryVersion = blockRegistry.changeVersion;
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
