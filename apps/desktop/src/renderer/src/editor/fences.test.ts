import { CompletionContext } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { vaultsMarkdown } from '@ephemeris-notes/markdown';
import { afterAll, describe, expect, it } from 'vitest';
import { fenceCompletions } from './fences';
import { blockRegistry } from './registry';

const off = blockRegistry.register('combo', {
  owner: 'text-to-image',
  ownerName: 'Text to Image',
  renderer: { render() {} },
});
afterAll(off);

/** Completions with the cursor at `|`. */
function complete(doc: string, explicit = false) {
  const pos = doc.indexOf('|');
  const state = EditorState.create({
    doc: doc.replace('|', ''),
    selection: { anchor: pos },
    extensions: [markdown({ extensions: vaultsMarkdown })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return fenceCompletions(new CompletionContext(state, pos, explicit));
}

describe('fence completion', () => {
  it('offers plugin blocks first, then code languages, after ``` and a letter', () => {
    const r = complete('# Note\n\n```c|');
    expect(r).not.toBeNull();
    expect(r!.from).toBe('# Note\n\n```'.length);
    expect(r!.options[0]).toMatchObject({ label: 'combo', detail: 'Text to Image', boost: 1 });
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

  it('offers again after a closed block', () => {
    expect(complete('```combo\n5H\n```\n\n```co|')).not.toBeNull();
  });
});
