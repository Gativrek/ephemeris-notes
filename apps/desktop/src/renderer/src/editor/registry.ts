/**
 * The fenced-block renderer registry (SPECS 10.10): `language → renderer`. Plugins
 * register through `ctx.blocks` (M5); the core registers none in v1. Blocks without a
 * renderer render as plain code with a "No renderer for …" note.
 */

export interface RegisteredRenderer {
  owner: string;
  /** Mounts a rendering into `el`; returns a cleanup function. Errors are caught by the host. */
  mount(
    el: HTMLElement,
    block: RenderBlock,
    host: RenderHost,
  ): (() => void) | void | Promise<(() => void) | void>;
  /** Optional in-place update; return true when handled. */
  update?(block: RenderBlock): boolean;
}

export interface RenderBlock {
  language: string;
  infoString: string;
  args: { positional: string[]; named: Record<string, string> };
  source: string;
  version: number;
  notePath: string;
  vaultPath: string | null;
  frontmatter: Readonly<Record<string, unknown>>;
}

export interface RenderHost {
  readOnly: boolean;
  signal: AbortSignal;
  updateSource(next: string, opts?: { expectedVersion?: number }): Promise<boolean>;
}

type Listener = () => void;

class BlockRegistry {
  private readonly renderers = new Map<string, RegisteredRenderer>();
  private readonly listeners = new Set<Listener>();
  private version = 0;

  register(language: string, renderer: RegisteredRenderer): () => void {
    const key = language.toLowerCase();
    this.renderers.set(key, renderer);
    this.changed();
    return () => {
      if (this.renderers.get(key) === renderer) {
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
