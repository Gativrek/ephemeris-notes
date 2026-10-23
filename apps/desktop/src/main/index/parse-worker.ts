/**
 * A parse worker for the index: `analyzeNote` off the index worker's thread, so a full
 * build parses several notes at once (SPECS 16, full index under 20 s).
 */
import { parentPort } from 'node:worker_threads';
import { analyzeNote, type NumberingMode } from '@vaults/markdown';

export type ParseRequest = { id: number; text: string; numbering: NumberingMode };

const port = parentPort;
port?.on('message', (m: ParseRequest) => {
  try {
    port.postMessage({ id: m.id, ok: true, summary: analyzeNote(m.text, { numbering: m.numbering }) });
  } catch (err) {
    port.postMessage({ id: m.id, ok: false, message: err instanceof Error ? err.message : String(err) });
  }
});
