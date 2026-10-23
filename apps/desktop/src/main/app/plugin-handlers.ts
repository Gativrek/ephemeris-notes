/**
 * `vx.plugins`: installed plugins, enable and disable, install from a folder, and plugin
 * data storage in the library (SPECS 12.7): `.vaults/plugin-data/<id>/` and
 * `<Vault>/.vault/plugin-data/<id>/`. Writes are atomic.
 */
import { BrowserWindow, dialog } from 'electron';
import type { FileEntry } from '@shared/bridge';
import { fail } from '@shared/result';
import { normalizeLibraryPath } from '../library/paths';
import { VaultStore } from '../library/vaults';
import { PLUGIN_ID, type PluginManager } from '../plugins/manager';
import { bool, handle, oneOf, optStr, str } from './ipc';
import type { JsonStore } from './json-store';
import type { SessionManager } from './session';

const ENABLED_KEY = 'plugins.enabled';

export function enabledPlugins(settings: JsonStore<Record<string, unknown>>): string[] {
  const v = settings.get(ENABLED_KEY);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function registerPluginHandlers(deps: {
  sessions: SessionManager;
  manager: PluginManager;
  settings: JsonStore<Record<string, unknown>>;
  isPackaged: boolean;
}): void {
  const { sessions, manager, settings } = deps;

  handle('plugins', 'list', () => manager.list());
  handle('plugins', 'setEnabled', (_e, id, on) => {
    const pid = str(id, 'id', 64);
    if (!PLUGIN_ID.test(pid)) fail('INVALID_ARGUMENT', 'Invalid plugin id.');
    const set = new Set(enabledPlugins(settings));
    if (bool(on, 'enabled')) set.add(pid);
    else set.delete(pid);
    settings.set(ENABLED_KEY, [...set].sort());
    return null;
  });
  handle('plugins', 'install', async (event) => {
    let folder: string | null;
    if (!deps.isPackaged && typeof globalThis.__vxPickFolder === 'string') folder = globalThis.__vxPickFolder;
    else {
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts: Electron.OpenDialogOptions = {
        title: 'Install Plugin from Folder',
        properties: ['openDirectory'],
      };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      folder = r.canceled ? null : (r.filePaths[0] ?? null);
    }
    if (!folder) return null;
    return manager.install(folder);
  });

  // ---- storage ---------------------------------------------------------------
  async function root(scope: unknown, id: unknown, vaultPath: unknown): Promise<string> {
    const s = oneOf(scope, 'scope', ['library', 'vault'] as const);
    const pid = str(id, 'id', 64);
    if (!PLUGIN_ID.test(pid)) fail('INVALID_ARGUMENT', 'Invalid plugin id.');
    if (s === 'library') return `.vaults/plugin-data/${pid}`;
    const vp = normalizeLibraryPath(optStr(vaultPath, 'vaultPath', 1024));
    const v = await new VaultStore(sessions.require().fs).get(vp);
    if (!v) fail('NOT_FOUND', 'Not a Vault.');
    return `${v.path}/.vault/plugin-data/${pid}`;
  }
  const opts = { allowHidden: true };
  const rel = async (scope: unknown, id: unknown, vaultPath: unknown, name: unknown, allowRoot = false) => {
    const base = await root(scope, id, vaultPath);
    const n =
      typeof name === 'string' && name !== ''
        ? normalizeLibraryPath(name, { allowHidden: false })
        : allowRoot
          ? ''
          : normalizeLibraryPath(name);
    return n ? `${base}/${n}` : base;
  };
  const missing = (err: unknown) =>
    (err as { code?: string }).code === 'ENOENT' || (err as { code?: string }).code === 'NOT_FOUND';

  handle('plugins', 'storageRoot', (_e, scope, id, vp) => root(scope, id, vp));
  handle('plugins', 'readText', async (_e, scope, id, vp, name) => {
    try {
      return (await sessions.require().fs.read(await rel(scope, id, vp, name), opts)).text;
    } catch (err) {
      if (missing(err)) return null;
      throw err;
    }
  });
  handle('plugins', 'readBinary', async (_e, scope, id, vp, name) => {
    try {
      return await sessions.require().fs.readBinary(await rel(scope, id, vp, name), opts);
    } catch (err) {
      if (missing(err)) return null;
      throw err;
    }
  });
  handle('plugins', 'writeText', async (_e, scope, id, vp, name, text) => {
    const t = str(text, 'text', 50_000_000);
    await sessions.require().fs.writeBytes(await rel(scope, id, vp, name), Buffer.from(t, 'utf8'), opts);
    return null;
  });
  handle('plugins', 'writeBinary', async (_e, scope, id, vp, name, data) => {
    let bytes: Uint8Array;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (data instanceof Uint8Array) bytes = data;
    else fail('INVALID_ARGUMENT', 'data must be binary.');
    if (bytes.byteLength > 200 * 1024 * 1024) fail('INVALID_ARGUMENT', 'Too large.');
    await sessions.require().fs.writeBytes(await rel(scope, id, vp, name), bytes, opts);
    return null;
  });
  handle('plugins', 'remove', async (_e, scope, id, vp, name) => {
    try {
      await sessions.require().fs.trash(await rel(scope, id, vp, name), opts);
    } catch (err) {
      if (!missing(err)) throw err;
    }
    return null;
  });
  handle('plugins', 'listFiles', async (_e, scope, id, vp, folder): Promise<FileEntry[]> => {
    try {
      return await sessions.require().fs.list(await rel(scope, id, vp, folder ?? '', true), opts);
    } catch (err) {
      if (missing(err)) return [];
      throw err;
    }
  });
}
