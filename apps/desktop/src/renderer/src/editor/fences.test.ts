import { CompletionContext, type Completion } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { vaultsMarkdown } from '@ephemeris-notes/markdown';
import { afterAll, describe, expect, it } from 'vitest';
import { closedFence, fenceCompletions, insertCodeBlock } from './fences';
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

/** The state with the cursor at `|`, or the selection between two `|`. */
function stateAt(doc: string): EditorState {
  const a = doc.indexOf('|');
  const b = doc.indexOf('|', a + 1);
  const state = EditorState.create({
    doc: doc.replaceAll('|', ''),
    selection: b < 0 ? { anchor: a } : { anchor: a, head: b - 1 },
    extensions: [markdown({ extensions: vaultsMarkdown }), closedFence],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

/** A stand-in view: enough for dispatching and reading state. */
function fakeView(start: EditorState): EditorView & { current: EditorState } {
  const v = {
    current: start,
    get state() {
      return v.current;
    },
    dispatch: (spec: TransactionSpec) => {
      v.current = v.current.update(spec).state;
      ensureSyntaxTree(v.current, v.current.doc.length, 5000);
    },
    focus: () => undefined,
  };
  return v as unknown as EditorView & { current: EditorState };
}

/** Completions with the cursor at `|`. */
function complete(doc: string | EditorState, explicit = false) {
  const state = typeof doc === 'string' ? stateAt(doc) : doc;
  return fenceCompletions(new CompletionContext(state, state.selection.main.head, explicit));
}

/** Picks `label` from the completions in the view's state. */
function pickIn(view: EditorView & { current: EditorState }, label: string, explicit = false): void {
  const r = complete(view.current, explicit)!;
  const option = r.options.find((o) => o.label === label)!;
  (option.apply as (v: EditorView, c: Completion, from: number, to: number) => void)(
    view,
    option,
    r.from,
    view.current.selection.main.head,
  );
}

const result = (s: EditorState) => {
  const { from, to } = s.selection.main;
  return { doc: s.doc.toString(), selected: s.sliceDoc(from, to) };
};

/** The document and selected text after picking `label` with the cursor at `|`. */
function pick(doc: string, label: string): { doc: string; selected: string } {
  const view = fakeView(stateAt(doc));
  pickIn(view, label);
  return result(view.current);
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

describe('Insert Code Block', () => {
  it('writes a fence on a blank line and lists the languages', () => {
    const view = fakeView(stateAt('Text\n\n|\nMore'));
    expect(insertCodeBlock(view)).toBe(true);
    expect(result(view.current)).toEqual({ doc: 'Text\n\n```\nMore', selected: '' });
    expect(view.current.selection.main.head).toBe('Text\n\n```'.length);
    expect(complete(view.current, true)?.options.length).toBeGreaterThan(10);
    pickIn(view, 'python', true);
    expect(view.current.doc.toString()).toBe('Text\n\n```python\n\n```\nMore');
  });

  it('puts the fence on a new line below text', () => {
    const view = fakeView(stateAt('Some te|xt'));
    insertCodeBlock(view);
    expect(view.current.doc.toString()).toBe('Some text\n```');
  });

  it('wraps the selected lines, and then writes only the language', () => {
    const view = fakeView(stateAt('Intro\n|x = 1\ny = 2|\nEnd'));
    insertCodeBlock(view);
    expect(view.current.doc.toString()).toBe('Intro\n```\nx = 1\ny = 2\n```\nEnd');
    pickIn(view, 'python', true);
    expect(result(view.current)).toEqual({ doc: 'Intro\n```python\nx = 1\ny = 2\n```\nEnd', selected: '' });
    // Done: a fence typed later is a new block again.
    expect(view.current.field(closedFence)).toBeNull();
  });

  it('keeps the indent of a list item', () => {
    const view = fakeView(stateAt('- item\n  |'));
    insertCodeBlock(view);
    expect(view.current.doc.toString()).toBe('- item\n  ```');
  });

  it('does nothing in a read-only note', () => {
    const view = fakeView(EditorState.create({ doc: 'x', extensions: [EditorState.readOnly.of(true)] }));
    expect(insertCodeBlock(view)).toBe(false);
  });
});
