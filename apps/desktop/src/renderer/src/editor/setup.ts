/**
 * Builds the note editor (SPECS 10.1): CodeMirror 6 with the shared Lezer Markdown
 * extensions, live preview, math, links, embeds, code highlighting and the keymap.
 */
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, dropCursor, keymap, type KeyBinding } from '@codemirror/view';
import { vaultsMarkdown } from '@vaults/markdown';
import { blockDecorations } from './blocks';
import { editorContext, revealSource, type EditorContext } from './context';
import { setReadOnlyFactory } from './embeds';
import { linkClicks, linkPreview, vaultAutocomplete, type ExternalOpener } from './interactions';
import { codeHighlight, findLanguage, markdownHighlight, sourceHeadingHighlight } from './languages';
import { livePreview } from './livePreview';
import { pluginInline, pluginInlineHover } from './pluginInline';
import { equationField } from './equations';

export const contextCompartment = new Compartment();
export const previewCompartment = new Compartment();
export const editableCompartment = new Compartment();
export const attrsCompartment = new Compartment();

/** Content attributes; spell check follows Settings > Editor. */
export function contentAttrs(spellcheck: boolean): Extension {
  return EditorView.contentAttributes.of({
    spellcheck: spellcheck ? 'true' : 'false',
    'aria-label': 'Note',
    autocapitalize: 'sentences',
  });
}

/** Wraps the selection in `mark` (bold `**`, italic `*`), or removes it when already wrapped. */
function toggleWrap(mark: string) {
  return (view: EditorView): boolean => {
    if (view.state.readOnly) return false;
    const n = mark.length;
    view.dispatch(
      view.state.changeByRange((range) => {
        const doc = view.state.doc;
        const before = doc.sliceString(range.from - n, range.from);
        const after = doc.sliceString(range.to, range.to + n);
        if (before === mark && after === mark) {
          return {
            changes: [
              { from: range.from - n, to: range.from, insert: '' },
              { from: range.to, to: range.to + n, insert: '' },
            ],
            range: EditorSelection.range(range.from - n, range.to - n),
          };
        }
        return {
          changes: [
            { from: range.from, insert: mark },
            { from: range.to, insert: mark },
          ],
          range: EditorSelection.range(range.from + n, range.to + n),
        };
      }),
      { userEvent: 'input.format' },
    );
    return true;
  };
}

/** `- [ ] ` ↔ `- [x] `, or turns a plain line into a task. */
export function toggleTask(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const changes = [];
  const seen = new Set<number>();
  for (const r of view.state.selection.ranges) {
    const line = view.state.doc.lineAt(r.head);
    if (seen.has(line.number)) continue;
    seen.add(line.number);
    const m = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX])\]/.exec(line.text);
    if (m) {
      const at = line.from + m[0].length - 2;
      changes.push({ from: at, to: at + 1, insert: m[3] === ' ' ? 'x' : ' ' });
    } else {
      const list = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line.text);
      if (list) changes.push({ from: line.from + list[0].length, insert: '[ ] ' });
      else {
        const indent = /^\s*/.exec(line.text)![0].length;
        changes.push({ from: line.from + indent, insert: '- [ ] ' });
      }
    }
  }
  view.dispatch({ changes, userEvent: 'input.toggleTask' });
  return true;
}

/** Editing keys that must win over CodeMirror's defaults (SPECS 11.4 notes). */
const editingKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: toggleWrap('**'), preventDefault: true },
  // Overrides CodeMirror's Mod-i (selectParentSyntax), per SPECS 11.4.
  { key: 'Mod-i', run: toggleWrap('*'), preventDefault: true },
  { key: 'Mod-Shift-x', run: toggleTask, preventDefault: true },
];

export interface EditorOptions {
  ctx: EditorContext;
  readOnly: boolean;
  /** Source mode: plain highlighted Markdown (Ctrl/Cmd+E). */
  source?: boolean;
  openExternal: ExternalOpener;
  onUpdate?: (view: EditorView, docChanged: boolean) => void;
  spellcheck?: boolean;
  extra?: Extension[];
}

/** Every key binding the note editor installs (Settings > Keyboard refuses these). */
export function editorKeyBindings(): readonly KeyBinding[] {
  return [
    ...editingKeymap,
    ...closeBracketsKeymap,
    ...completionKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...defaultKeymap,
    indentWithTab,
    ...markdownKeymap,
  ];
}

export function previewExtensions(source: boolean): Extension {
  return source
    ? [syntaxHighlighting(sourceHeadingHighlight)]
    : [livePreview, blockDecorations, pluginInline, pluginInlineHover];
}

export function editableExtensions(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

export function editorExtensions(opts: EditorOptions): Extension[] {
  return [
    contextCompartment.of(editorContext.of(opts.ctx)),
    equationField,
    markdown({ extensions: vaultsMarkdown, codeLanguages: (info) => findLanguage(info), addKeymap: true }),
    syntaxHighlighting(codeHighlight),
    syntaxHighlighting(markdownHighlight),
    history(),
    drawSelection(),
    dropCursor(),
    closeBrackets(),
    EditorView.lineWrapping,
    search({ top: true }),
    highlightSelectionMatches(),
    Prec.high(keymap.of(editingKeymap)),
    keymap.of([
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
    vaultAutocomplete,
    linkPreview,
    linkClicks(opts.openExternal),
    previewCompartment.of(previewExtensions(!!opts.source)),
    editableCompartment.of(editableExtensions(opts.readOnly)),
    attrsCompartment.of(contentAttrs(opts.spellcheck ?? true)),
    EditorView.updateListener.of((u) => {
      if (u.docChanged || u.selectionSet || u.focusChanged) opts.onUpdate?.(u.view, u.docChanged);
    }),
    ...(opts.extra ?? []),
  ];
}

/** A read-only rendering of Markdown with every line inactive (embeds, help pages). */
export function createReadOnlyView(
  parent: HTMLElement,
  text: string,
  ctx: EditorContext,
  openExternal: ExternalOpener,
): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [editorExtensions({ ctx, readOnly: true, openExternal }), revealSource.of(false)],
    }),
  });
}

let defaultOpener: ExternalOpener = () => undefined;
export function setDefaultExternalOpener(fn: ExternalOpener): void {
  defaultOpener = fn;
}
setReadOnlyFactory((parent, text, ctx) => createReadOnlyView(parent, text, ctx, (url) => defaultOpener(url)));
