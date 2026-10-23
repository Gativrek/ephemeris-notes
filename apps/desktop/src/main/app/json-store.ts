/**
 * A small JSON document persisted atomically, used for per-machine state in the app's
 * user-data folder (SPECS 4.10) and for library-scope settings in `.ephemeris/`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite } from '../library/atomic';
import { stripBom } from '../library/encoding';

export class JsonStore<T extends Record<string, unknown>> {
  private data: T;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  private constructor(
    readonly file: string,
    initial: T,
    private readonly debounceMs: number,
  ) {
    this.data = initial;
  }

  static async open<T extends Record<string, unknown>>(
    file: string,
    fallback: T,
    debounceMs = 200,
  ): Promise<JsonStore<T>> {
    let data = fallback;
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed: unknown = JSON.parse(stripBom(raw));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        data = { ...fallback, ...(parsed as T) };
    } catch {
      // Missing or unreadable: start from the fallback. The file is written on first change.
    }
    return new JsonStore(file, data, debounceMs);
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.data[key];
  }

  all(): Readonly<T> {
    return this.data;
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    this.data = { ...this.data, [key]: value };
    this.schedule();
  }

  update(fn: (d: T) => T): void {
    this.data = fn(this.data);
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const snapshot = JSON.stringify(this.data, null, 2) + '\n';
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await atomicWrite(this.file, Buffer.from(snapshot, 'utf8'));
    });
    await this.writing;
  }
}
