/**
 * Byte preservation (SPECS 4.8 rules 4 and 5). The renderer only ever sees LF text;
 * this module turns bytes into that text and back, keeping BOM and line endings.
 */
import { createHash } from 'node:crypto';
import type { Eol } from '@shared/bridge';

const BOM = [0xef, 0xbb, 0xbf];

export interface DecodedText {
  text: string;
  eol: Eol;
  mixedEol: boolean;
  bom: boolean;
  finalNewline: boolean;
  /** Not valid UTF-8: shown with replacement characters and never saved. */
  readOnly: boolean;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function hasBom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2];
}

export function decodeText(bytes: Uint8Array): DecodedText {
  const bom = hasBom(bytes);
  const body = bom ? bytes.subarray(3) : bytes;
  let raw: string;
  let readOnly = false;
  try {
    raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    raw = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(body);
    readOnly = true;
  }
  let crlf = 0;
  let lf = 0;
  let first: Eol | null = null;
  for (let i = raw.indexOf('\n'); i !== -1; i = raw.indexOf('\n', i + 1)) {
    if (i > 0 && raw.charCodeAt(i - 1) === 13) {
      crlf++;
      first ??= 'crlf';
    } else {
      lf++;
      first ??= 'lf';
    }
  }
  const eol: Eol = crlf > lf ? 'crlf' : lf > crlf ? 'lf' : (first ?? 'lf');
  const text = crlf > 0 ? raw.replace(/\r\n/g, '\n') : raw;
  return { text, eol, mixedEol: crlf > 0 && lf > 0, bom, finalNewline: text.endsWith('\n'), readOnly };
}

/** Inverse of decodeText for files that do not mix line endings: identical bytes. */
export function encodeText(text: string, eol: Eol, bom: boolean): Buffer {
  const lfText = text.includes('\r\n') ? text.replace(/\r\n/g, '\n') : text;
  const body = eol === 'crlf' ? lfText.replace(/\n/g, '\r\n') : lfText;
  const encoded = Buffer.from(body, 'utf8');
  return bom ? Buffer.concat([Buffer.from(BOM), encoded]) : encoded;
}

/** Drops a leading U+FEFF from decoded text (JSON files written by other tools). */
export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
