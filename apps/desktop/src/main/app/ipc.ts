/**
 * IPC registration for the bridge. Every handler checks that the call comes from the
 * app's own page, validates its arguments in main, and returns a Result.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { channel } from '@shared/bridge';
import { fail, ok, toVxError, type Result } from '@shared/result';
import { isAppUrl } from './security';

export type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

let devOrigin: string | null = null;
const registered = new Set<string>();

export function setDevOrigin(origin: string | null): void {
  devOrigin = origin;
}

export function handle(ns: string, method: string, fn: Handler): void {
  const name = channel(ns, method);
  if (registered.has(name)) throw new Error(`Duplicate IPC handler ${name}`);
  registered.add(name);
  ipcMain.handle(name, async (event, ...args): Promise<Result<unknown>> => {
    try {
      const url = event.senderFrame?.url ?? '';
      if (!isAppUrl(url, devOrigin)) fail('FORBIDDEN', 'Calls are only accepted from the app.');
      const value = await fn(event, ...args);
      return ok(value === undefined ? null : value);
    } catch (err) {
      const error = toVxError(err);
      if (error.code === 'IO') console.error(`[ipc] ${name}`, err);
      return { ok: false, error };
    }
  });
}

/** Declares the bridge methods a later milestone implements. */
export function notImplemented(ns: string, method: string): void {
  handle(ns, method, () => fail('NOT_IMPLEMENTED', `${ns}.${method} is not implemented yet.`));
}

// ---- Argument validators -------------------------------------------------

export function str(v: unknown, name: string, max = 1_000_000): string {
  if (typeof v !== 'string') fail('INVALID_ARGUMENT', `${name} must be a string.`);
  if (v.length > max) fail('INVALID_ARGUMENT', `${name} is too long.`);
  return v;
}

export function optStr(v: unknown, name: string, max?: number): string | undefined {
  return v === undefined || v === null ? undefined : str(v, name, max);
}

export function bool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') fail('INVALID_ARGUMENT', `${name} must be a boolean.`);
  return v;
}

export function num(v: unknown, name: string, min = -Infinity, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    fail('INVALID_ARGUMENT', `${name} must be a number between ${min} and ${max}.`);
  }
  return v;
}

export function obj(v: unknown, name: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('INVALID_ARGUMENT', `${name} must be an object.`);
  return v as Record<string, unknown>;
}

export function optObj(v: unknown, name: string): Record<string, unknown> | undefined {
  return v === undefined || v === null ? undefined : obj(v, name);
}

export function oneOf<T extends string>(v: unknown, name: string, values: readonly T[]): T {
  if (typeof v !== 'string' || !values.includes(v as T)) {
    fail('INVALID_ARGUMENT', `${name} must be one of ${values.join(', ')}.`);
  }
  return v as T;
}

/** JSON-safe values only, bounded in size (settings, plugin data). */
export function jsonValue(v: unknown, name: string, maxBytes = 2_000_000): unknown {
  let s: string | undefined;
  try {
    s = JSON.stringify(v);
  } catch {
    fail('INVALID_ARGUMENT', `${name} must be JSON-serializable.`);
  }
  if (s === undefined) fail('INVALID_ARGUMENT', `${name} must be JSON-serializable.`);
  if (s.length > maxBytes) fail('INVALID_ARGUMENT', `${name} is too large.`);
  return JSON.parse(s) as unknown;
}
