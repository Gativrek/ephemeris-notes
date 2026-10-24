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
import { handle, setDevOrigin } from './app/ipc';
import { JsonStore } from './app/json-store';
import {
  handleAppProtocol,
  handleAssetProtocol,
  handlePluginProtocol,
  registerPrivilegedSchemes,
} from './app/protocols';
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
import { execGit, GIT_ENABLED_KEY, GIT_INTERVAL_KEY, GitAutoCommit } from './library/git';
import { registerVaultHandlers } from './app/vault-handlers';
import { registerIndexHandlers, renameWithLinks } from './app/index-handlers';
import { IndexClient } from './index/client';
import createIndexWorker from './index/worker?nodeWorker';
import createWatchWorker from './library/watch-worker?nodeWorker';
import { workerBackend } from './library/watch-backend';
import { closeConfirmed, registerWorkspaceHandlers } from './app/workspace-handlers';
import { registerAppHandlers } from './app/app-handlers';
import { enabledPlugins, registerPluginHandlers } from './app/plugin-handlers';
import { PluginManager } from './plugins/manager';

const here = path.dirname(fileURLToPath(import.meta.url));

// Per-machine data lives in `ephemeris-notes` (the internal name); people see "Ephemeris".
if (process.env.VX_USER_DATA) app.setPath('userData', path.resolve(process.env.VX_USER_DATA));
else app.setPath('userData', path.join(app.getPath('appData'), 'ephemeris-notes'));
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
    // Packaged builds take the icon from the executable; dev runs use the rendered PNG.
    ...(app.isPackaged ? {} : { icon: path.join(here, '../../build/icon.png') }),
    title: 'Ephemeris',
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
  // chokidar's scan of a large library would stall the window's frames on this thread.
  sessions.setWatchBackend((roots) => workerBackend(() => createWatchWorker({ workerData: roots })));
  const settings = new Settings(machineSettings, broadcast);
  sessions.onOpenChanged((s) => settings.attach(s));
  sessions.onWatch((e) => {
    if (e.path === '.ephemeris/settings.json') void settings.reloadLibrary();
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

  // The index (SPECS 6.1): one worker per open library, fed by every change.
  const index = new IndexClient((init) => createIndexWorker({ workerData: init }), broadcast);
  sessions.onOpenChanged(async (s) => {
    if (!s) return index.stop();
    const numbering = settings.get('math.numbering') === 'labeled' ? 'labeled' : 'all';
    await index.start({ userData, libraryId: s.info.id, rootAbs: s.root.root, numbering });
  });
  sessions.onPathsChanged((rels) => index.touch(rels));
  sessions.onWatcherRestart(() => void index.call('sync').catch(() => undefined));
  const rename = (from: unknown, to: unknown, updateLinks: boolean) =>
    renameWithLinks(sessions, index, from, to, updateLinks);

  registerCoreHandlers({
    sessions,
    state,
    settings,
    isPackaged: app.isPackaged,
    stats,
    rename,
    reveal: testMode?.reveal ?? ((abs) => shell.showItemInFolder(abs)),
  });
  registerVaultHandlers({ sessions, state, broadcast, rename: (from, to) => rename(from, to, true) });
  registerIndexHandlers({ sessions, index });
  registerAppHandlers(path.join(here, '../renderer'));

  // Optional git auto-commit (SPECS 4.11): off by default, per machine.
  const git = new GitAutoCommit(execGit(), () => ({
    enabled: machineSettings.get(GIT_ENABLED_KEY) === true,
    intervalMinutes: Math.min(1440, Math.max(1, Number(machineSettings.get(GIT_INTERVAL_KEY)) || 10)),
  }));
  sessions.onOpenChanged((s) => git.setRoot(s?.root.root ?? null));
  git.start();
  handle('library', 'gitStatus', () => git.status());
  handle('library', 'gitCommitNow', async () => {
    await git.commitNow();
    return git.status();
  });

  // Plugins (SPECS 12): per machine, in user data; served from vx-plugin://<id>/.
  const plugins = new PluginManager(path.join(userData, 'plugins'), () => enabledPlugins(machineSettings));
  handlePluginProtocol((id, rel) => plugins.resolveFile(id, rel));
  registerPluginHandlers({
    sessions,
    manager: plugins,
    settings: machineSettings,
    isPackaged: app.isPackaged,
  });
  registerWorkspaceHandlers({ sessions, testMode: testMode !== null });

  // The window loads while the last library reopens; `library.current` waits for it.
  const last = state.get('lastLibrary');
  if (typeof last === 'string' && process.env.VX_NO_REOPEN !== '1') {
    void sessions.restore(last).catch(() => state.set('lastLibrary', null));
  }

  const savedBounds = (state.get('windowBounds') as Bounds | undefined) ?? null;
  const open = () => createWindow(savedBounds, (b) => state.set('windowBounds', b));
  const first = open();
  sessions.setWatcherGate(
    new Promise((resolve) => {
      first.webContents.once('did-finish-load', () => setTimeout(resolve, 500));
      setTimeout(resolve, 4000);
    }),
  );
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) open();
  });

  let flushed = false;
  app.on('before-quit', (event) => {
    quitting = true;
    if (flushed) return;
    event.preventDefault();
    flushed = true;
    void Promise.allSettled([state.flush(), machineSettings.flush(), sessions.close(false)]).then(() =>
      app.quit(),
    );
  });
}

/**
 * A quit holds each window's close until its notes are saved, and Electron cancels a quit
 * whose window close was held. On macOS the app outlives its windows, so a quit (Cmd+Q, or
 * the test harness) would end with no windows and the app still running: finish it here.
 */
let quitting = false;

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || quitting) app.quit();
});

void main();
