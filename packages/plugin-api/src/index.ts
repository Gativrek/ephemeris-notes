/// <reference lib="dom" />
/**
 * `@ephemeris-notes/plugin-api`: the plugin API v1 (SPECS 12.4). Plugins are ES modules whose
 * default export is a factory returning a Plugin. They use only `ctx`.
 *
 * Semver (SPECS 12.9): additions are minor releases; removals and signature changes
 * are major. A change here without a matching change to packages/sample-plugin fails CI.
 */

export const API_VERSION = '1.3.0';

export interface Disposable {
  dispose(): void;
}
export type Domain = 'academic' | 'work' | 'personal';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** Semver range checked against API_VERSION, e.g. "^1.0.0". */
  apiVersion: string;
  main: string;
  styles?: string;
  description?: string;
  author?: string;
}

export interface Plugin {
  onload(ctx: PluginContext): void | Promise<void>;
  onunload?(): void | Promise<void>;
}
/** The default export of main.js. */
export type PluginFactory = () => Plugin;

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly apiVersion: string;
  readonly blocks: BlockRegistry;
  readonly ui: UiService;
  readonly settings: PluginSettings;
  readonly help: HelpRegistry;
  readonly vault: VaultFiles;
  readonly storage: PluginStorage;
  readonly commands: CommandRegistry;
  readonly theme: ThemeService;
  readonly log: Logger;
  // ---- v2 (1.1.0, SPECS 12.11) ----
  readonly inline: InlineRegistry;
  readonly index: PluginIndex;
  readonly outline: OutlineRegistry;
  readonly views: ViewRegistry;
  readonly notes: NoteEditor;
  // ---- 1.3.0 (SPECS 12.12) ----
  readonly editor: EditorAccess;
  readonly footers: FooterRegistry;
}

// ---- Blocks -------------------------------------------------------------
export interface BlockRegistry {
  /** Registers a renderer for fenced blocks whose language matches (case-insensitive). */
  register(language: string, renderer: BlockRenderer): Disposable;
}

export interface BlockInfo {
  readonly language: string;
  /** Raw text after the language. */
  readonly infoString: string;
  readonly args: { positional: string[]; named: Record<string, string> };
  /** Body between the fences. */
  readonly source: string;
  /** Changes whenever source changes. */
  readonly version: number;
  readonly note: NoteRef;
}

export interface NoteRef {
  readonly path: string;
  /** null for Inbox and help pages. */
  readonly vaultPath: string | null;
  readonly domain: Domain | null;
  readonly frontmatter: Readonly<Record<string, unknown>>;
}

export interface BlockRenderer {
  render(el: HTMLElement, block: BlockInfo, host: BlockHost): BlockView | void | Promise<BlockView | void>;
  /**
   * 1.2.0: the body fence completion writes into a new block of this language, selected
   * so typing replaces it (SPECS 10.5). Without it the new block is empty.
   */
  starter?: string;
}

export interface BlockView {
  /** Return true if updated in place; false to have the host dispose and re-render. */
  update?(block: BlockInfo): boolean;
  dispose?(): void;
}

export interface BlockHost {
  /** Replaces the block body. Resolves false if refused (stale version, read-only, block gone). */
  updateSource(next: string, opts?: { expectedVersion?: number }): Promise<boolean>;
  openOverlay(opts: OverlayOptions): OverlayHandle;
  /** True in help pages, embeds and read-only files. */
  readonly readOnly: boolean;
  /** Aborted when the view is disposed. */
  readonly signal: AbortSignal;
}

// ---- UI -----------------------------------------------------------------
export interface OverlayOptions {
  title: string;
  /** large = 80% of the window. */
  size?: 'large' | 'full';
  render(el: HTMLElement, overlay: OverlayHandle): void | (() => void);
  /** Return false to keep the overlay open (e.g. unsaved changes). */
  onRequestClose?(): boolean | Promise<boolean>;
}
export interface OverlayHandle {
  close(): void;
  setTitle(title: string): void;
  setDirty(dirty: boolean): void;
}

export interface UiService {
  openOverlay(opts: OverlayOptions): OverlayHandle;
  notify(message: string, kind?: 'info' | 'error'): void;
  /** Library-relative path. */
  revealInFolder(path: string): void;
}

// ---- Settings and help --------------------------------------------------
export type SettingField =
  | { key: string; type: 'toggle'; label: string; default: boolean; hint?: string }
  | { key: string; type: 'text'; label: string; default: string; hint?: string }
  | { key: string; type: 'number'; label: string; default: number; min?: number; max?: number; step?: number }
  | {
      key: string;
      type: 'select';
      label: string;
      default: string;
      options: Array<{ value: string; label: string }>;
    }
  /** A library path. */
  | { key: string; type: 'file'; label: string; default: string; extensions?: string[] };

export interface PluginSettings {
  register(def: { fields?: SettingField[]; pane?: (el: HTMLElement) => void | (() => void) }): Disposable;
  get<T = unknown>(key: string): T;
  set(key: string, value: unknown): Promise<void>;
  onChange(cb: (key: string, value: unknown) => void): Disposable;
}

export interface HelpPage {
  id: string;
  title: string;
  markdown: string;
}
export interface HelpRegistry {
  register(pages: HelpPage[]): Disposable;
}

// ---- Files and storage --------------------------------------------------
export interface FileEntry {
  path: string;
  name: string;
  kind: 'file' | 'folder';
  size?: number;
  mtime?: number;
}

/** Read-only access to library content. */
export interface VaultFiles {
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  exists(path: string): Promise<boolean>;
  list(folder: string): Promise<FileEntry[]>;
  /** vx-asset:// URL. */
  assetUrl(path: string): string;
  /** Resolves a target relative to a note, using the core link rules (section 5) for bare names. */
  resolve(target: string, fromNotePath: string): string | null;
  watch(path: string, cb: () => void): Disposable;
}

export interface ScopedStorage {
  /** Library-relative folder, for reveal. */
  readonly root: string;
  readJson<T>(name: string, fallback: T): Promise<T>;
  /** Atomic. */
  writeJson(name: string, value: unknown): Promise<void>;
  readText(name: string): Promise<string | null>;
  writeText(name: string, text: string): Promise<void>;
  readBinary(name: string): Promise<ArrayBuffer | null>;
  writeBinary(name: string, data: ArrayBuffer): Promise<void>;
  remove(name: string): Promise<void>;
  list(folder?: string): Promise<FileEntry[]>;
  assetUrl(name: string): string;
}

export interface PluginStorage {
  /** .ephemeris/plugin-data/<id>/ */
  readonly library: ScopedStorage;
  /** <Vault>/.vault/plugin-data/<id>/ */
  vault(vaultPath: string): ScopedStorage;
}

// ---- Commands, theme, logging ------------------------------------------
export interface CommandRegistry {
  /** The id is prefixed with the plugin id automatically. */
  register(cmd: { id: string; title: string; run(): void | Promise<void> }): Disposable;
}

export interface ThemeService {
  readonly current: 'light' | 'dark';
  onChange(cb: (theme: 'light' | 'dark') => void): Disposable;
  /** Resolved value of a design token for the current theme, e.g. token('ink'). */
  token(name: string): string;
}

export interface Logger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

// ---- v2: inline decorations (SPECS 12.11.1) ------------------------------
export interface InlineRegistry {
  register(spec: InlineSpec): Disposable;
}
export interface InlineSpec {
  /** Unique within the plugin. */
  id: string;
  /** Must have the `g` flag; `y` is refused. Matched line by line. */
  match: RegExp;
  /** Return false to leave a match as text (e.g. skip @eq: keys). */
  accept?(m: InlineMatch): boolean;
  widget(m: InlineMatch, host: InlineHost): HTMLElement | InlineView;
  /** Default true: the source shows while the cursor is inside the match, like links. */
  revealOnCursor?: boolean;
  /** Optional hover card, shown in the core preview-card surface. */
  hover?(m: InlineMatch, card: HTMLElement): void | (() => void);
}
export interface InlineMatch {
  readonly text: string;
  readonly groups: readonly (string | undefined)[];
  readonly named: Readonly<Record<string, string | undefined>>;
  /** Offsets in the note's LF text. */
  readonly from: number;
  readonly to: number;
  readonly line: number;
  readonly note: NoteRef;
}
export interface InlineView {
  dom: HTMLElement;
  /** Return true if updated in place. */
  update?(m: InlineMatch): boolean;
  dispose?(): void;
}
export interface InlineHost {
  readonly readOnly: boolean;
  readonly signal: AbortSignal;
  /** Replaces the matched text (one transaction, `plugin.<id>`, undoable). Same rules as updateSource. */
  replace(next: string): Promise<boolean>;
  openOverlay(opts: OverlayOptions): OverlayHandle;
}

// ---- v2: index extractors (SPECS 12.11.2) --------------------------------
export interface PluginIndex {
  registerExtractor(spec: ExtractorSpec): Disposable;
  query(q: IndexQuery): Promise<IndexRecord[]>;
  /** Fires after records of this plugin change (debounced). */
  onChanged(cb: () => void): Disposable;
}
export type ExtractorSpec = { id: string; version: number; where?: ExtractorWhere } & (
  | {
      kind: 'regex';
      pattern: string;
      flags?: '' | 'i' | 'u' | 'iu';
      key: number | string;
      value?: number | string;
    }
  | { kind: 'fence'; language: string }
  | { kind: 'frontmatter'; field: string }
);
export interface ExtractorWhere {
  /** Only notes whose frontmatter has these exact values, e.g. { flashcards: true }. */
  frontmatter?: Record<string, string | number | boolean>;
  /** Default true: skip code blocks, math and frontmatter. */
  outsideCode?: boolean;
}
export interface IndexQuery {
  extractor: string;
  key?: string;
  keyPrefix?: string;
  path?: string;
  scope?: { kind: 'vault'; vaultPath: string } | { kind: 'domain'; domain: Domain } | { kind: 'all' };
  /** Default 1000, max 10000. */
  limit?: number;
}
export interface IndexRecord {
  readonly path: string;
  readonly line: number;
  readonly key: string;
  readonly value: string | null;
}

// ---- v2: outline contributions (SPECS 12.11.3) ---------------------------
export interface OutlineRegistry {
  contribute(fn: (note: OutlineNote) => OutlineEntry[]): Disposable;
}
export interface OutlineNote {
  readonly note: NoteRef;
  readonly text: string;
  readonly headings: ReadonlyArray<{ level: number; text: string; line: number }>;
}
export interface OutlineEntry {
  line: number;
  label: string;
  /** One text glyph, shown in `faint` like the core arrows. */
  glyph?: string;
  onClick?(): void;
}

// ---- v2: views (SPECS 12.11.4) -------------------------------------------
export interface ViewRegistry {
  register(type: string, factory: ViewFactory): Disposable;
  /** Opens (or focuses) a view on the desk. `key` makes it unique, e.g. a Vault path. */
  open(type: string, opts?: { key?: string; state?: unknown; pin?: boolean }): Promise<void>;
}
export interface ViewFactory {
  title(state: unknown): string;
  /** A core icon name (design/components/Icon). */
  icon?: string;
  render(el: HTMLElement, state: unknown, host: ViewHost): ViewInstance | void;
}
export interface ViewHost {
  readonly signal: AbortSignal;
  setTitle(title: string): void;
  setDirty(dirty: boolean): void;
  /** Persisted with the desk (per machine), JSON, at most 16 KB. */
  saveState(state: unknown): void;
  close(): void;
  /** Renders Markdown with the core renderer, read-only (math, images, plugin blocks). */
  renderMarkdown(el: HTMLElement, markdown: string, from: NoteRef | null): Disposable;
}
export interface ViewInstance {
  /** Return false to keep the item open (unsaved state). */
  onRequestClose?(): boolean | Promise<boolean>;
  dispose?(): void;
}

// ---- v2: note edits (SPECS 12.11.5) --------------------------------------
export interface NoteEditor {
  read(path: string): Promise<{ text: string; hash: string }>;
  edit(
    path: string,
    edits: ReadonlyArray<{ from: number; to: number; insert: string }>,
    opts: { expectedHash: string; reason: string },
  ): Promise<
    | { ok: true; hash: string }
    | { ok: false; reason: 'conflict' | 'readOnly' | 'notFound' | 'notAllowed' | 'invalid' }
  >;
}

// ---- 1.3.0: cursor insertion and note footers (SPECS 12.12) ------------------
export interface EditorAccess {
  /** The note in the active desk item's editor, or null (a PDF, a view, nothing open). */
  activeNote(): NoteRef | null;
  /**
   * Replaces the selection in that editor with `text` and puts the cursor after it, as one
   * undoable transaction, then focuses the editor. User-initiated only, as notes.edit.
   * Resolves false when refused, read-only, or no note is open.
   */
  insertText(text: string): Promise<boolean>;
}

export interface FooterRegistry {
  register(spec: FooterSpec): Disposable;
}
export interface FooterSpec {
  /** Unique within the plugin. */
  id: string;
  /** Called for each note the editor shows. Draw into `el`, or leave it empty to show nothing. */
  render(el: HTMLElement, note: NoteRef, host: FooterHost): FooterView | void;
}
export interface FooterHost {
  /** Aborted when the editor shows another note, or the footer is unregistered. */
  readonly signal: AbortSignal;
}
export interface FooterView {
  dispose?(): void;
}
