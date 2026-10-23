/**
 * Handlers added for the workspace (M2): the file catalog, note actions (new note,
 * templates, daily note, attachments), native context menus, window chrome colours,
 * and the save-before-close handshake.
 */
import { BrowserWindow, Menu } from 'electron';
import type { ContextMenuItem, VaultInfo } from '@shared/bridge';
import { fail } from '@shared/result';
import { addAttachment, createNote, dailyNote, listTemplates } from '../library/notes';
import { VaultStore } from '../library/vaults';
import { handle, obj, optStr, str } from './ipc';
import type { SessionManager } from './session';

declare global {
  // Test mode: the id the next context menu returns, instead of showing a native menu.
  var __vxContextMenuChoice: string | null | undefined;
  var __vxContextMenus: ContextMenuItem[][] | undefined;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
export const closeConfirmed = new WeakSet<BrowserWindow>();

export function registerWorkspaceHandlers(deps: { sessions: SessionManager; testMode: boolean }): void {
  const { sessions } = deps;

  async function vault(p: unknown): Promise<VaultInfo> {
    const s = sessions.require();
    const v = await new VaultStore(s.fs).get(str(p, 'vaultPath', 1024));
    if (!v) fail('NOT_FOUND', 'This Vault no longer exists.');
    return v;
  }

  handle('library', 'files', () => sessions.require().catalog.list());

  handle('notes', 'create', async (_e, vp, folder, title, template) => {
    const v = await vault(vp);
    const f = str(folder, 'folder', 1024);
    if (f !== v.path && !f.startsWith(`${v.path}/`))
      fail('INVALID_ARGUMENT', 'New notes go inside the Vault.');
    return createNote(
      sessions.require().fs,
      v,
      f,
      str(title, 'title', 300),
      optStr(template, 'template', 1024) ?? null,
    );
  });
  handle('notes', 'templates', async (_e, vp) => listTemplates(sessions.require().fs, await vault(vp)));
  handle('notes', 'daily', async (_e, vp) => dailyNote(sessions.require().fs, await vault(vp)));
  handle('notes', 'addAttachment', async (_e, vp, name, bytes) => {
    const v = await vault(vp);
    let data: Uint8Array;
    if (bytes instanceof ArrayBuffer) data = new Uint8Array(bytes);
    else if (bytes instanceof Uint8Array) data = bytes;
    else fail('INVALID_ARGUMENT', 'bytes must be binary data.');
    if (data.byteLength > 512 * 1024 * 1024) fail('INVALID_ARGUMENT', 'The file is larger than 512 MB.');
    return addAttachment(sessions.require().fs, v, str(name, 'fileName', 255), data);
  });

  handle('window', 'contextMenu', (event, rawItems) => {
    if (!Array.isArray(rawItems) || rawItems.length > 64)
      fail('INVALID_ARGUMENT', 'items must be a short list.');
    const items: ContextMenuItem[] = rawItems.map((it, i) => {
      const o = obj(it, `items[${i}]`);
      return {
        id: str(o.id, 'id', 100),
        label: str(o.label, 'label', 200),
        enabled: o.enabled !== false,
        separatorBefore: o.separatorBefore === true,
      };
    });
    if (deps.testMode) {
      (globalThis.__vxContextMenus ??= []).push(items);
      const choice = globalThis.__vxContextMenuChoice ?? null;
      globalThis.__vxContextMenuChoice = undefined;
      return choice;
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    return new Promise<string | null>((resolve) => {
      let chosen: string | null = null;
      const template: Electron.MenuItemConstructorOptions[] = [];
      for (const it of items) {
        if (it.separatorBefore && template.length) template.push({ type: 'separator' });
        template.push({ label: it.label, enabled: it.enabled, click: () => (chosen = it.id) });
      }
      const menu = Menu.buildFromTemplate(template);
      // The close callback can run before the click handler: settle on the next tick.
      menu.popup({ ...(win ? { window: win } : {}), callback: () => setTimeout(() => resolve(chosen), 0) });
    });
  });

  handle('window', 'setChrome', (event, colors) => {
    const o = obj(colors, 'colors');
    const background = str(o.background, 'background', 7);
    const symbols = str(o.symbols, 'symbols', 7);
    if (!COLOR.test(background) || !COLOR.test(symbols)) fail('INVALID_ARGUMENT', 'Colours must be #rrggbb.');
    const height = o.height === undefined ? 44 : Math.round(Number(o.height));
    if (!Number.isFinite(height) || height < 24 || height > 88)
      fail('INVALID_ARGUMENT', 'height must be 24 to 88.');
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && process.platform !== 'darwin') {
      win.setTitleBarOverlay({ color: background, symbolColor: symbols, height });
    }
    win?.setBackgroundColor(background);
    return null;
  });

  handle('window', 'readyToClose', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      closeConfirmed.add(win);
      win.close();
    }
    return null;
  });
}
