/**
 * `![[paper.pdf#page=3]]` (SPECS 10.8): that page rendered like an image, with a link
 * that opens the PDF at the page.
 */
import { WidgetType } from '@codemirror/view';
import { loadPdf, renderPage } from '../pdf/pdfjs';
import { pdfStrings as s } from '../strings/pdf';
import { linkAttrs } from './widgets';

export class PdfPageWidget extends WidgetType {
  constructor(
    readonly path: string,
    readonly page: number | null,
    readonly target: string,
  ) {
    super();
  }
  override eq(o: PdfPageWidget): boolean {
    return o.path === this.path && o.page === this.page;
  }
  toDOM(): HTMLElement {
    const box = document.createElement('span');
    box.className = 'vx-pdf-embed';
    box.dataset.testid = 'pdf-embed';
    const link = document.createElement('span');
    link.className = 'vx-cm-link vx-link--pdf';
    linkAttrs(link, { target: this.target, heading: null, block: null, page: this.page, path: this.path });
    const badge = document.createElement('span');
    badge.className = 'vx-pdf';
    badge.textContent = 'PDF';
    badge.style.marginRight = '6px';
    link.append(badge, s.embedOpen(this.target, this.page));
    const holder = document.createElement('span');
    holder.className = 'vx-pdf-embed__page';
    box.append(holder, link);
    void loadPdf(this.path)
      .then((doc) => renderPage(doc, this.page ?? 1, 560))
      .then(
        (canvas) => holder.replaceChildren(canvas),
        () => {
          holder.textContent = s.embedFailed;
          holder.className = 'vx-block-note';
        },
      );
    return box;
  }
  override ignoreEvent(e: Event): boolean {
    return !(e.target as HTMLElement).closest('[data-vx-link]');
  }
}
