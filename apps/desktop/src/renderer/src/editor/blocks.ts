/**
 * Block-level live preview: display math (numbered), frontmatter, tables, note embeds
 * alone on a line, and fenced blocks with a registered renderer. Block decorations
 * must come from a state field; they are rebuilt when the document, the parse tree,
 * the set of active blocks, or the link targets change.
 */
import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Range, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { analyzeNote, parseInfoString, splitTarget } from '@vaults/markdown';
import { editorContext, refreshLinks, revealSource } from './context';
import { renderInline } from './inline';
import { embedAloneOnLine, rangeActive } from './livePreview';
import { blockRegistry } from './registry';
import { DisplayMathWidget, PropertiesWidget, TableWidget, WarningWidget } from './widgets';
import { NoteEmbedWidget, PluginBlockWidget } from './embeds';
import { equationField } from './equations';

/** Block nodes that can contain the blocks handled here. */
const CONTAINERS = new Set(['Document', 'BulletList', 'OrderedList', 'ListItem', 'Blockquote']);

interface BlockInfo {
  kind: 'math' | 'frontmatter' | 'table' | 'embed' | 'plugin';
  from: number;
  to: number;
}

function lineAligned(state: EditorState, from: number, to: number): { from: number; to: number } | null {
  const a = state.doc.lineAt(from);
  const b = state.doc.lineAt(to);
  if (state.doc.sliceString(a.from, from).trim() !== '' || state.doc.sliceString(to, b.to).trim() !== '')
    return null;
  return { from: a.from, to: b.to };
}

function tableRows(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(trimmed)) continue; // delimiter row
    const body = trimmed.replace(/^\|/, '').replace(/\|$/, '');
    const cells: string[] = [];
    let cur = '';
    for (let i = 0; i < body.length; i++) {
      const c = body[i]!;
      if (c === '\\' && body[i + 1] === '|') {
        cur += '\\|';
        i++;
      } else if (c === '|') {
        cells.push(cur.trim());
        cur = '';
      } else cur += c;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

function build(state: EditorState): DecorationSet {
  const ctx = state.facet(editorContext);
  const tree = syntaxTree(state);
  const decos: Range<Decoration>[] = [];
  const mathBlocks: Array<{ from: number; to: number; tex: string; label: string | null }> = [];
  const others: BlockInfo[] = [];

  tree.iterate({
    enter: (node) => {
      switch (node.name) {
        case 'MathBlock': {
          const n = node.node;
          const c = n.getChild('MathContent');
          const l = n.getChild('EquationLabel');
          mathBlocks.push({
            from: node.from,
            to: node.to,
            tex: c ? state.doc.sliceString(c.from, c.to).trim() : '',
            label: l ? state.doc.sliceString(l.from + 2, l.to - 1) : null,
          });
          return false;
        }
        case 'Frontmatter':
          others.push({ kind: 'frontmatter', from: node.from, to: node.to });
          return false;
        case 'Table':
          others.push({ kind: 'table', from: node.from, to: node.to });
          return false;
        case 'Paragraph': {
          // Only paragraphs that are a single embed matter here; never descend into inline content.
          for (const e of node.node.getChildren('Embed')) {
            if (embedAloneOnLine(state, e.from, e.to)) others.push({ kind: 'embed', from: e.from, to: e.to });
          }
          return false;
        }
        case 'FencedCode': {
          const info = node.node.getChild('CodeInfo');
          const lang = info
            ? state.doc.sliceString(info.from, info.to).trim().split(/\s+/)[0]?.toLowerCase()
            : '';
          if (lang && blockRegistry.get(lang)) others.push({ kind: 'plugin', from: node.from, to: node.to });
          return false;
        }
        default:
          return CONTAINERS.has(node.name);
      }
    },
  });

  // Numbers come from the equation field (shared with references and autocomplete).
  const eqs = state.field(equationField, false) ?? [];
  const numberAt = new Map(eqs.map((e) => [e.from, e] as const));
  mathBlocks.forEach((m) => {
    const eq = numberAt.get(m.from);
    const aligned = lineAligned(state, m.from, m.to);
    // A duplicate label warns on its second occurrence (SPECS 10.4), active or not.
    if (eq?.duplicate && m.label) {
      decos.push(
        Decoration.widget({
          widget: new WarningWidget(
            `Duplicate label ${m.label}: references go to the first equation with it.`,
          ),
          block: true,
          side: 1,
        }).range(aligned ? aligned.to : m.to),
      );
    }
    if (rangeActive(state, m.from, m.to)) return;
    const widget = new DisplayMathWidget(m.tex, eq?.number ?? null, m.label, m.from);
    if (aligned) decos.push(Decoration.replace({ widget, block: true }).range(aligned.from, aligned.to));
    else decos.push(Decoration.replace({ widget }).range(m.from, m.to));
  });

  for (const b of others) {
    const active = rangeActive(state, b.from, b.to);
    if (b.kind === 'frontmatter') {
      const fm = analyzeNote(state.doc.sliceString(0, b.to) + '\n').frontmatter;
      if (!fm) continue;
      if (fm.error) {
        // Invalid YAML: always shown as source, with a warning (SPECS 10.6).
        decos.push(
          Decoration.widget({
            widget: new WarningWidget(`${fm.error} The frontmatter is shown as written and never rewritten.`),
            block: true,
            side: -1,
          }).range(b.from),
        );
        continue;
      }
      if (active) continue;
      decos.push(
        Decoration.replace({ widget: new PropertiesWidget(fm.data ?? {}, b.from), block: true }).range(
          b.from,
          state.doc.lineAt(b.to).to,
        ),
      );
      continue;
    }
    if (active) continue;
    const aligned = lineAligned(state, b.from, b.to);
    if (!aligned) continue;
    if (b.kind === 'table') {
      const rows = tableRows(state.doc.sliceString(aligned.from, aligned.to));
      decos.push(
        Decoration.replace({
          widget: new TableWidget(rows, b.from, (t) => renderInline(t, ctx)),
          block: true,
        }).range(aligned.from, aligned.to),
      );
    } else if (b.kind === 'embed') {
      const text = state.doc.sliceString(b.from, b.to);
      const m = /^!\[\[([^\]|]*)(?:\|[^\]]*)?\]\]$/.exec(text);
      if (!m) continue;
      const parts = splitTarget(m[1]!);
      const res = ctx.resolve(parts.target);
      if (!res.path || !/\.md$/i.test(res.path)) continue;
      decos.push(
        Decoration.replace({
          widget: new NoteEmbedWidget(res.path, parts.heading, parts.target),
          block: true,
        }).range(aligned.from, aligned.to),
      );
    } else if (b.kind === 'plugin') {
      const node = tree.resolveInner(b.from, 1);
      const code = node.name === 'FencedCode' ? node : node.parent;
      const info = code?.getChild('CodeInfo');
      const infoText = info ? state.doc.sliceString(info.from, info.to) : '';
      const parsed = parseInfoString(infoText);
      const firstLineEnd = state.doc.lineAt(b.from).to;
      const lastLine = state.doc.lineAt(b.to);
      const closes =
        /^\s*(`{3,}|~{3,})\s*$/.test(lastLine.text) && lastLine.number > state.doc.lineAt(b.from).number;
      const bodyFrom = Math.min(firstLineEnd + 1, b.to);
      const bodyTo = closes ? Math.max(bodyFrom, lastLine.from - 1) : b.to;
      decos.push(
        Decoration.replace({
          widget: new PluginBlockWidget(
            parsed.language,
            infoText,
            parsed.args,
            state.doc.sliceString(bodyFrom, bodyTo),
            b.from,
            bodyFrom,
            bodyTo,
          ),
          block: true,
        }).range(aligned.from, aligned.to),
      );
    }
  }
  return Decoration.set(decos, true);
}

/** Which blocks are active, as a cheap key, to skip rebuilding on unrelated cursor moves. */
function activeKey(state: EditorState): string {
  if (!state.facet(revealSource)) return '';
  return state.selection.ranges
    .map((r) => `${state.doc.lineAt(r.from).number}-${state.doc.lineAt(r.to).number}`)
    .join(',');
}

export const blockDecorations = StateField.define<{ deco: DecorationSet; key: string; registry: number }>({
  create(state) {
    return { deco: build(state), key: activeKey(state), registry: blockRegistry.changeVersion };
  },
  update(value, tr: Transaction) {
    const key = activeKey(tr.state);
    const refresh = tr.effects.some((e) => e.is(refreshLinks));
    if (
      tr.docChanged ||
      refresh ||
      key !== value.key ||
      value.registry !== blockRegistry.changeVersion ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
      tr.startState.facet(editorContext) !== tr.state.facet(editorContext)
    ) {
      return { deco: build(tr.state), key, registry: blockRegistry.changeVersion };
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});
