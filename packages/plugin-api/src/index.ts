/// <reference lib="dom" />
/**
 * `@vaults/plugin-api`: the plugin API v1 (SPECS 12.4). Plugins are ES modules whose
 * default export is a factory returning a Plugin. They use only `ctx`.
 *
 * Semver (SPECS 12.9): additions are minor releases; removals and signature changes
 * are major. A change here without a matching change to packages/sample-plugin fails CI.
 */

export const API_VERSION = '1.0.0';

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
  /** .vaults/plugin-data/<id>/ */
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
