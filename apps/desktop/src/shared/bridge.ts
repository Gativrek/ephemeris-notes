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

export interface VxBridge {
  library: {
    /** Shows a folder picker. Opens the folder if it is a library. */
    open(): Promise<Result<LibraryOpenResult>>;
    /** Creates a library in the folder behind `token` (from `open`), or in a picked folder. */
    create(token?: string): Promise<Result<LibraryCreateResult>>;
    current(): Promise<Result<LibraryInfo | null>>;
    close(): Promise<Result<null>>;
    stats(): Promise<Result<LibraryStats>>;
    onChanged(cb: (library: LibraryInfo | null) => void): Unsubscribe;
  };
  fs: {
    read(path: string): Promise<Result<TextFile>>;
    readBinary(path: string): Promise<Result<Uint8Array>>;
    /** Refused with CONFLICT when the file on disk no longer has `expectedHash`. */
    write(path: string, text: string, expectedHash: string): Promise<Result<WriteResult>>;
    /** Creates a new file. Refused with EXISTS if anything is at `path`. */
    create(path: string, text: string): Promise<Result<WriteResult>>;
    rename(from: string, to: string, opts?: { updateLinks?: boolean }): Promise<Result<{ path: string }>>;
    /** Moves to the OS trash. Never deletes permanently. */
    trash(path: string): Promise<Result<null>>;
    mkdir(path: string): Promise<Result<{ path: string }>>;
    list(dir: string): Promise<Result<FileEntry[]>>;
    stat(path: string): Promise<Result<FileEntry>>;
  };
  index: {
    search(query: string, scope: SearchScope): Promise<Result<unknown>>;
    backlinks(path: string): Promise<Result<unknown>>;
    resolve(link: string, fromPath: string): Promise<Result<string | null>>;
    outline(path: string): Promise<Result<unknown>>;
    notesIn(scope: SearchScope): Promise<Result<unknown>>;
    onChanged(cb: () => void): Unsubscribe;
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
  | { type: 'index.changed'; payload: null };

/** Bridge surface as a method list, so preload and main agree on channels. */
export const BRIDGE_METHODS = {
  library: ['open', 'create', 'current', 'close', 'stats'],
  fs: ['read', 'readBinary', 'write', 'create', 'rename', 'trash', 'mkdir', 'list', 'stat'],
  index: ['search', 'backlinks', 'resolve', 'outline', 'notesIn'],
  settings: ['get', 'set'],
  window: ['minimize', 'maximize', 'close', 'setTitle'],
  shell: ['openExternal', 'revealInFolder'],
} as const;
