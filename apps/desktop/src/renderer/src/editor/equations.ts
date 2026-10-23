/**
 * Equation numbers and references (SPECS 10.3, 10.4): one field holds every display
 * equation of the note with its number and label, recomputed with the parse tree.
 * References render as "Eq. (3)", "(3)" or "Equation 3"; unknown labels as "Eq. (?)".
 */
import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { numberEquations } from '@ephemeris-notes/markdown';
import { editorContext, refreshLinks } from './context';
import { renderMath } from './math';

export interface EquationEntry {
  from: number;
  to: number;
  tex: string;
  label: string | null;
  number: string | null;
  /** True for the second and later uses of a label. */
  duplicate: boolean;
}

export type RefFormat = 'eq' | 'paren' | 'word';

function compute(state: EditorState): EquationEntry[] {
  const list: Array<Omit<EquationEntry, 'number' | 'duplicate'>> = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'MathBlock') return !['FencedCode', 'Paragraph', 'Frontmatter'].includes(node.name);
      const c = node.node.getChild('MathContent');
      const l = node.node.getChild('EquationLabel');
      list.push({
        from: node.from,
        to: node.to,
        tex: c ? state.doc.sliceString(c.from, c.to).trim() : '',
        label: l ? state.doc.sliceString(l.from + 2, l.to - 1) : null,
      });
      return false;
    },
  });
  const numbers = numberEquations(list, state.facet(editorContext).numbering);
  const seen = new Set<string>();
  return list.map((e, i) => {
    const duplicate = !!e.label && seen.has(e.label);
    if (e.label) seen.add(e.label);
    return { ...e, number: numbers[i] ?? null, duplicate };
  });
}

export const equationField = StateField.define<EquationEntry[]>({
  create: compute,
  update(value, tr) {
    if (
      tr.docChanged ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
      tr.effects.some((e) => e.is(refreshLinks))
    )
      return compute(tr.state);
    return value;
  },
});

export function equationByLabel(state: EditorState, label: string): EquationEntry | null {
  return state.field(equationField, false)?.find((e) => e.label === label && !e.duplicate) ?? null;
}

export function formatRef(number: string | null, format: RefFormat): string {
  const n = number ?? '?';
  if (format === 'paren') return `(${n})`;
  if (format === 'word') return `Equation ${n}`;
  return `Eq. (${n})`;
}

/** Scrolls to an equation and flashes it (SPECS 10.4). */
export function revealEquation(view: EditorView, eq: EquationEntry): void {
  view.dispatch({ effects: EditorView.scrollIntoView(eq.from, { y: 'center' }) });
  requestAnimationFrame(() => {
    const el = view.dom.querySelector<HTMLElement>(`.vx-math[data-from="${eq.from}"]`);
    if (!el) return;
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
  });
}

export class EqRefWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly text: string,
    readonly missing: boolean,
  ) {
    super();
  }
  override eq(o: EqRefWidget): boolean {
    return o.label === this.label && o.text === this.text && o.missing === this.missing;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span');
    el.className = this.missing ? 'vx-cm-link vx-cm-link--missing vx-eqref' : 'vx-cm-link vx-eqref';
    el.textContent = this.text;
    el.dataset.eqref = this.label;
    el.title = this.missing ? `No equation labeled ${this.label} in this note` : this.label;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const eq = equationByLabel(view.state, this.label);
      if (eq) revealEquation(view, eq);
    });
    return el;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** `@eq:` autocomplete: the note's labels, with a KaTeX preview. */
export function equationCompletions(cx: CompletionContext): CompletionResult | null {
  const before = cx.matchBefore(/(^|[\s([])@eq:[A-Za-z0-9_:-]*$/);
  if (!before) return null;
  const at = before.text.indexOf('@eq:');
  const from = before.from + at + 4;
  const eqs = cx.state.field(equationField, false) ?? [];
  const macros = cx.state.facet(editorContext).macros;
  return {
    from,
    validFor: /^[A-Za-z0-9_:-]*$/,
    options: eqs
      .filter((e) => e.label && !e.duplicate)
      .map((e) => ({
        label: e.label!.slice(3),
        detail: e.number ? `(${e.number})` : '',
        type: 'constant',
        info: () => {
          const box = document.createElement('div');
          box.className = 'vx-eq-preview';
          box.append(renderMath(e.tex, true, macros));
          return box;
        },
      })),
  };
}
