/**
 * What an editor instance knows about its surroundings: the note path, how links
 * resolve, how to open them, how to read other notes, and math settings. Provided as
 * a facet so nested read-only views (embeds, help pages) share the same model.
 */
import { Facet, StateEffect } from '@codemirror/state';
import type { Resolution } from '@ephemeris-notes/markdown';

export interface OpenLinkRequest {
  /** Resolved library path, or null for a missing note. */
  path: string | null;
  target: string;
  heading: string | null;
  block: string | null;
  page: number | null;
  /** Open beside the current item without switching (Ctrl/Cmd+click). */
  newItem: boolean;
}

export interface EditorContext {
  path: string;
  /** `Domain/Vault` of this note, or null (Inbox, help pages). */
  vaultPath: string | null;
  resolve(target: string): Resolution;
  open(req: OpenLinkRequest): void;
  /** Reads another note's text (for embeds and previews). */
  loadNote(path: string): Promise<string | null>;
  assetUrl(path: string): string;
  /** Shortest unambiguous link text for a path (SPECS 5). */
  linkText(path: string): string;
  /** Library notes and attachments for autocomplete. */
  files(): string[];
  numbering: 'all' | 'labeled';
  macros: Record<string, string>;
  /** "Eq. (3)", "(3)" or "Equation 3" (Settings > Math). */
  refFormat: 'eq' | 'paren' | 'word';
  /** Embed nesting: the chain of notes rendering this one (cycle detection, 3 levels). */
  embedChain: string[];
}

const NOOP: EditorContext = {
  path: '',
  vaultPath: null,
  resolve: () => ({ path: null, candidates: [] }),
  open: () => undefined,
  loadNote: async () => null,
  assetUrl: (p) => p,
  linkText: (p) => p,
  files: () => [],
  numbering: 'all',
  macros: {},
  refFormat: 'eq',
  embedChain: [],
};

export const editorContext = Facet.define<EditorContext, EditorContext>({
  combine: (values) => values[values.length - 1] ?? NOOP,
});

/** Dispatched when link targets may have changed (the file list changed). */
export const refreshLinks = StateEffect.define<null>();

/** Whether the cursor reveals source (false in read-only renderings). */
export const revealSource = Facet.define<boolean, boolean>({
  combine: (values) => (values.length ? values[values.length - 1]! : true),
});
