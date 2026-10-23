/**
 * The contract of `window.vx` (SPECS 3.4), shared by preload, main and renderer.
 * Paths are library-relative POSIX paths unless a field says otherwise.
 */
import type { Result } from './result';

export type Domain = 'academic' | 'work' | 'personal';
export type Eol = 'lf' | 'crlf';

export interface LibraryInfo {
  /** Absolute folder path, for display only. The renderer never passes it back. */
  root: string;
  id: string;
  created: string;
  name: string;
}

export type LibraryOpenResult =
  | { kind: 'opened'; library: LibraryInfo }
  /** The chosen folder has no `.vaults/library.json`. `token` lets `create` use it. */
  | { kind: 'not-library'; token: string; folder: string }
  | { kind: 'cancelled' };

export type LibraryCreateResult = { kind: 'created'; library: LibraryInfo } | { kind: 'cancelled' };

export interface TextFile {
  path: string;
  /** Content with every line ending normalized to LF. */
  text: string;
  /** SHA-256 (hex) of the raw bytes on disk. Pass it back to `fs.write`. */
  hash: string;
  /** Line-ending style used when saving: the file's own, or its dominant one if mixed. */
  eol: Eol;
  /** True when the file mixes CRLF and LF; saving an edit writes `eol` everywhere. */
  mixedEol: boolean;
  bom: boolean;
  finalNewline: boolean;
  /** True when the bytes are not valid UTF-8. Such files are never saved. */
  readOnly: boolean;
  mtime: number;
  size: number;
}

export interface WriteResult {
  path: string;
  hash: string;
  mtime: number;
}

export interface FileEntry {
  path: string;
  name: string;
  kind: 'file' | 'folder';
  size?: number;
  mtime?: number;
}

export interface FileEvent {
  path: string;
  kind: 'file' | 'folder';
}

export type Unsubscribe = () => void;

export interface VaultCover {
  file: string;
  /** The point kept in view, each axis in [0, 1]. */
  focus: { x: number; y: number };
  /** 1.0 to 2.5. */
  zoom: number;
}

export interface VaultInfo {
  /** Library-relative folder, e.g. "Academic/GNSS Study". */
  path: string;
  folder: string;
  domain: Domain;
  id: string;
  name: string;
  created: string;
  order: number;
  cover: VaultCover | null;
  /** Changes whenever the cover file changes; append to the asset URL to bust caches. */
  coverVersion: number;
  settings: { attachments: string; templates: string; daily: string };
  sectionOrder: string[] | null;
  noteCount: number;
  lastEdited: number | null;
  /** vault.json exists but is not valid JSON: shown, never rewritten. */
  broken: boolean;
}

export interface CoverInput {
  /** New image bytes, or omitted to keep the current image and change focus or zoom. */
  bytes?: ArrayBuffer;
  focus: { x: number; y: number };
  zoom: number;
}

export interface VaultInput {
  name: string;
  domain: Domain;
  /** undefined keeps the cover; null removes it. */
  cover?: CoverInput | null;
}

export interface VaultMoveImpact {
  notes: number;
  /** Notes outside the Vault that link into it by path. */
  linkingNotes: string[];
}

export interface VxBridge {
  library: {
    /** Shows a folder picker. Opens the folder if it is a library. */
    open(): Promise<Result<LibraryOpenResult>>;
    /** Creates a library in the folder behind `token` (from `open`), or in a picked folder. */
    create(token?: string): Promise<Result<LibraryCreateResult>>;
    current(): Promise<Result<LibraryInfo | null>>;
    close(): Promise<Result<null>>;
    stats(): Promise<Result<LibraryStats>>;
    /** Every visible file in the library; `version` changes whenever the list does. */
    files(): Promise<Result<{ version: number; files: CatalogEntry[] }>>;
    onFilesChanged(cb: () => void): Unsubscribe;
    onChanged(cb: (library: LibraryInfo | null) => void): Unsubscribe;
    /** Git auto-commit (SPECS 4.11): whether the library is a repository and the last attempt. */
    gitStatus(): Promise<Result<GitStatusInfo>>;
    /** Commits every change now (Settings > Library > Commit Now). */
    gitCommitNow(): Promise<Result<GitStatusInfo>>;
  };
  fs: {
    read(path: string): Promise<Result<TextFile>>;
    readBinary(path: string): Promise<Result<Uint8Array>>;
    /** Refused with CONFLICT when the file on disk no longer has `expectedHash`. */
    write(path: string, text: string, expectedHash: string): Promise<Result<WriteResult>>;
    /** Creates a new file. Refused with EXISTS if anything is at `path`. */
    create(path: string, text: string): Promise<Result<WriteResult>>;
    rename(from: string, to: string, opts?: { updateLinks?: boolean }): Promise<Result<RenameResult>>;
    /** Moves to the OS trash. Never deletes permanently. */
    trash(path: string): Promise<Result<null>>;
    mkdir(path: string): Promise<Result<{ path: string }>>;
    list(dir: string): Promise<Result<FileEntry[]>>;
    stat(path: string): Promise<Result<FileEntry>>;
  };
  vaults: {
    list(): Promise<Result<VaultInfo[]>>;
    get(path: string): Promise<Result<VaultInfo | null>>;
    create(input: VaultInput): Promise<Result<VaultInfo>>;
    update(path: string, input: Omit<VaultInput, 'domain'>): Promise<Result<VaultInfo>>;
    moveImpact(path: string): Promise<Result<VaultMoveImpact>>;
    move(path: string, to: Domain): Promise<Result<VaultInfo>>;
    /** Trashes the Vault folder; typedName must equal the Vault name. */
    remove(path: string, typedName: string): Promise<Result<null>>;
    nonVaultFolders(): Promise<Result<Array<{ path: string; domain: Domain }>>>;
    makeVault(path: string): Promise<Result<VaultInfo>>;
    onChanged(cb: () => void): Unsubscribe;
  };
  /** Installed plugins (SPECS 12.2) and their data storage (12.7). */
  plugins: {
    list(): Promise<Result<PluginInfo[]>>;
    setEnabled(id: string, enabled: boolean): Promise<Result<null>>;
    /** Shows a folder picker and copies the plugin in. */
    install(): Promise<Result<PluginInfo | null>>;
    storageRoot(scope: StorageScope, id: string, vaultPath: string | null): Promise<Result<string>>;
    readText(
      scope: StorageScope,
      id: string,
      vaultPath: string | null,
      name: string,
    ): Promise<Result<string | null>>;
    readBinary(
      scope: StorageScope,
      id: string,
      vaultPath: string | null,
      name: string,
    ): Promise<Result<Uint8Array | null>>;
    writeText(
      scope: StorageScope,
      id: string,
      vaultPath: string | null,
      name: string,
      text: string,
    ): Promise<Result<null>>;
    writeBinary(
      scope: StorageScope,
      id: string,
      vaultPath: string | null,
      name: string,
      data: ArrayBuffer,
    ): Promise<Result<null>>;
    remove(scope: StorageScope, id: string, vaultPath: string | null, name: string): Promise<Result<null>>;
    listFiles(
      scope: StorageScope,
      id: string,
      vaultPath: string | null,
      folder: string,
    ): Promise<Result<FileEntry[]>>;
  };
  /** Read-only app resources: pdf.js CMaps and standard fonts, by file name. */
  app: {
    pdfData(kind: 'cmap' | 'font', name: string): Promise<Result<Uint8Array>>;
  };
  /** Note actions that write on explicit request (SPECS 4.5). */
  notes: {
    create(
      vaultPath: string,
      folder: string,
      title: string,
      template: string | null,
    ): Promise<Result<string>>;
    templates(vaultPath: string): Promise<Result<string[]>>;
    daily(vaultPath: string): Promise<Result<{ path: string; created: boolean }>>;
    addAttachment(vaultPath: string, fileName: string, bytes: ArrayBuffer): Promise<Result<string>>;
  };
  /** Per-machine UI state for the open library (SPECS 4.10): desk, pins, last Vault. */
  ui: {
    get(key: string): Promise<Result<unknown>>;
    set(key: string, value: unknown): Promise<Result<null>>;
  };
  index: {
    search(query: string, scope: SearchScope): Promise<Result<SearchHit[]>>;
    backlinks(path: string): Promise<Result<Backlink[]>>;
    resolve(link: string, fromPath: string): Promise<Result<{ path: string | null; candidates: string[] }>>;
    outline(path: string): Promise<
      Result<{
        headings: Array<{ level: number; text: string; line: number }>;
        equations: Array<{ number: string | null; label: string | null; line: number }>;
        backlinks: Backlink[];
      }>
    >;
    notesIn(scope: SearchScope): Promise<Result<Array<{ path: string; title: string }>>>;
    status(): Promise<Result<IndexStatus>>;
    /** Deletes and rebuilds the index (Settings > Library). */
    rebuild(): Promise<Result<null>>;
    ambiguous(): Promise<Result<Array<{ src: string; target: string; line: number; candidates: string[] }>>>;
    /** What renaming or moving `paths` would rewrite ("Update N links in M notes"). */
    linkImpact(paths: string[]): Promise<Result<LinkImpact>>;
    aliases(): Promise<Result<Array<[string, string[]]>>>;
    /** Plugin extractors (SPECS 12.11.2): declarative specs applied by the index worker. */
    registerExtractor(pluginId: string, spec: unknown): Promise<Result<null>>;
    unregisterExtractor(pluginId: string, id: string): Promise<Result<null>>;
    queryRecords(
      pluginId: string,
      query: unknown,
    ): Promise<Result<Array<{ path: string; line: number; key: string; value: string | null }>>>;
    /** Plugins whose records changed. */
    onRecords(cb: (plugins: string[]) => void): Unsubscribe;
    onChanged(cb: () => void): Unsubscribe;
    onStatus(cb: (s: IndexStatus) => void): Unsubscribe;
  };
  settings: {
    get(key: string): Promise<Result<unknown>>;
    set(key: string, value: unknown): Promise<Result<null>>;
    onChanged(cb: (key: string, value: unknown) => void): Unsubscribe;
  };
  window: {
    minimize(): Promise<Result<null>>;
    maximize(): Promise<Result<null>>;
    close(): Promise<Result<null>>;
    setTitle(title: string): Promise<Result<null>>;
    /** Native context menu; resolves the chosen item id, or null. */
    contextMenu(items: ContextMenuItem[]): Promise<Result<string | null>>;
    /** Colours of the native window controls, from the theme tokens. */
    setChrome(colors: { background: string; symbols: string }): Promise<Result<null>>;
    /** Main asks before closing; the renderer saves, then calls this. */
    onBeforeClose(cb: () => void): Unsubscribe;
    readyToClose(): Promise<Result<null>>;
  };
  shell: {
    /** http(s) only, and only after a user click. */
    openExternal(url: string): Promise<Result<null>>;
    revealInFolder(path: string): Promise<Result<null>>;
  };
  events: {
    onFileChanged(cb: (e: FileEvent) => void): Unsubscribe;
    onFileCreated(cb: (e: FileEvent) => void): Unsubscribe;
    onFileDeleted(cb: (e: FileEvent) => void): Unsubscribe;
  };
}

export interface CatalogEntry {
  path: string;
  size: number;
  mtime: number;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  enabled?: boolean;
  /** Draws a separator before this item. */
  separatorBefore?: boolean;
}

export interface SearchHit {
  kind: 'note' | 'file';
  path: string;
  title: string;
  /** `Domain/Vault`, or null outside Vaults. */
  vault: string | null;
  domain: Domain | null;
  /** Up to two snippets; `hit` parts are the matched words. */
  snippets: Array<Array<{ text: string; hit: boolean }>>;
}

export interface Backlink {
  path: string;
  title: string;
  line: number;
  snippet: string;
}

export interface IndexStatus {
  state: 'idle' | 'indexing' | 'starting' | 'error';
  done: number;
  total: number;
  message?: string;
}

export interface LinkImpact {
  /** Notes outside the moved paths whose links point into them. */
  notes: Array<{ path: string; links: number }>;
}

export interface RenameResult {
  path: string;
  /** Notes rewritten to follow the rename (explicit action, SPECS 4.8 rule 3). */
  updated: string[];
  failed: Array<{ path: string; message: string }>;
}

export interface PluginManifestInfo {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  main: string;
  styles?: string;
  description?: string;
  author?: string;
}

export interface PluginInfo {
  manifest: PluginManifestInfo;
  enabled: boolean;
  /** False when the manifest is invalid, a file is missing or apiVersion does not match. */
  compatible: boolean;
  problem?: string;
}

export type StorageScope = 'library' | 'vault';

export interface GitStatusInfo {
  repo: boolean;
  enabled: boolean;
  intervalMinutes: number;
  last: {
    at: number;
    result: 'committed' | 'clean' | 'skipped' | 'failed' | 'unavailable';
    message: string;
  } | null;
}

export interface LibraryStats {
  notes: Record<Domain, number>;
}

export type SearchScope =
  { kind: 'vault'; vaultPath: string } | { kind: 'domain'; domain: Domain } | { kind: 'all' };

/** IPC channel for invoke-style calls: `vx:<namespace>.<method>`. */
export const channel = (ns: string, method: string): string => `vx:${ns}.${method}`;

/** IPC channel for events pushed from main. */
export const EVENT_CHANNEL = 'vx:event';

export type PushEvent =
  | { type: 'file.changed' | 'file.created' | 'file.deleted'; payload: FileEvent }
  | { type: 'library.changed'; payload: LibraryInfo | null }
  | { type: 'settings.changed'; payload: { key: string; value: unknown } }
  | { type: 'index.changed'; payload: null }
  | { type: 'index.status'; payload: IndexStatus }
  | { type: 'index.records'; payload: string[] }
  | { type: 'vaults.changed'; payload: null }
  | { type: 'catalog.changed'; payload: null }
  | { type: 'app.beforeClose'; payload: null };

/** Bridge surface as a method list, so preload and main agree on channels. */
export const BRIDGE_METHODS = {
  library: ['open', 'create', 'current', 'close', 'stats', 'files', 'gitStatus', 'gitCommitNow'],
  notes: ['create', 'templates', 'daily', 'addAttachment'],
  app: ['pdfData'],
  plugins: [
    'list',
    'setEnabled',
    'install',
    'storageRoot',
    'readText',
    'readBinary',
    'writeText',
    'writeBinary',
    'remove',
    'listFiles',
  ],
  vaults: ['list', 'get', 'create', 'update', 'moveImpact', 'move', 'remove', 'nonVaultFolders', 'makeVault'],
  ui: ['get', 'set'],
  fs: ['read', 'readBinary', 'write', 'create', 'rename', 'trash', 'mkdir', 'list', 'stat'],
  index: [
    'search',
    'backlinks',
    'resolve',
    'outline',
    'notesIn',
    'status',
    'rebuild',
    'ambiguous',
    'linkImpact',
    'aliases',
    'registerExtractor',
    'unregisterExtractor',
    'queryRecords',
  ],
  settings: ['get', 'set'],
  window: ['minimize', 'maximize', 'close', 'setTitle', 'contextMenu', 'setChrome', 'readyToClose'],
  shell: ['openExternal', 'revealInFolder'],
} as const;
