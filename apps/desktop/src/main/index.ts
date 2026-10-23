/**
 * Main process entry. Order matters: privileged schemes are registered before the
 * app is ready; protocols, session hardening and IPC are set up before any window.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, session, shell } from 'electron';
import { EVENT_CHANNEL, type Domain, type LibraryStats, type PushEvent } from '@shared/bridge';
import { DOMAIN_FOLDERS, DOMAINS } from './library/library';
import { isNote } from './library/walk';
import { registerCoreHandlers, type MachineState } from './app/handlers';
import { notImplemented, setDevOrigin } from './app/ipc';
import { JsonStore } from './app/json-store';
import { handleAppProtocol, handleAssetProtocol, registerPrivilegedSchemes } from './app/protocols';
import {
  APP_ORIGIN,
  CSP_PRODUCTION,
  cspDevelopment,
  hardenSession,
  hardenWebContents,
  webPreferences,
} from './app/security';
import { SessionManager } from './app/session';
import { installTestMode, isTestMode } from './app/test-mode';
import { Settings } from './app/settings';
import { registerVaultHandlers } from './app/vault-handlers';
import { closeConfirmed, registerWorkspaceHandlers } from './app/workspace-handlers';

const here = path.dirname(fileURLToPath(import.meta.url));

if (process.env.VX_USER_DATA) app.setPath('userData', path.resolve(process.env.VX_USER_DATA));
registerPrivilegedSchemes();
if (isTestMode()) {
  // Test windows sit off screen and are never focused; keep them rendering at full speed.
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const devOrigin = devUrl ? new URL(devUrl).origin : null;
setDevOrigin(devOrigin);

function broadcast(event: PushEvent): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send(EVENT_CHANNEL, event);
  }
}

function installMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  // macOS needs an app menu for Quit and the clipboard shortcuts.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
      ...(app.isPackaged ? [] : [{ role: 'viewMenu' as const }]),
    ]),
  );
}

type Bounds = { x: number; y: number; width: number; height: number; maximized: boolean };

function createWindow(saved: Bounds | null, onBounds: (b: Bounds) => void): BrowserWindow {
  const mac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: saved?.width ?? 1600,
    height: saved?.height ?? 1000,
    ...(saved && !isTestMode() ? { x: saved.x, y: saved.y } : {}),
    // Custom title bar (SPECS 9.2): native controls drawn over it (macOS traffic
    // lights; Windows and Linux use the title-bar overlay, GOALS Q15 decision).
    titleBarStyle: 'hidden',
    ...(mac
      ? { trafficLightPosition: { x: 16, y: 14 } }
      : { titleBarOverlay: { color: '#eceff2', symbolColor: '#1b1f25', height: 44 } }),
    minWidth: 1280,
    minHeight: 800,
    show: false,
    // Test runs never put a window on screen.
    ...(isTestMode() ? { x: -32000, y: -32000, skipTaskbar: true, focusable: true } : {}),
    backgroundColor: '#fbfcfc',
    title: '{AppName}',
    webPreferences: {
      ...webPreferences(path.join(here, '../preload/index.cjs')),
      ...(isTestMode() ? { backgroundThrottling: false } : {}),
    },
  });
  hardenWebContents(win.webContents, devOrigin);
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    });
  }
  if (!isTestMode()) {
    win.once('ready-to-show', () => {
      if (saved?.maximized) win.maximize();
      win.show();
    });
  } else {
    // Shown without focus at an off-screen position: rendering runs, the desktop is untouched.
    win.once('ready-to-show', () => win.showInactive());
  }
  const remember = () => {
    if (win.isMinimized() || win.isFullScreen()) return;
    const maximized = win.isMaximized();
    const b = maximized ? (saved ?? win.getNormalBounds()) : win.getBounds();
    onBounds({ ...b, maximized });
  };
  win.on('resized', remember);
  win.on('moved', remember);
  win.on('maximize', remember);
  win.on('unmaximize', remember);
  // Save before closing (SPECS 4.8 rule 8): ask the renderer, close once it answers.
  win.on('close', (event) => {
    if (closeConfirmed.has(win) || win.webContents.isDestroyed()) return;
    event.preventDefault();
    win.webContents.send(EVENT_CHANNEL, { type: 'app.beforeClose', payload: null });
    setTimeout(() => {
      if (!win.isDestroyed()) {
        closeConfirmed.add(win);
        win.close();
      }
    }, 4000);
  });
  void win.loadURL(devUrl ?? `${APP_ORIGIN}/index.html`);
  return win;
}

async function main(): Promise<void> {
  await app.whenReady();
  hardenSession();
  installMenu();

  handleAppProtocol(path.join(here, '../renderer'), CSP_PRODUCTION);
  if (devOrigin) {
    const csp = cspDevelopment(devOrigin);
    session.defaultSession.webRequest.onHeadersReceived({ urls: [`${devOrigin}/*`] }, (details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
    });
  }

  const userData = app.getPath('userData');
  const state = await JsonStore.open<MachineState>(path.join(userData, 'state.json'), { lastLibrary: null });
  const machineSettings = await JsonStore.open<Record<string, unknown>>(
    path.join(userData, 'settings.json'),
    {},
  );
  const testMode = isTestMode() ? installTestMode(userData) : null;
  const sessions = new SessionManager(broadcast, testMode?.trash ?? ((abs) => shell.trashItem(abs)));
  const settings = new Settings(machineSettings, broadcast);
  sessions.onOpenChanged((s) => settings.attach(s));
  sessions.onWatch((e) => {
    if (e.path === '.vaults/settings.json') void settings.reloadLibrary();
  });

  handleAssetProtocol(async (rel) => {
    const s = sessions.current;
    if (!s) return null;
    const { abs } = await s.root.resolve(rel, { allowHidden: true });
    return abs;
  });

  const stats = async (): Promise<LibraryStats> => {
    const s = sessions.require();
    const notes = { academic: 0, work: 0, personal: 0 } as Record<Domain, number>;
    const { files } = await s.catalog.list();
    for (const d of DOMAINS) {
      const prefix = `${DOMAIN_FOLDERS[d]}/`;
      for (const f of files) if (f.path.startsWith(prefix) && isNote(f.path)) notes[d]++;
    }
    return { notes };
  };

  registerCoreHandlers({
    sessions,
    state,
    settings,
    isPackaged: app.isPackaged,
    stats,
    reveal: testMode?.reveal ?? ((abs) => shell.showItemInFolder(abs)),
  });
  registerVaultHandlers({ sessions, state, broadcast });
  registerWorkspaceHandlers({ sessions, testMode: testMode !== null });
  for (const m of ['search', 'backlinks', 'resolve', 'outline', 'notesIn']) notImplemented('index', m);

  const last = state.get('lastLibrary');
  if (typeof last === 'string' && process.env.VX_NO_REOPEN !== '1') {
    await sessions.open(last).catch(() => state.set('lastLibrary', null));
  }

  const savedBounds = (state.get('windowBounds') as Bounds | undefined) ?? null;
  const open = () => createWindow(savedBounds, (b) => state.set('windowBounds', b));
  open();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) open();
  });

  let flushed = false;
  app.on('before-quit', (event) => {
    if (flushed) return;
    event.preventDefault();
    flushed = true;
    void Promise.allSettled([state.flush(), machineSettings.flush(), sessions.close(false)]).then(() =>
      app.quit(),
    );
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

void main();
