/**
 * The `window.vx` handlers that exist since M0: library, fs, settings, window, shell.
 * Later milestones register their own namespaces next to these.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import type { LibraryCreateResult, LibraryOpenResult, LibraryStats, RenameResult } from '@shared/bridge';
import { fail } from '@shared/result';
import { createLibrary, readLibrary } from '../library/library';
import { handle, optObj, optStr, str } from './ipc';
import type { JsonStore } from './json-store';
import { openExternalSafe } from './security';
import type { SessionManager } from './session';
import { validateKey, type Settings } from './settings';

export interface MachineState extends Record<string, unknown> {
  lastLibrary: string | null;
}

declare global {
  // Set by E2E tests through `electronApp.evaluate` to replace the native folder dialog.
  var __vxPickFolder: string | undefined;
}

export interface HandlerDeps {
  sessions: SessionManager;
  state: JsonStore<MachineState>;
  settings: Settings;
  isPackaged: boolean;
  /** Shows a file in the OS file manager (a recorder in test mode). */
  reveal(absPath: string): void;
  stats(): Promise<LibraryStats>;
  /** Rename or move, with optional link updates (SPECS 5). */
  rename(from: unknown, to: unknown, updateLinks: boolean): Promise<RenameResult>;
}

async function pickFolder(
  event: Electron.IpcMainInvokeEvent,
  title: string,
  isPackaged: boolean,
): Promise<string | null> {
  if (!isPackaged && typeof globalThis.__vxPickFolder === 'string') return globalThis.__vxPickFolder;
  const win = BrowserWindow.fromWebContents(event.sender);
  const opts: Electron.OpenDialogOptions = { title, properties: ['openDirectory', 'createDirectory'] };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
}

export function registerCoreHandlers(deps: HandlerDeps): void {
  const { sessions, state, settings } = deps;
  /** Folders picked in a dialog that `create` may use. The renderer never sends paths. */
  const folderTokens = new Map<string, string>();

  // ---- library -------------------------------------------------------------
  handle('library', 'open', async (event): Promise<LibraryOpenResult> => {
    const folder = await pickFolder(event, 'Open Library', deps.isPackaged);
    if (!folder) return { kind: 'cancelled' };
    const info = await readLibrary(folder);
    if (!info) {
      const token = randomUUID();
      folderTokens.set(token, folder);
      return { kind: 'not-library', token, folder: path.resolve(folder) };
    }
    const opened = await sessions.open(folder);
    state.set('lastLibrary', opened.root);
    return { kind: 'opened', library: opened };
  });

  handle('library', 'create', async (event, tokenArg): Promise<LibraryCreateResult> => {
    const token = optStr(tokenArg, 'token', 64);
    let folder: string | null;
    if (token !== undefined) {
      folder = folderTokens.get(token) ?? null;
      if (!folder) fail('INVALID_ARGUMENT', 'Unknown folder token.');
      folderTokens.delete(token);
    } else {
      folder = await pickFolder(event, 'Create Library', deps.isPackaged);
      if (!folder) return { kind: 'cancelled' };
    }
    await createLibrary(folder);
    const opened = await sessions.open(folder);
    state.set('lastLibrary', opened.root);
    return { kind: 'created', library: opened };
  });

  handle('library', 'current', async () => {
    await sessions.settled();
    return sessions.current?.info ?? null;
  });

  handle('library', 'close', async () => {
    await sessions.close();
    state.set('lastLibrary', null);
    return null;
  });

  handle('library', 'stats', () => {
    sessions.require();
    return deps.stats();
  });

  // ---- fs ------------------------------------------------------------------
  const lfs = () => sessions.require().fs;
  handle('fs', 'read', (_e, p) => lfs().read(p));
  handle('fs', 'readBinary', (_e, p) => lfs().readBinary(p));
  handle('fs', 'write', (_e, p, text, hash) => lfs().write(p, text, hash));
  handle('fs', 'create', (_e, p, text) => lfs().create(p, text));
  handle('fs', 'rename', (_e, from, to, opts) => {
    const o = optObj(opts, 'opts');
    return deps.rename(from, to, o?.updateLinks === true);
  });
  handle('fs', 'trash', async (_e, p) => {
    await lfs().trash(p);
    return null;
  });
  handle('fs', 'mkdir', (_e, p) => lfs().mkdir(p));
  handle('fs', 'list', (_e, p) => lfs().list(p));
  handle('fs', 'stat', (_e, p) => lfs().stat(p));

  // ---- settings ------------------------------------------------------------
  handle('settings', 'get', (_e, key) => settings.get(validateKey(key)));
  handle('settings', 'set', async (_e, key, value) => {
    const k = validateKey(key);
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch {
      fail('INVALID_ARGUMENT', 'Settings values must be JSON.');
    }
    if (json !== undefined && json.length > 1_000_000)
      fail('INVALID_ARGUMENT', 'Settings value is too large.');
    await settings.set(k, json === undefined ? null : (JSON.parse(json) as unknown));
    return null;
  });

  // ---- window --------------------------------------------------------------
  const win = (e: Electron.IpcMainInvokeEvent) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) fail('INVALID_ARGUMENT', 'No window.');
    return w;
  };
  handle('window', 'minimize', (e) => void win(e).minimize());
  handle('window', 'maximize', (e) => {
    const w = win(e);
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  handle('window', 'close', (e) => void win(e).close());
  handle('window', 'setTitle', (e, t) => void win(e).setTitle(str(t, 'title', 500)));

  // ---- shell ---------------------------------------------------------------
  handle('shell', 'openExternal', async (_e, url) => {
    if (!(await openExternalSafe(str(url, 'url', 8192))))
      fail('FORBIDDEN', 'Only http(s) links can be opened.');
    return null;
  });
  handle('shell', 'revealInFolder', async (_e, p) => {
    const { abs } = await sessions.require().root.resolve(p, { allowRoot: true, allowHidden: true });
    deps.reveal(abs);
    return null;
  });
}
