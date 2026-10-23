/**
 * Widgets drawn in place of Markdown source on inactive lines (SPECS 10.1–10.7, 10.10).
 */
import { WidgetType, type EditorView } from '@codemirror/view';
import type { YamlValue } from '@vaults/markdown';
import { editorContext } from './context';
import { renderMath } from './math';

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
export const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

export interface LinkModel {
  text: string;
  target: string;
  heading: string | null;
  block: string | null;
  page: number | null;
  path: string | null;
  candidates: string[];
  pdf: boolean;
}

/** Marks an element as a followable link for the click handler. */
export function linkAttrs(
  el: HTMLElement,
  link: Pick<LinkModel, 'target' | 'heading' | 'block' | 'page' | 'path'>,
): void {
  el.dataset.vxLink = '1';
  el.dataset.target = link.target;
  if (link.heading) el.dataset.heading = link.heading;
  if (link.block) el.dataset.block = link.block;
  if (link.page !== null) el.dataset.page = String(link.page);
  if (link.path) el.dataset.path = link.path;
}

export function linkClass(link: Pick<LinkModel, 'path' | 'candidates'>): string {
  if (!link.path) return 'vx-cm-link vx-cm-link--missing';
  return link.candidates.length ? 'vx-cm-link vx-cm-link--ambiguous' : 'vx-cm-link';
}

export class LinkWidget extends WidgetType {
  constructor(readonly link: LinkModel) {
    super();
  }
  override eq(other: LinkWidget): boolean {
    const a = this.link;
    const b = other.link;
    return (
      a.text === b.text &&
      a.path === b.path &&
      a.target === b.target &&
      a.heading === b.heading &&
      a.candidates.length === b.candidates.length
    );
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = linkClass(this.link);
    linkAttrs(el, this.link);
    if (this.link.pdf) {
      const badge = document.createElement('span');
      badge.className = 'vx-pdf';
      badge.textContent = 'PDF';
      badge.style.marginRight = '6px';
      el.append(badge);
      el.classList.add('vx-link--pdf');
    }
    el.append(this.link.text);
    if (this.link.candidates.length) el.title = `Ambiguous: ${this.link.candidates.join(', ')}`;
    else if (!this.link.path) el.title = `"${this.link.target}" does not exist yet. Click to create it.`;
    return el;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

export class InlineMathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }
  override eq(o: InlineMathWidget): boolean {
    return o.tex === this.tex && o.display === this.display;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = renderMath(this.tex, this.display, view.state.facet(editorContext).macros);
    el.classList.add('vx-math-inline');
    // KaTeX output has no text positions: a click puts the cursor inside the math, revealing it.
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const pos = view.posAtDOM(el);
      view.dispatch({ selection: { anchor: pos + (this.display ? 2 : 1) } });
      view.focus();
    });
    return el;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

export class DisplayMathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly number: string | null,
    readonly label: string | null,
    readonly from: number,
  ) {
    super();
  }
  override eq(o: DisplayMathWidget): boolean {
    return o.tex === this.tex && o.number === this.number && o.label === this.label;
  }
  toDOM(view: EditorView): HTMLElement {
    const fig = document.createElement('figure');
    fig.className = 'vx-math';
    fig.dataset.from = String(this.from);
    fig.setAttribute('aria-label', this.label ? `Equation ${this.label}` : 'Equation');
    if (this.label) fig.dataset.label = this.label;
    fig.append(renderMath(this.tex, true, view.state.facet(editorContext).macros));
    if (this.number !== null) {
      const n = document.createElement('span');
      n.className = 'vx-math__num';
      n.textContent = `(${this.number})`;
      fig.append(n);
    }
    // Clicking the equation puts the cursor inside it, revealing the source.
    fig.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from + 2 } });
      view.focus();
    });
    return fig;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly width: number | null,
  ) {
    super();
  }
  override eq(o: ImageWidget): boolean {
    return o.url === this.url && o.width === this.width;
  }
  toDOM(): HTMLElement {
    const img = document.createElement('img');
    img.className = 'vx-embed-img';
    img.src = this.url;
    img.alt = this.alt;
    img.draggable = false;
    if (this.width) img.style.width = `${this.width}px`;
    return img;
  }
}

export class VideoWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly width: number | null,
  ) {
    super();
  }
  override eq(o: VideoWidget): boolean {
    return o.url === this.url && o.width === this.width;
  }
  toDOM(): HTMLElement {
    const v = document.createElement('video');
    v.className = 'vx-embed-video';
    v.controls = true;
    v.preload = 'metadata';
    v.src = this.url;
    if (this.width) v.style.width = `${this.width}px`;
    return v;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly at: number,
  ) {
    super();
  }
  override eq(o: CheckboxWidget): boolean {
    return o.checked === this.checked && o.at === this.at;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'vx-cm-task';
    box.checked = this.checked;
    box.setAttribute('aria-label', this.checked ? 'Done' : 'To do');
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      e.preventDefault();
      if (view.state.readOnly) return;
      // `[ ]` ↔ `[x]`: one edit of the character between the brackets.
      view.dispatch({
        changes: { from: this.at + 1, to: this.at + 2, insert: this.checked ? ' ' : 'x' },
        userEvent: 'input.toggleTask',
      });
    });
    return box;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

export class HrWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'vx-cm-hr';
    return el;
  }
}

/** The fence line of an inactive code block: file name or language, and a copy button. */
export class CodeBarWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly name: string,
    readonly code: string,
  ) {
    super();
  }
  override eq(o: CodeBarWidget): boolean {
    return o.lang === this.lang && o.name === this.name && o.code === this.code;
  }
  toDOM(): HTMLElement {
    const bar = document.createElement('span');
    bar.className = 'vx-code__bar';
    bar.style.display = 'flex';
    bar.style.borderBottom = '0';
    bar.style.padding = '0';
    bar.style.height = '28px';
    const name = document.createElement('span');
    name.textContent = this.name;
    const lang = document.createElement('span');
    lang.className = 'vx-code__lang';
    lang.textContent = this.lang;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'vx-icon-btn';
    copy.setAttribute('aria-label', 'Copy code');
    copy.title = 'Copy code';
    copy.innerHTML =
      '<svg class="vx-icon" viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>';
    copy.addEventListener('mousedown', (e) => e.preventDefault());
    copy.addEventListener('click', (e) => {
      e.preventDefault();
      void navigator.clipboard?.writeText(this.code);
    });
    bar.append(name, lang, copy);
    return bar;
  }
  override ignoreEvent(e: Event): boolean {
    return e.type !== 'mousedown' || (e.target as HTMLElement).closest('button') !== null;
  }
}

export class EmptyWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    return document.createElement('span');
  }
}

function yamlText(v: YamlValue): string {
  if (v === null) return '';
  if (Array.isArray(v)) return v.map(yamlText).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Frontmatter as a compact property list (SPECS 10.6). */
export class PropertiesWidget extends WidgetType {
  constructor(
    readonly data: { [k: string]: YamlValue },
    readonly from: number,
  ) {
    super();
  }
  override eq(o: PropertiesWidget): boolean {
    return JSON.stringify(o.data) === JSON.stringify(this.data);
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div');
    box.className = 'vx-props';
    box.setAttribute('aria-label', 'Properties');
    const entries = Object.entries(this.data);
    if (entries.length === 0) {
      const k = document.createElement('span');
      k.className = 'vx-props__key';
      k.textContent = 'No properties';
      box.append(k);
    }
    for (const [key, value] of entries) {
      const k = document.createElement('span');
      k.className = 'vx-props__key';
      k.textContent = key;
      const v = document.createElement('span');
      v.className = 'vx-props__value';
      if (key === 'tags' || key === 'aliases') {
        const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
        for (const item of list) {
          const chip = document.createElement('span');
          chip.className = 'vx-chip';
          chip.textContent =
            key === 'tags' ? `#${String(item).trim().replace(/^#/, '')}` : String(item).trim();
          v.append(chip);
        }
      } else {
        v.textContent = yamlText(value);
      }
      box.append(k, v);
    }
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from + 4 } });
      view.focus();
    });
    return box;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

export class WarningWidget extends WidgetType {
  constructor(readonly message: string) {
    super();
  }
  override eq(o: WarningWidget): boolean {
    return o.message === this.message;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vx-block-note vx-props__warn';
    el.textContent = this.message;
    return el;
  }
}

/** A GFM table, rendered read-only; clicking a cell reveals the source. */
export class TableWidget extends WidgetType {
  constructor(
    readonly rows: string[][],
    readonly from: number,
    readonly renderInline: (text: string) => Node,
  ) {
    super();
  }
  override eq(o: TableWidget): boolean {
    return JSON.stringify(o.rows) === JSON.stringify(this.rows);
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'vx-table-wrap';
    const table = document.createElement('table');
    table.className = 'vx-table';
    this.rows.forEach((row, i) => {
      const tr = document.createElement('tr');
      for (const cell of row) {
        const td = document.createElement(i === 0 ? 'th' : 'td');
        td.append(this.renderInline(cell));
        tr.append(td);
      }
      (i === 0 ? table.createTHead() : (table.tBodies[0] ?? table.createTBody())).append(tr);
    });
    wrap.append(table);
    wrap.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('[data-vx-link]')) return;
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return wrap;
  }
  override ignoreEvent(e: Event): boolean {
    return !(e.target as HTMLElement).closest('[data-vx-link]');
  }
}
