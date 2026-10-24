/**
 * Fence completion (SPECS 10.5): after an opening ``` (or ~~~) and the first letters of
 * a language, suggest block languages (plugins first) and code languages. Picking one
 * writes the language, an empty line and the matching closing fence, with the cursor on
 * the empty line.
 */
import {
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { codeLanguages } from './languages';
import { blockRegistry } from './registry';

const OPENING = /^( {0,3})(`{3,}|~{3,})([\w+.#-]*)$/;
/** Inside these, a fence line is content (or closes the block), never a new block. */
const CONTENT = new Set(['FencedCode', 'CodeBlock', 'MathBlock', 'Frontmatter']);

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
    (lang: string) =>
    (view: EditorView, completion: Completion, start: number, end: number): void => {
      view.dispatch({
        changes: { from: start, to: end, insert: `${lang}\n\n${indent}${fence}` },
        selection: { anchor: start + lang.length + 1 },
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
      apply: apply(lang),
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
