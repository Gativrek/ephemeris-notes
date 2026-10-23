/**
 * Note embeds (`![[Note]]`, `![[Note#Heading]]`, SPECS 10.7): the target section,
 * rendered read-only by the same editor, in a framed block with a link to open it.
 * At most three levels deep, with cycle detection.
 */
import { WidgetType, type EditorView } from '@codemirror/view';
import { analyzeNote } from '@ephemeris-notes/markdown';
import { editorContext, type EditorContext } from './context';
import { linkAttrs } from './widgets';

const MAX_DEPTH = 3;

type ReadOnlyFactory = (parent: HTMLElement, text: string, ctx: EditorContext) => { destroy(): void };
let readOnlyFactory: ReadOnlyFactory | null = null;

/** setup.ts installs the factory (avoids an import cycle). */
export function setReadOnlyFactory(f: ReadOnlyFactory): void {
  readOnlyFactory = f;
}

/** The text of `heading`'s section: from the heading to the next one of the same or a higher level. */
export function sectionOf(text: string, heading: string | null): string | null {
  if (!heading) return text;
  const s = analyzeNote(text);
  const key = heading.trim().toLowerCase();
  const i = s.headings.findIndex((h) => h.text.toLowerCase() === key);
  if (i < 0) return null;
  const h = s.headings[i]!;
  const next = s.headings.slice(i + 1).find((x) => x.level <= h.level);
  return text.slice(h.from, next ? next.from : text.length).replace(/\s+$/, '\n');
}

export class NoteEmbedWidget extends WidgetType {
  private destroyFn: (() => void) | null = null;
  constructor(
    readonly path: string,
    readonly heading: string | null,
    readonly target: string,
  ) {
    super();
  }
  override eq(o: NoteEmbedWidget): boolean {
    return o.path === this.path && o.heading === this.heading;
  }
  toDOM(view: EditorView): HTMLElement {
    const ctx = view.state.facet(editorContext);
    const box = document.createElement('div');
    box.className = 'vx-embed';
    const bar = document.createElement('div');
    bar.className = 'vx-embed__bar';
    const link = document.createElement('span');
    link.className = 'vx-cm-link';
    linkAttrs(link, { target: this.target, heading: this.heading, block: null, page: null, path: this.path });
    link.textContent = this.heading ? `${this.target} › ${this.heading}` : this.target;
    bar.append(link);
    const body = document.createElement('div');
    body.className = 'vx-embed__body';
    box.append(bar, body);

    const chain = [...ctx.embedChain, ctx.path];
    if (chain.includes(this.path)) {
      body.textContent = 'This note embeds itself; the embed is not repeated.';
      body.classList.add('vx-block-note');
      return box;
    }
    if (chain.length > MAX_DEPTH) {
      body.textContent = 'Embeds are shown at most three levels deep.';
      body.classList.add('vx-block-note');
      return box;
    }
    void ctx.loadNote(this.path).then((text) => {
      if (text === null) {
        body.textContent = 'This note could not be read.';
        body.classList.add('vx-block-note');
        return;
      }
      const section = sectionOf(text, this.heading);
      if (section === null) {
        body.textContent = `No heading "${this.heading}" in this note.`;
        body.classList.add('vx-block-note');
        return;
      }
      if (!readOnlyFactory) return;
      const nested = readOnlyFactory(body, section, { ...ctx, path: this.path, embedChain: chain });
      this.destroyFn = () => nested.destroy();
      view.requestMeasure();
    });
    return box;
  }
  override destroy(): void {
    this.destroyFn?.();
    this.destroyFn = null;
  }
  override ignoreEvent(e: Event): boolean {
    return !(e.target as HTMLElement).closest('[data-vx-link]');
  }
}
