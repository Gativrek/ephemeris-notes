import { CompletionContext, type Completion } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { vaultsMarkdown } from '@ephemeris-notes/markdown';
import { afterAll, describe, expect, it } from 'vitest';
import { fenceCompletions } from './fences';
import { blockRegistry } from './registry';

const off = blockRegistry.register('combo', {
  owner: 'text-to-image',
  ownerName: 'Text to Image',
  renderer: { render() {} },
});
const offStarter = blockRegistry.register('bode', {
  owner: 'control-plots',
  ownerName: 'Control Plots',
  renderer: { render() {}, starter: 'G = 1/(s+1)\nw = 0.1..10\n' },
});
afterAll(() => {
  off();
  offStarter();
});

/** The state with the cursor at `|`. */
function stateAt(doc: string): EditorState {
  const pos = doc.indexOf('|');
  const state = EditorState.create({
    doc: doc.replace('|', ''),
    selection: { anchor: pos },
    extensions: [markdown({ extensions: vaultsMarkdown })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

/** Completions with the cursor at `|`. */
function complete(doc: string, explicit = false) {
  const state = stateAt(doc);
  return fenceCompletions(new CompletionContext(state, state.selection.main.head, explicit));
}

/** The document and selected text after picking `label` with the cursor at `|`. */
function pick(doc: string, label: string): { doc: string; selected: string } {
  let state = stateAt(doc);
  const r = complete(doc)!;
  const option = r.options.find((o) => o.label === label)!;
  const view = { dispatch: (spec: TransactionSpec) => (state = state.update(spec).state) };
  (option.apply as (v: EditorView, c: Completion, from: number, to: number) => void)(
    view as unknown as EditorView,
    option,
    r.from,
    state.selection.main.head,
  );
  const { from, to } = state.selection.main;
  return { doc: state.doc.toString(), selected: state.sliceDoc(from, to) };
}

describe('fence completion', () => {
  it('offers plugin blocks first, then code languages, after ``` and a letter', () => {
    const r = complete('# Note\n\n```c|');
    expect(r).not.toBeNull();
    expect(r!.from).toBe('# Note\n\n```'.length);
    expect(r!.options[0]).toMatchObject({ label: 'bode', detail: 'Control Plots', boost: 1 });
    expect(r!.options[1]).toMatchObject({ label: 'combo', detail: 'Text to Image', boost: 1 });
    const labels = r!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(['matlab', 'python', 'c', 'cpp', 'latex']));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('works with tildes, longer fences and up to three spaces of indent', () => {
    expect(complete('~~~co|')).not.toBeNull();
    expect(complete('````co|')).not.toBeNull();
    expect(complete('   ```co|')!.from).toBe(6);
    expect(complete('    ```co|')).toBeNull();
  });

  it('stays quiet on a bare fence unless asked', () => {
    expect(complete('```|')).toBeNull();
    expect(complete('```|', true)).not.toBeNull();
  });

  it('never fires on a closing fence or inside code, math or frontmatter', () => {
    expect(complete('```combo\n5H\n```c|')).toBeNull();
    expect(complete('```python\nx = 1\n```c|\n```')).toBeNull();
    expect(complete('$$\n```c|\n$$')).toBeNull();
    expect(complete('---\ntitle: x\n```c|\n---\n')).toBeNull();
  });

  it('needs the cursor at the end of the fence line', () => {
    expect(complete('```c| later')).toBeNull();
    expect(complete('text ```c|')).toBeNull();
  });

  it('writes an empty block, or the plugin starter selected and indented like the fence', () => {
    expect(pick('```py|', 'python')).toEqual({ doc: '```python\n\n```', selected: '' });
    expect(pick('```co|', 'combo')).toEqual({ doc: '```combo\n\n```', selected: '' });
    expect(pick('```bo|', 'bode')).toEqual({
      doc: '```bode\nG = 1/(s+1)\nw = 0.1..10\n```',
      selected: 'G = 1/(s+1)\nw = 0.1..10',
    });
    expect(pick('  ~~~~bo|', 'bode')).toEqual({
      doc: '  ~~~~bode\n  G = 1/(s+1)\n  w = 0.1..10\n  ~~~~',
      selected: 'G = 1/(s+1)\n  w = 0.1..10',
    });
  });

  it('offers again after a closed block', () => {
    expect(complete('```combo\n5H\n```\n\n```co|')).not.toBeNull();
  });
});
