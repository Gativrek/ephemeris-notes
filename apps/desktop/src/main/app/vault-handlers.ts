/**
 * `vx.vaults` and `vx.ui` handlers (M1). Vault metadata goes through VaultStore;
 * per-machine UI state is kept in user data, keyed by library id (SPECS 4.10).
 */
import type { CoverInput, Domain, PushEvent, VaultInput } from '@shared/bridge';
import { fail } from '@shared/result';
import { DOMAINS } from '../library/library';
import { VaultStore } from '../library/vaults';
import type { WatchEvent } from '../library/watcher';
import { handle, jsonValue, num, obj, oneOf, str } from './ipc';
import type { JsonStore } from './json-store';
import type { SessionManager } from './session';

function coverInput(v: unknown): CoverInput | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const o = obj(v, 'cover');
  const focus = obj(o.focus, 'cover.focus');
  const out: CoverInput = {
    focus: { x: num(focus.x, 'focus.x', 0, 1), y: num(focus.y, 'focus.y', 0, 1) },
    zoom: num(o.zoom, 'zoom', 1, 2.5),
  };
  if (o.bytes !== undefined) {
    if (o.bytes instanceof ArrayBuffer) out.bytes = o.bytes;
    else if (o.bytes instanceof Uint8Array) out.bytes = o.bytes.slice().buffer;
    else fail('INVALID_ARGUMENT', 'cover.bytes must be binary data.');
  }
  return out;
}

function vaultInput(v: unknown): VaultInput {
  const o = obj(v, 'input');
  const input: VaultInput = {
    name: str(o.name, 'name', 1000),
    domain: oneOf<Domain>(o.domain ?? 'academic', 'domain', DOMAINS),
  };
  const cover = coverInput(o.cover);
  if (cover !== undefined) input.cover = cover;
  return input;
}

const vaultPath = (v: unknown) => str(v, 'path', 1024);

/** True when a watcher event can change the Vault list or a Vault's card. */
export function affectsVaults(e: WatchEvent): boolean {
  const segs = e.path.split('/');
  if (segs.length <= 2) return true; // A Domain folder or a Vault folder itself.
  if (segs[2] === '.vault') return true;
  return e.path.toLowerCase().endsWith('.md'); // Counts and "edited" times.
}

export function registerVaultHandlers(deps: {
  sessions: SessionManager;
  state: JsonStore<Record<string, unknown>>;
  broadcast: (e: PushEvent) => void;
}): void {
  const { sessions, state, broadcast } = deps;
  const store = () => new VaultStore(sessions.require().fs);
  const changed = <T>(value: T): T => {
    broadcast({ type: 'vaults.changed', payload: null });
    return value;
  };

  let timer: NodeJS.Timeout | null = null;
  sessions.onWatch((e) => {
    if (!affectsVaults(e)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => broadcast({ type: 'vaults.changed', payload: null }), 250);
  });

  handle('vaults', 'list', () => store().list());
  handle('vaults', 'get', (_e, p) => store().get(vaultPath(p)));
  handle('vaults', 'create', async (_e, input) => changed(await store().create(vaultInput(input))));
  handle('vaults', 'update', async (_e, p, input) => {
    const { name, cover } = vaultInput({ ...obj(input, 'input'), domain: 'academic' });
    return changed(await store().update(vaultPath(p), cover === undefined ? { name } : { name, cover }));
  });
  handle('vaults', 'moveImpact', (_e, p) => store().moveImpact(vaultPath(p)));
  handle('vaults', 'move', async (_e, p, to) =>
    changed(await store().move(vaultPath(p), oneOf<Domain>(to, 'to', DOMAINS))),
  );
  handle('vaults', 'remove', async (_e, p, typed) => {
    await store().remove(vaultPath(p), str(typed, 'typedName', 1000));
    return changed(null);
  });
  handle('vaults', 'nonVaultFolders', () => store().nonVaultFolders());
  handle('vaults', 'makeVault', async (_e, p) => changed(await store().makeVault(vaultPath(p))));

  // ---- ui state ------------------------------------------------------------
  const KEY = /^[a-z][a-zA-Z0-9_.:-]{0,200}$/;
  const uiKey = (k: unknown) => {
    const key = str(k, 'key', 256);
    if (!KEY.test(key)) fail('INVALID_ARGUMENT', 'Invalid state key.');
    return key;
  };
  const bucket = (): Record<string, unknown> => {
    const id = sessions.require().info.id;
    const all = (state.get('ui') as Record<string, Record<string, unknown>> | undefined) ?? {};
    return all[id] ?? {};
  };
  handle('ui', 'get', (_e, k) => bucket()[uiKey(k)] ?? null);
  handle('ui', 'set', (_e, k, v) => {
    const key = uiKey(k);
    const value = jsonValue(v, 'value', 500_000);
    const id = sessions.require().info.id;
    state.update((s) => {
      const all = { ...((s.ui as Record<string, Record<string, unknown>> | undefined) ?? {}) };
      all[id] = { ...(all[id] ?? {}), [key]: value };
      return { ...s, ui: all };
    });
    return null;
  });
}
