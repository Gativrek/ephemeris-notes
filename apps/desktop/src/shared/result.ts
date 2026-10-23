/** Every bridge call resolves to a Result. Raw errors never cross the bridge. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: VxError };

export type VxErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_PATH'
  | 'OUTSIDE_LIBRARY'
  | 'RESERVED_NAME'
  | 'NOT_FOUND'
  | 'EXISTS'
  | 'CONFLICT'
  | 'NOT_UTF8'
  | 'NO_LIBRARY'
  | 'NOT_A_LIBRARY'
  | 'ALREADY_LIBRARY'
  | 'NOT_IMPLEMENTED'
  | 'FORBIDDEN'
  | 'IO';

export interface VxError {
  code: VxErrorCode;
  message: string;
  /** Extra machine-readable detail, e.g. the current hash on CONFLICT. */
  detail?: Record<string, unknown>;
}

export class VxFailure extends Error {
  constructor(
    readonly code: VxErrorCode,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'VxFailure';
  }
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail(code: VxErrorCode, message: string, detail?: Record<string, unknown>): never {
  throw new VxFailure(code, message, detail);
}

/** Converts anything thrown into a serializable VxError. */
export function toVxError(err: unknown): VxError {
  if (err instanceof VxFailure) {
    return err.detail
      ? { code: err.code, message: err.message, detail: err.detail }
      : { code: err.code, message: err.message };
  }
  const e = err as NodeJSLikeError;
  switch (e?.code) {
    case 'ENOENT':
      return { code: 'NOT_FOUND', message: 'File or folder not found.' };
    case 'EEXIST':
      return { code: 'EXISTS', message: 'A file or folder with that name already exists.' };
    case 'EACCES':
    case 'EPERM':
      return { code: 'FORBIDDEN', message: 'Permission denied.' };
    default:
      return { code: 'IO', message: typeof e?.message === 'string' ? e.message : 'Unexpected error.' };
  }
}

interface NodeJSLikeError {
  code?: string;
  message?: unknown;
}
