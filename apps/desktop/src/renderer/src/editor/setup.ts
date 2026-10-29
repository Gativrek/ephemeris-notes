/**
 * Builds the note editor (SPECS 10.1): CodeMirror 6 with the shared Lezer Markdown
 * extensions, live preview, math, links, embeds, code highlighting and the keymap.
 */
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import {
  cursorMatchingBracket,
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  redo,
  selectParentSyntax,
  undo,
} from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import {
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
  selectNextOccurrence,
} from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  drawSelection,
  dropCursor,
  keymap,
  type Command,
  type KeyBinding,
} from '@codemirror/view';
import { vaultsMarkdown } from '@ephemeris-notes/markdown';
import { blockDecorations } from './blocks';
import { editorContext, revealSource, type EditorContext } from './context';
import { setReadOnlyFactory } from './embeds';
import { closedFence, insertCodeBlock } from './fences';
import { linkClicks, linkPreview, vaultAutocomplete, type ExternalOpener } from './interactions';
import { codeHighlight, findLanguage, markdownHighlight, sourceHeadingHighlight } from './languages';
import { livePreview } from './livePreview';
import { pluginInline, pluginInlineHover } from './pluginInline';
import { equationField } from './equations';
import { normalizeKey } from '../lib/hotkeys';
import { currentOverrides, keysOf, SHORTCUTS, type Overrides } from '../lib/keymap';

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

/** The editor commands of Settings > Keyboard (lib/keymap.ts), by id. */
const EDITOR_COMMANDS: Record<string, Command> = {
  'editor:bold': toggleWrap('**'),
  'editor:italic': toggleWrap('*'),
  // Backticks are a dead key on some layouts (ABNT2): a block without typing them.
  'core:insert-code-block': insertCodeBlock,
  'editor:task': toggleTask,
  'editor:undo': undo,
  'editor:redo': redo,
  'editor:find': openSearchPanel,
  'editor:select-next': selectNextOccurrence,
  'editor:matching-bracket': cursorMatchingBracket,
  'editor:indent': indentMore,
  'editor:outdent': indentLess,
};
const MANAGED = new Set<Command>([...Object.values(EDITOR_COMMANDS), selectParentSyntax]);
const MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

/** CodeMirror's notation for a normalized key. */
const cmKey = (k: string) => (k.endsWith('- ') || k === ' ' ? `${k.slice(0, -1)}Space` : k);

/**
 * CodeMirror's own keys that stay fixed: everything except the commands above and any
 * binding on a key those commands use by default or now (Mod-i was selectParentSyntax).
 */
function fixedBindings(overrides: Overrides): KeyBinding[] {
  const used = new Set(
    SHORTCUTS.filter((s) => s.scope === 'editor').flatMap((s) => [...s.defaults, ...keysOf(s.id, overrides)]),
  );
  const keep = (b: KeyBinding) => {
    if (b.run && MANAGED.has(b.run)) return false;
    const k = (MAC ? b.mac : b.win) ?? b.key;
    return !k || !used.has(normalizeKey(k, MAC));
  };
  return [
    ...closeBracketsKeymap,
    ...completionKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...defaultKeymap,
  ].filter(keep);
}

/** The editor commands on their current keys, ahead of CodeMirror's own. */
export function editorKeymap(overrides: Overrides): Extension {
  const commands: KeyBinding[] = [];
  for (const [id, run] of Object.entries(EDITOR_COMMANDS))
    for (const k of keysOf(id, overrides)) commands.push({ key: cmKey(k), run, preventDefault: true });
  return [Prec.high(keymap.of(commands)), keymap.of(fixedBindings(overrides))];
}

export const keymapCompartment = new Compartment();

/** Every editor showing now, so a change in Settings > Keyboard reaches them all. */
const liveViews = new Set<EditorView>();
const trackView = ViewPlugin.define((view) => {
  liveViews.add(view);
  return { destroy: () => liveViews.delete(view) };
});

/** Rebinds the editor commands in every open editor (Settings > Keyboard changed). */
export function applyEditorShortcuts(overrides: Overrides): void {
  for (const v of liveViews) v.dispatch({ effects: keymapCompartment.reconfigure(editorKeymap(overrides)) });
}

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

/** The editor's fixed keys (Settings > Keyboard refuses these): not its rebindable commands. */
export function editorKeyBindings(overrides: Overrides = {}): readonly KeyBinding[] {
  return [...fixedBindings(overrides), ...markdownKeymap];
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
    closedFence,
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
    keymapCompartment.of(editorKeymap(currentOverrides())),
    trackView,
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
