/**
 * The only bridge between the renderer and the system (SPECS 3.4): one frozen
 * `window.vx` object. Calls are forwarded to main, which validates every argument.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { BRIDGE_METHODS, EVENT_CHANNEL, channel, type PushEvent, type VxBridge } from '@shared/bridge';
import type { Result } from '@shared/result';

type Listener = (payload: never) => void;
const listeners = new Map<PushEvent['type'], Set<Listener>>();

ipcRenderer.on(EVENT_CHANNEL, (_event, message: PushEvent) => {
  const set = listeners.get(message.type);
  if (!set) return;
  for (const fn of set) {
    try {
      (fn as (p: unknown) => void)(message.payload);
    } catch (err) {
      console.error('[vx] listener failed', err);
    }
  }
});

function subscribe(type: PushEvent['type'], fn: Listener): () => void {
  if (typeof fn !== 'function') throw new TypeError('Listener must be a function.');
  let set = listeners.get(type);
  if (!set) listeners.set(type, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

function namespace<NS extends keyof typeof BRIDGE_METHODS>(
  ns: NS,
): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const out: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const method of BRIDGE_METHODS[ns]) {
    out[method] = (...args: unknown[]) => ipcRenderer.invoke(channel(ns, method), ...args);
  }
  return out;
}

const forbidden = (message: string): Promise<Result<null>> =>
  Promise.resolve({ ok: false, error: { code: 'FORBIDDEN', message } });

const shellNs = namespace('shell');
const settingsNs = namespace('settings');
const indexNs = namespace('index');
const libraryNs = namespace('library');
const vaultsNs = namespace('vaults');

const vx = {
  library: {
    ...libraryNs,
    onChanged: (cb: Listener) => subscribe('library.changed', cb),
    onFilesChanged: (cb: Listener) => subscribe('catalog.changed', cb),
  },
  notes: namespace('notes'),
  fs: namespace('fs'),
  vaults: {
    ...vaultsNs,
    onChanged: (cb: Listener) => subscribe('vaults.changed', cb),
  },
  ui: namespace('ui'),
  index: {
    ...indexNs,
    onChanged: (cb: Listener) => subscribe('index.changed', cb),
  },
  settings: {
    ...settingsNs,
    onChanged: (cb: (key: string, value: unknown) => void) =>
      subscribe('settings.changed', ((p: { key: string; value: unknown }) => cb(p.key, p.value)) as Listener),
  },
  window: {
    ...namespace('window'),
    onBeforeClose: (cb: Listener) => subscribe('app.beforeClose', cb),
  },
  shell: {
    ...shellNs,
    // External links open only in response to a real user gesture (SPECS 3.2).
    openExternal: (url: unknown) =>
      navigator.userActivation?.isActive
        ? (shellNs.openExternal as (u: unknown) => Promise<unknown>)(url)
        : forbidden('External links open only after a click.'),
  },
  events: {
    onFileChanged: (cb: Listener) => subscribe('file.changed', cb),
    onFileCreated: (cb: Listener) => subscribe('file.created', cb),
    onFileDeleted: (cb: Listener) => subscribe('file.deleted', cb),
  },
} as unknown as VxBridge;

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

contextBridge.exposeInMainWorld('vx', deepFreeze(vx));
