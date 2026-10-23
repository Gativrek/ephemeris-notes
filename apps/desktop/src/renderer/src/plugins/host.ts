/**
 * The plugin host (SPECS 12.1–12.3, 12.8): loads enabled, compatible plugins after the
 * workspace's first paint, builds each one's `ctx`, tracks every registration, and on
 * disable calls `onunload` and disposes all of them. A plugin that throws in `onload`
 * is marked failed; the app continues.
 */
import {
  API_VERSION,
  type Disposable,
  type FileEntry,
  type OverlayHandle,
  type OverlayOptions,
  type Plugin,
  type PluginContext,
  type PluginFactory,
  type PluginManifest,
  type ScopedStorage,
  type SettingField,
} from '@ephemeris-notes/plugin-api';
import type { PluginInfo, StorageScope } from '@shared/bridge';
import { setBlockServices } from '../editor/pluginBlock';
import { blockRegistry } from '../editor/registry';
import { assetUrl } from '../lib/asset';
import { useCatalog } from '../lib/catalog';
import { currentTheme, onThemeChange } from '../lib/theme';
import { errorMessage, unwrap, vx } from '../lib/vx';
import { newKey, usePlugins, type PluginState } from './store';
import { indexService, inlineService, notesService, outlineService, viewsService } from './v2';

interface Loaded {
  plugin: Plugin;
  disposables: Disposable[];
  style: HTMLLinkElement | null;
}

const loaded = new Map<string, Loaded>();
const settingSetters = new Map<string, (key: string, value: unknown) => Promise<void>>();

/** Settings > Plugins writes a field through the plugin's own `ctx.settings.set`. */
export async function setPluginSetting(id: string, key: string, value: unknown): Promise<void> {
  await settingSetters.get(id)?.(key, value);
}
let notify: (msg: string, kind?: 'info' | 'error') => void = (m) => console.info(m);
export function setPluginNotifier(fn: typeof notify): void {
  notify = fn;
}

function setState(id: string, state: PluginState, error?: string): void {
  usePlugins.setState((s) => ({
    plugins: s.plugins.map((p) =>
      p.info.manifest.id === id ? { ...p, state, ...(error ? { error } : { error: undefined }) } : p,
    ),
  }));
}

function logger(id: string) {
  const tag = `[plugin ${id}]`;
  return {
    info: (...a: unknown[]) => console.info(tag, ...a),
    warn: (...a: unknown[]) => console.warn(tag, ...a),
    error: (...a: unknown[]) => console.error(tag, ...a),
  };
}

// ---- Overlays ---------------------------------------------------------------------

export function openOverlay(opts: OverlayOptions, owner: string): OverlayHandle {
  const key = newKey();
  const handle: OverlayHandle = {
    close: () => usePlugins.setState((s) => ({ overlays: s.overlays.filter((o) => o.key !== key) })),
    setTitle: (title) =>
      usePlugins.setState((s) => ({
        overlays: s.overlays.map((o) => (o.key === key ? { ...o, title } : o)),
      })),
    setDirty: (dirty) =>
      usePlugins.setState((s) => ({
        overlays: s.overlays.map((o) => (o.key === key ? { ...o, dirty } : o)),
      })),
  };
  overlayHandles.set(key, handle);
  usePlugins.setState((s) => ({
    overlays: [...s.overlays, { key, owner, opts, title: opts.title, dirty: false }],
  }));
  return handle;
}
export const overlayHandles = new Map<number, OverlayHandle>();

setBlockServices({
  openOverlay: (opts, owner) => openOverlay(opts, owner),
  log: (owner, ...a) => logger(owner).warn(...a),
});

// ---- Storage ----------------------------------------------------------------------

function scoped(id: string, scope: StorageScope, vaultPath: string | null, root: string): ScopedStorage {
  const p = vx().plugins;
  return {
    root,
    async readJson<T>(name: string, fallback: T): Promise<T> {
      const text = await unwrap(p.readText(scope, id, vaultPath, name));
      if (text === null) return fallback;
      try {
        return JSON.parse(text) as T;
      } catch {
        return fallback;
      }
    },
    writeJson: async (name, value) =>
      void (await unwrap(p.writeText(scope, id, vaultPath, name, JSON.stringify(value, null, 2) + '\n'))),
    readText: (name) => unwrap(p.readText(scope, id, vaultPath, name)),
    writeText: async (name, text) => void (await unwrap(p.writeText(scope, id, vaultPath, name, text))),
    async readBinary(name) {
      const b = await unwrap(p.readBinary(scope, id, vaultPath, name));
      return b ? (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) : null;
    },
    writeBinary: async (name, data) => void (await unwrap(p.writeBinary(scope, id, vaultPath, name, data))),
    remove: async (name) => void (await unwrap(p.remove(scope, id, vaultPath, name))),
    list: (folder) => unwrap(p.listFiles(scope, id, vaultPath, folder ?? '')) as Promise<FileEntry[]>,
    assetUrl: (name) => assetUrl(`${root}/${name}`),
  };
}

// ---- Context ----------------------------------------------------------------------

async function makeContext(manifest: PluginManifest, disposables: Disposable[]): Promise<PluginContext> {
  const id = manifest.id;
  const track = (fn: () => void): Disposable => {
    let done = false;
    const d = {
      dispose() {
        if (done) return;
        done = true;
        fn();
      },
    };
    disposables.push(d);
    return d;
  };
  const libraryRoot = await unwrap(vx().plugins.storageRoot('library', id, null)).catch(
    () => `.ephemeris/plugin-data/${id}`,
  );
  const library = scoped(id, 'library', null, libraryRoot);
  // Plugin settings live in settings.json in library scope (SPECS 12.7).
  const values = await library.readJson<Record<string, unknown>>('settings.json', {});
  usePlugins.setState((s) => ({ values: { ...s.values, [id]: values } }));
  const defaults: Record<string, unknown> = {};
  const changeListeners = new Set<(key: string, value: unknown) => void>();
  const setSetting = async (key: string, value: unknown) => {
    const next = { ...(usePlugins.getState().values[id] ?? {}), [key]: value };
    usePlugins.setState((s) => ({ values: { ...s.values, [id]: next } }));
    await library.writeJson('settings.json', next);
    for (const fn of changeListeners) {
      try {
        fn(key, value);
      } catch (err) {
        logger(id).error('settings.onChange failed', err);
      }
    }
  };
  settingSetters.set(id, setSetting);
  track(() => settingSetters.delete(id));

  return {
    manifest,
    apiVersion: API_VERSION,
    blocks: {
      register(language, renderer) {
        const off = blockRegistry.register(language, { owner: id, renderer });
        return track(off);
      },
    },
    ui: {
      openOverlay: (opts) => openOverlay(opts, id),
      notify: (message, kind) => notify(`${manifest.name}: ${message}`, kind),
      revealInFolder: (path) => void vx().shell.revealInFolder(path),
    },
    settings: {
      register(def) {
        for (const f of def.fields ?? []) defaults[f.key] = f.default;
        const key = newKey();
        usePlugins.setState((s) => ({
          settings: [
            ...s.settings,
            {
              key,
              owner: id,
              fields: def.fields ?? ([] as SettingField[]),
              ...(def.pane ? { pane: def.pane } : {}),
            },
          ],
        }));
        return track(() =>
          usePlugins.setState((s) => ({ settings: s.settings.filter((x) => x.key !== key) })),
        );
      },
      get<T>(key: string): T {
        const v = usePlugins.getState().values[id]?.[key];
        return (v === undefined ? defaults[key] : v) as T;
      },
      set: setSetting,
      onChange(cb) {
        changeListeners.add(cb);
        return track(() => changeListeners.delete(cb));
      },
    },
    help: {
      register(pages) {
        const entries = pages.map((page) => ({ owner: id, ownerName: manifest.name, page }));
        usePlugins.setState((s) => ({ help: [...s.help, ...entries] }));
        return track(() =>
          usePlugins.setState((s) => ({ help: s.help.filter((h) => !entries.includes(h)) })),
        );
      },
    },
    vault: {
      readText: async (path) => (await unwrap(vx().fs.read(path))).text,
      async readBinary(path) {
        const b = await unwrap(vx().fs.readBinary(path));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      },
      exists: async (path) => (await vx().fs.stat(path)).ok,
      list: (folder) => unwrap(vx().fs.list(folder)),
      assetUrl: (path) => assetUrl(path),
      resolve: (target, from) => useCatalog.getState().links.resolve(target, from).path,
      watch(path, cb) {
        const hit = (e: { path: string }) => {
          if (e.path === path || e.path.startsWith(`${path}/`)) cb();
        };
        const offs = [
          vx().events.onFileChanged(hit),
          vx().events.onFileCreated(hit),
          vx().events.onFileDeleted(hit),
        ];
        return track(() => offs.forEach((o) => o()));
      },
    },
    storage: {
      library,
      vault: (vaultPath) => scoped(id, 'vault', vaultPath, `${vaultPath}/.vault/plugin-data/${id}`),
    },
    commands: {
      register(cmd) {
        const entry = { id: `${id}:${cmd.id}`, title: cmd.title, owner: id, run: cmd.run };
        usePlugins.setState((s) => ({ commands: [...s.commands.filter((c) => c.id !== entry.id), entry] }));
        return track(() => usePlugins.setState((s) => ({ commands: s.commands.filter((c) => c !== entry) })));
      },
    },
    theme: {
      get current() {
        return currentTheme();
      },
      onChange(cb) {
        return track(onThemeChange(cb));
      },
      token: (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim(),
    },
    log: logger(id),
    // v2 (SPECS 12.11)
    inline: inlineService(id, track),
    index: indexService(id, track, logger(id)),
    outline: outlineService(id, track),
    views: viewsService(id, track),
    notes: notesService(id, logger(id)),
  };
}

// ---- Lifecycle --------------------------------------------------------------------

async function load(info: PluginInfo): Promise<void> {
  const id = info.manifest.id;
  if (loaded.has(id)) return;
  if (!info.compatible) {
    setState(id, 'incompatible', info.problem);
    return;
  }
  setState(id, 'loading');
  const disposables: Disposable[] = [];
  let style: HTMLLinkElement | null = null;
  try {
    if (info.manifest.styles) {
      style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = `vx-plugin://${id}/${info.manifest.styles}?v=${encodeURIComponent(info.manifest.version)}&t=${Date.now()}`;
      document.head.append(style);
    }
    // A fresh URL per load, so disable-and-enable runs a new module instance.
    const mod = (await import(
      /* @vite-ignore */ `vx-plugin://${id}/${info.manifest.main}?t=${Date.now()}`
    )) as { default?: PluginFactory };
    if (typeof mod.default !== 'function') throw new Error('main.js has no default export factory.');
    const plugin = mod.default();
    const ctx = await makeContext(info.manifest as PluginManifest, disposables);
    loaded.set(id, { plugin, disposables, style });
    await plugin.onload(ctx);
    setState(id, 'loaded');
  } catch (err) {
    logger(id).error('failed to load', err);
    for (const d of disposables.splice(0)) d.dispose();
    style?.remove();
    loaded.delete(id);
    setState(id, 'failed', errorMessage(err));
  }
}

async function unload(id: string): Promise<void> {
  const l = loaded.get(id);
  if (!l) return;
  loaded.delete(id);
  try {
    await l.plugin.onunload?.();
  } catch (err) {
    logger(id).error('onunload failed', err);
  }
  // Every registration made through ctx goes, so its blocks re-render as plain code.
  for (const d of l.disposables.splice(0).reverse()) {
    try {
      d.dispose();
    } catch {
      // Keep disposing the rest.
    }
  }
  usePlugins.setState((s) => ({ overlays: s.overlays.filter((o) => o.owner !== id) }));
  l.style?.remove();
}

export async function refreshPlugins(): Promise<void> {
  const list = await unwrap(vx().plugins.list()).catch(() => [] as PluginInfo[]);
  usePlugins.setState((s) => ({
    plugins: list.map((info) => {
      const prev = s.plugins.find((p) => p.info.manifest.id === info.manifest.id);
      const state: PluginState = loaded.has(info.manifest.id)
        ? 'loaded'
        : !info.enabled
          ? 'disabled'
          : !info.compatible
            ? 'incompatible'
            : (prev?.state ?? 'disabled');
      return {
        info,
        state,
        ...(prev?.error ? { error: prev.error } : info.problem ? { error: info.problem } : {}),
      };
    }),
  }));
}

let started = false;
/** After the workspace's first paint (SPECS 12.3 step 6). */
export async function startPlugins(): Promise<void> {
  if (started) return;
  started = true;
  await refreshPlugins();
  for (const p of usePlugins.getState().plugins) if (p.info.enabled) await load(p.info);
}

export async function setPluginEnabled(id: string, on: boolean): Promise<void> {
  await unwrap(vx().plugins.setEnabled(id, on));
  await refreshPlugins();
  const p = usePlugins.getState().plugins.find((x) => x.info.manifest.id === id);
  if (!p) return;
  if (on) await load(p.info);
  else {
    await unload(id);
    setState(id, 'disabled');
  }
}

export async function installPlugin(): Promise<PluginInfo | null> {
  const info = await unwrap(vx().plugins.install());
  if (!info) return null;
  const id = info.manifest.id;
  if (loaded.has(id)) {
    await unload(id);
    await refreshPlugins();
    const p = usePlugins.getState().plugins.find((x) => x.info.manifest.id === id);
    if (p?.info.enabled) await load(p.info);
  } else await refreshPlugins();
  return info;
}

/** App quit: every plugin's `onunload`, bounded so a plugin cannot hold the window open. */
export async function stopPlugins(): Promise<void> {
  const all = Promise.all([...loaded.keys()].map((id) => unload(id)));
  await Promise.race([all, new Promise((r) => setTimeout(r, 1000))]);
}

export function isLoaded(id: string): boolean {
  return loaded.has(id);
}
