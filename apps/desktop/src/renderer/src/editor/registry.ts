/**
 * The fenced-block renderer registry (SPECS 10.10): `language → renderer`. Plugins
 * register through `ctx.blocks` (SPECS 12.4); the core registers none in v1. Blocks
 * without a renderer render as plain code with a "No renderer for …" note.
 */
import type { BlockRenderer } from '@ephemeris-notes/plugin-api';

export interface RegisteredRenderer {
  /** The plugin id (shown in error states). */
  owner: string;
  renderer: BlockRenderer;
}

type Listener = () => void;

class BlockRegistry {
  private readonly renderers = new Map<string, RegisteredRenderer>();
  private readonly listeners = new Set<Listener>();
  private version = 0;

  register(language: string, entry: RegisteredRenderer): () => void {
    const key = language.toLowerCase();
    this.renderers.set(key, entry);
    this.changed();
    return () => {
      if (this.renderers.get(key) === entry) {
        this.renderers.delete(key);
        this.changed();
      }
    };
  }

  get(language: string): RegisteredRenderer | undefined {
    return this.renderers.get(language.toLowerCase());
  }

  get changeVersion(): number {
    return this.version;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}

export const blockRegistry = new BlockRegistry();

/** A stable number for a block body: changes whenever the source changes. */
export function sourceVersion(source: string): number {
  let h = 2166136261;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) ^ source.length;
}
