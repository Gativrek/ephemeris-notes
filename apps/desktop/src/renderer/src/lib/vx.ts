import type { Result, VxError } from '@shared/result';

/** A failed bridge call, thrown by `unwrap` so UI code can use try/catch. */
export class BridgeError extends Error {
  constructor(readonly error: VxError) {
    super(error.message);
    this.name = 'BridgeError';
  }
  get code(): VxError['code'] {
    return this.error.code;
  }
}

export async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const r = await call;
  if (!r.ok) throw new BridgeError(r.error);
  return r.value;
}

export function errorMessage(err: unknown): string {
  if (err instanceof BridgeError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export const vx = () => window.vx;
