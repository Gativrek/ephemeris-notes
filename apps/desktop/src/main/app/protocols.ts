/**
 * Custom protocols (SPECS 3.3). `vx-app` serves the built renderer with the CSP as a
 * real response header; `vx-asset` serves library files (with Range support for
 * video); `vx-plugin` serves installed plugin files.
 */
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { isInside } from '../library/paths';
import { APP_SCHEME, ASSET_SCHEME, PLUGIN_SCHEME } from './security';

export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
    { scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
};

export function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

const notFound = (): Response => new Response('Not found', { status: 404 });

/** Streams a file, honouring a single `Range: bytes=a-b` request. */
export async function fileResponse(
  file: string,
  request: Request,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  let size: number;
  try {
    const st = await fs.stat(file);
    if (!st.isFile()) return notFound();
    size = st.size;
  } catch {
    return notFound();
  }
  const headers: Record<string, string> = {
    'Content-Type': mimeFor(file),
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  };
  const range = request.headers.get('Range');
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] !== '' || m[2] !== '')) {
    let start: number;
    let end: number;
    if (m[1] === '') {
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
      },
    });
  }
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
}

/** Serves `dir` under `vx-app://app/`, with the CSP on every response. */
export function handleAppProtocol(dir: string, csp: string): void {
  const root = path.resolve(dir);
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return notFound();
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(root, rel);
    if (!isInside(root, file)) return notFound();
    return fileResponse(file, request, { 'Content-Security-Policy': csp });
  });
}

export type AssetResolver = (relPath: string) => Promise<string | null>;

/** `vx-asset://library/<path>`: the resolver validates the path (SPECS 4.8). */
export function handleAssetProtocol(resolve: AssetResolver): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'library') return notFound();
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return notFound();
    }
    const abs = await resolve(rel).catch(() => null);
    if (!abs) return notFound();
    return fileResponse(abs, request, { 'Cache-Control': 'no-cache' });
  });
}

export type PluginResolver = (pluginId: string, relPath: string) => Promise<string | null>;

export function handlePluginProtocol(resolve: PluginResolver): void {
  protocol.handle(PLUGIN_SCHEME, async (request) => {
    const url = new URL(request.url);
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return notFound();
    }
    const abs = await resolve(url.host, rel).catch(() => null);
    if (!abs) return notFound();
    return fileResponse(abs, request);
  });
}
