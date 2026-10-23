/**
 * A small pool of parse workers. `analyze` resolves with the same summary as calling
 * `analyzeNote` in place; if a worker fails, the note is parsed on this thread instead.
 */
import type { Worker } from 'node:worker_threads';
import { analyzeNote, type NoteSummary, type NumberingMode } from '@vaults/markdown';

type Pending = { resolve: (s: NoteSummary) => void; text: string; numbering: NumberingMode };

export class ParsePool {
  private readonly workers: Worker[] = [];
  private readonly pending = new Map<number, Pending>();
  private next = 1;
  private turn = 0;

  constructor(spawn: () => Worker, size: number) {
    for (let i = 0; i < size; i++) {
      const w = spawn();
      w.unref();
      w.on('message', (m: { id: number; ok: boolean; summary?: NoteSummary }) => {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        p.resolve(m.ok && m.summary ? m.summary : analyzeNote(p.text, { numbering: p.numbering }));
      });
      w.on('error', (err) => console.error('[parse worker]', err));
      this.workers.push(w);
    }
  }

  analyze(text: string, numbering: NumberingMode): Promise<NoteSummary> {
    if (this.workers.length === 0) return Promise.resolve(analyzeNote(text, { numbering }));
    const id = this.next++;
    const w = this.workers[this.turn++ % this.workers.length]!;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, text, numbering });
      w.postMessage({ id, text, numbering });
    });
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.splice(0).map((w) => w.terminate()));
  }
}
