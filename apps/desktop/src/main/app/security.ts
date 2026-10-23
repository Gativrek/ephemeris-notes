/**
 * Electron security baseline (SPECS 3.2). The renderer has no Node, runs sandboxed
 * and isolated, cannot navigate, cannot open windows, and gets no permissions.
 */
import { session, shell, type Session, type WebContents, type WebPreferences } from 'electron';

export const APP_SCHEME = 'vx-app';
export const APP_ORIGIN = `${APP_SCHEME}://app`;
export const ASSET_SCHEME = 'vx-asset';
export const PLUGIN_SCHEME = 'vx-plugin';

/** The exact SPECS 3.2 policy. Packaged builds and every test run use only this. */
export const CSP_PRODUCTION = [
  "default-src 'self'",
  `script-src 'self' ${PLUGIN_SCHEME}:`,
  `style-src 'self' 'unsafe-inline' ${PLUGIN_SCHEME}:`,
  `img-src 'self' ${ASSET_SCHEME}: data: blob:`,
  `media-src ${ASSET_SCHEME}:`,
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
].join('; ');

/**
 * Dev-server only (SPECS 3.2 amendment): Vite's hot reload needs its websocket and
 * React Refresh injects one inline script. Never used when the app is packaged.
 */
export function cspDevelopment(devOrigin: string): string {
  const ws = devOrigin.replace(/^http/, 'ws');
  return CSP_PRODUCTION.replace(`script-src 'self'`, `script-src 'self' 'unsafe-inline'`).replace(
    "connect-src 'none'",
    `connect-src 'self' ${ws}`,
  );
}

export function webPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: true,
  };
}

/** Denies every permission request (camera, notifications, clipboard-read, ...). */
export function hardenSession(ses: Session = session.defaultSession): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

export function isAppUrl(url: string, devOrigin: string | null): boolean {
  if (url.startsWith(`${APP_ORIGIN}/`)) return true;
  return devOrigin !== null && (url === devOrigin || url.startsWith(`${devOrigin}/`));
}

export function hardenWebContents(contents: WebContents, devOrigin: string | null): void {
  contents.on('will-navigate', (event, url) => {
    // Hot reload in dev reloads the same app URL; everything else is refused.
    if (!isAppUrl(url, devOrigin)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url, devOrigin)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

let externalOpener: (url: string) => Promise<void> = (url) => shell.openExternal(url);

/** Test mode replaces the system browser so tests never open one. */
export function setExternalOpener(fn: (url: string) => Promise<void>): void {
  externalOpener = fn;
}

/** Opens http(s) links in the system browser. Other schemes are refused. */
export async function openExternalSafe(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  await externalOpener(parsed.toString());
  return true;
}
