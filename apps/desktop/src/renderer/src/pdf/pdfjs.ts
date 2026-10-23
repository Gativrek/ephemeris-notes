/**
 * pdf.js setup (SPECS 10.8) inside the strict CSP: the worker comes from 'self', CMaps
 * and standard fonts are bundled (no fetch, `connect-src 'none'`), image decoders run
 * as JavaScript (no WebAssembly); pdf.js 6 no longer evaluates code. PDFs are read through the bridge and
 * cached; the file is never modified.
 */
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { unwrap, vx } from '../lib/vx';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Serves CMaps and standard fonts through the bridge instead of the network. */
class BundledDataFactory {
  constructor(_opts: unknown) {}
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    if (kind !== 'cMapUrl' && kind !== 'standardFontDataUrl')
      throw new Error(`Unsupported pdf.js data: ${kind}`);
    return unwrap(vx().app.pdfData(kind === 'cMapUrl' ? 'cmap' : 'font', filename));
  }
}

const cache = new Map<string, { doc: Promise<PDFDocumentProxy>; used: number }>();
const MAX_DOCS = 4;

/** Loads (or reuses) a PDF from the library. */
export function loadPdf(path: string): Promise<PDFDocumentProxy> {
  const hit = cache.get(path);
  if (hit) {
    hit.used = Date.now();
    return hit.doc;
  }
  const doc = (async () => {
    const data = await unwrap(vx().fs.readBinary(path));
    return pdfjs.getDocument({
      data,
      // Never fetched: BundledDataFactory reads these through the bridge.
      cMapUrl: 'vx-pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'vx-pdfjs/standard_fonts/',
      wasmUrl: new URL('pdfjs/', document.baseURI).href,
      useWasm: false,
      useWorkerFetch: false,
      BinaryDataFactory: BundledDataFactory,
      enableXfa: false,
    }).promise;
  })();
  cache.set(path, { doc, used: Date.now() });
  doc.catch(() => cache.delete(path));
  // Keep a few documents open; the oldest is closed.
  if (cache.size > MAX_DOCS) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].used - b[1].used)[0];
    if (oldest && oldest[0] !== path) {
      cache.delete(oldest[0]);
      void oldest[1].doc.then(
        (d) => d.loadingTask.destroy(),
        () => undefined,
      );
    }
  }
  return doc;
}

/** Forgets a cached PDF (after it changed on disk). */
export function dropPdf(path: string): void {
  const hit = cache.get(path);
  if (!hit) return;
  cache.delete(path);
  void hit.doc.then(
    (d) => d.loadingTask.destroy(),
    () => undefined,
  );
}

/** Renders one page into a canvas at a CSS width; returns the canvas. */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  cssWidth: number,
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const ratio = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: scale * ratio });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
  canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

export { pdfjs };
