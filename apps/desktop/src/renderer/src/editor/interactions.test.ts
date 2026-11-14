import { EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { linkApply } from './interactions';

/** Applies a link completion over the text after `[[` up to the cursor at `|`. */
function apply(doc: string, label: string): string {
  const at = doc.indexOf('|');
  let state = EditorState.create({ doc: doc.replace('|', ''), selection: { anchor: at } });
  const view = {
    get state() {
      return state;
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  const from = Math.max(doc.lastIndexOf('[[', at) + 2, doc.lastIndexOf('#', at) + 1);
  linkApply(label)(view, { label }, from, at);
  const head = state.selection.main.head;
  const text = state.doc.toString();
  return `${text.slice(0, head)}|${text.slice(head)}`;
}

describe('link completions (SPECS 5)', () => {
  it('closes the link and puts the cursor after it', () => {
    expect(apply('See [[Kal|', 'Kalman Filter')).toBe('See [[Kalman Filter]]|');
  });

  it('steps over brackets that were auto-closed', () => {
    expect(apply('See [[Kal|]] here', 'Kalman Filter')).toBe('See [[Kalman Filter]]| here');
  });

  it('works for headings after #', () => {
    expect(apply('[[Note#Int|]]', 'Introduction')).toBe('[[Note#Introduction]]|');
  });
});
