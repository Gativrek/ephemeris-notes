/**
 * Fence completion (SPECS 10.5): after an opening ``` (or ~~~) and the first letters of
 * a language, suggest block languages (plugins first) and code languages. Picking one
 * writes the language, an empty line (or the plugin's starter body, selected) and the
 * matching closing fence, with the cursor on the empty line.
 */
import {
  pickedCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { codeLanguages } from './languages';
import { blockRegistry } from './registry';

const OPENING = /^( {0,3})(`{3,}|~{3,})([\w+.#-]*)$/;
/** Inside these, a fence line is content (or closes the block), never a new block. */
const CONTENT = new Set(['FencedCode', 'CodeBlock', 'MathBlock', 'Frontmatter']);

/**
 * The opening fence that Insert Code Block wrapped around a selection, whose closing
 * fence already exists: picking a language there writes only the language. Mapped
 * through edits, and dropped once that line is no longer a bare opening fence.
 */
const markClosed = StateEffect.define<number | null>();
export const closedFence = StateField.define<number | null>({
  create: () => null,
  update(at, tr) {
    for (const e of tr.effects) if (e.is(markClosed)) return e.value;
    if (at === null || !tr.docChanged) return at;
    const pos = tr.changes.mapPos(at, -1);
    return OPENING.test(tr.state.doc.lineAt(pos).text) ? tr.state.doc.lineAt(pos).from : null;
  },
});

/**
 * Insert Code Block (SPECS 10.5): writes an opening fence and lists the languages, so a
 * block needs no backticks typed (a dead key on some layouts, ABNT2 among them). With a
 * selection, its lines are wrapped in a block first. On a line with text, the fence goes
 * on a new line below it.
 */
export function insertCodeBlock(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  const sel = state.selection.main;
  if (!sel.empty) {
    const first = state.doc.lineAt(sel.from);
    // A selection ending at the start of a line does not take that line.
    const last = state.doc.lineAt(
      sel.to > first.from && sel.to === state.doc.lineAt(sel.to).from ? sel.to - 1 : sel.to,
    );
    const indent = /^ {0,3}/.exec(first.text)![0];
    view.dispatch({
      changes: [
        { from: first.from, insert: `${indent}\`\`\`\n` },
        { from: last.to, insert: `\n${indent}\`\`\`` },
      ],
      selection: { anchor: first.from + indent.length + 3 },
      effects: markClosed.of(first.from),
      userEvent: 'input.codeblock',
    });
  } else {
    const line = state.doc.lineAt(sel.head);
    const blank = !line.text.trim();
    const indent = /^ {0,3}/.exec(line.text)![0];
    const insert = blank ? `${indent}\`\`\`` : `\n${indent}\`\`\``;
    const from = blank ? line.from : line.to;
    view.dispatch({
      changes: { from, to: line.to, insert },
      selection: { anchor: from + insert.length },
      userEvent: 'input.codeblock',
    });
  }
  view.focus();
  startCompletion(view);
  return true;
}

/** True when `pos` sits inside a block that started on an earlier line. */
function insideBlock(state: EditorState, pos: number, lineFrom: number): boolean {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent)
    if (CONTENT.has(n.name) && n.from < lineFrom) return true;
  return false;
}

export function fenceCompletions(cx: CompletionContext): CompletionResult | null {
  const line = cx.state.doc.lineAt(cx.pos);
  if (line.to !== cx.pos) return null;
  const m = OPENING.exec(line.text);
  if (!m) return null;
  const [, indent = '', fence = '', typed = ''] = m;
  // A bare fence lists languages only when asked, so Enter after ``` stays a new line.
  if (!typed && !cx.explicit) return null;
  if (insideBlock(cx.state, cx.pos, line.from)) return null;

  const from = line.from + indent.length + fence.length;
  const apply =
    (lang: string, starter = '') =>
    (view: EditorView, completion: Completion, start: number, end: number): void => {
      // A wrapped selection already has its body and closing fence: only the language.
      if (view.state.field(closedFence, false) === view.state.doc.lineAt(start).from) {
        view.dispatch({
          changes: { from: start, to: end, insert: lang },
          selection: { anchor: start + lang.length },
          annotations: pickedCompletion.of(completion),
          effects: markClosed.of(null),
          userEvent: 'input.complete',
        });
        return;
      }
      // A plugin's starter body is indented like the fence and selected, so typing replaces it.
      const body = starter
        .replace(/\n+$/, '')
        .split('\n')
        .map((l) => (l ? indent + l : l))
        .join('\n');
      const bodyFrom = start + lang.length + 1;
      view.dispatch({
        changes: { from: start, to: end, insert: `${lang}\n${body}\n${indent}${fence}` },
        selection: { anchor: bodyFrom + (body ? indent.length : 0), head: bodyFrom + body.length },
        annotations: pickedCompletion.of(completion),
        userEvent: 'input.complete',
      });
    };
  const options: Completion[] = [];
  const seen = new Set<string>();
  for (const [lang, entry] of blockRegistry.entries()) {
    seen.add(lang);
    options.push({
      label: lang,
      detail: entry.ownerName ?? entry.owner,
      type: 'class',
      boost: 1,
      apply: apply(lang, entry.renderer.starter),
    });
  }
  for (const d of codeLanguages) {
    const lang = d.alias[0] ?? d.name.toLowerCase();
    if (seen.has(lang)) continue;
    seen.add(lang);
    options.push({ label: lang, detail: d.name, type: 'type', apply: apply(lang) });
  }
  return { from, options, validFor: /^[\w+.#-]*$/ };
}
