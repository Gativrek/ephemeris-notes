/**
 * The PDF viewer desk item (SPECS 10.8): page navigation, zoom, fit width, text
 * selection and copy, find in document, a thumbnails sidebar. Remembers the last page
 * per PDF (per machine). Annotations are display-only; the file is never modified.
 */
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import { Icon } from '../components/Icon';
import { errorMessage, unwrap, vx } from '../lib/vx';
import { pdfStrings as s } from '../strings/pdf';
import { loadPdf, renderPage } from './pdfjs';

function Thumb({
  doc,
  page,
  active,
  onClick,
}: {
  doc: PDFDocumentProxy;
  page: number;
  active: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let done = false;
    const io = new IntersectionObserver((entries) => {
      if (done || !entries.some((e) => e.isIntersecting)) return;
      done = true;
      io.disconnect();
      void renderPage(doc, page, 112).then(
        (c) => el.querySelector('.vx-pdf-thumb__img')?.replaceChildren(c),
        () => undefined,
      );
    });
    io.observe(el);
    return () => io.disconnect();
  }, [doc, page]);
  return (
    <button
      ref={ref}
      type="button"
      className="vx-pdf-thumb"
      aria-current={active ? 'page' : undefined}
      aria-label={s.page(page)}
      onClick={onClick}
    >
      <span className="vx-pdf-thumb__img" />
      <span className="vx-pdf-thumb__n">{page}</span>
    </button>
  );
}

export function PdfViewer({
  path,
  page: initialPage,
  onPage,
}: {
  path: string;
  page?: number | null;
  onPage?: (n: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pdfViewer = useRef<PDFViewer | null>(null);
  const bus = useRef<EventBus | null>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [thumbs, setThumbs] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    let live = true;
    setDoc(null);
    setError(null);
    void loadPdf(path).then(
      (d) => live && setDoc(d),
      (err) => live && setError(errorMessage(err)),
    );
    return () => {
      live = false;
    };
  }, [path]);

  useEffect(() => {
    const container = containerRef.current;
    const viewerEl = viewerRef.current;
    if (!doc || !container || !viewerEl) return;
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    // External links are opened by the click handler below, never by navigation.
    linkService.externalLinkEnabled = false;
    const findController = new PDFFindController({ eventBus, linkService });
    const viewer = new PDFViewer({
      container,
      viewer: viewerEl,
      eventBus,
      linkService,
      findController,
      textLayerMode: 1,
      removePageBorders: false,
    });
    linkService.setViewer(viewer);
    viewer.setDocument(doc);
    linkService.setDocument(doc);
    pdfViewer.current = viewer;
    bus.current = eventBus;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    eventBus.on('pagesinit', async () => {
      viewer.currentScaleValue = 'page-width';
      let start = initialPage ?? null;
      if (!start) {
        const remembered = await unwrap(vx().ui.get(`pdf.page:${path}`)).catch(() => null);
        if (typeof remembered === 'number') start = remembered;
      }
      if (start && start >= 1 && start <= doc.numPages) viewer.currentPageNumber = start;
    });
    eventBus.on('pagechanging', (e: { pageNumber: number }) => {
      setPage(e.pageNumber);
      setPageInput(String(e.pageNumber));
      onPage?.(e.pageNumber);
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void vx().ui.set(`pdf.page:${path}`, e.pageNumber), 400);
    });
    eventBus.on('updatefindmatchescount', (e: { matchesCount: { current: number; total: number } }) =>
      setFound(e.matchesCount),
    );
    eventBus.on('updatefindcontrolstate', (e: { matchesCount: { current: number; total: number } }) =>
      setFound(e.matchesCount),
    );
    return () => {
      if (saveTimer) clearTimeout(saveTimer);
      viewer.cleanup();
      pdfViewer.current = null;
      bus.current = null;
      viewerEl.replaceChildren();
    };
    // The initial page applies once per document.
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps

  // A later link into this PDF (page=N) jumps there.
  useEffect(() => {
    if (initialPage && pdfViewer.current && doc && initialPage <= doc.numPages)
      pdfViewer.current.currentPageNumber = initialPage;
  }, [initialPage, doc]);

  const go = (n: number) => {
    if (!pdfViewer.current || !doc) return;
    pdfViewer.current.currentPageNumber = Math.min(Math.max(1, n), doc.numPages);
  };
  const zoom = (factor: number) => {
    const v = pdfViewer.current;
    if (v) v.currentScale = Math.min(5, Math.max(0.25, v.currentScale * factor));
  };
  const find = (again: boolean, previous = false) => {
    bus.current?.dispatch('find', {
      source: null,
      type: again ? 'again' : '',
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
  };

  return (
    <div
      className="vx-pdf-view"
      data-testid="pdf-viewer"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          findRef.current?.focus();
          findRef.current?.select();
        }
      }}
    >
      <div className="vx-pdf-bar" role="toolbar" aria-label={s.toolbar}>
        <button
          type="button"
          className="vx-icon-btn"
          aria-label={s.thumbnails}
          title={s.thumbnails}
          aria-pressed={thumbs}
          onClick={() => setThumbs((t) => !t)}
        >
          <Icon name="panel" />
        </button>
        <span className="vx-pdf-bar__sep" />
        <button
          type="button"
          className="vx-icon-btn"
          aria-label={s.previous}
          title={s.previous}
          disabled={page <= 1}
          onClick={() => go(page - 1)}
        >
          <Icon name="chevron-left" />
        </button>
        <label className="vx-pdf-bar__page">
          <input
            className="vx-input--small"
            aria-label={s.pageNumber}
            data-testid="pdf-page"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && go(Number(pageInput) || 1)}
            onBlur={() => setPageInput(String(page))}
          />
          <span data-testid="pdf-pages">/ {doc?.numPages ?? '…'}</span>
        </label>
        <button
          type="button"
          className="vx-icon-btn"
          aria-label={s.next}
          title={s.next}
          disabled={!doc || page >= doc.numPages}
          onClick={() => go(page + 1)}
        >
          <Icon name="chevron-right" />
        </button>
        <span className="vx-pdf-bar__sep" />
        <button
          type="button"
          className="vx-icon-btn"
          aria-label={s.zoomOut}
          title={s.zoomOut}
          onClick={() => zoom(1 / 1.15)}
        >
          <Icon name="minimize" />
        </button>
        <button
          type="button"
          className="vx-icon-btn"
          aria-label={s.zoomIn}
          title={s.zoomIn}
          onClick={() => zoom(1.15)}
        >
          <Icon name="plus" />
        </button>
        <button
          type="button"
          className="vx-btn vx-btn--small"
          onClick={() => pdfViewer.current && (pdfViewer.current.currentScaleValue = 'page-width')}
        >
          {s.fitWidth}
        </button>
        <span className="vx-pdf-bar__spacer" />
        <label className="vx-search vx-pdf-bar__find">
          <Icon name="search" size={15} strokeWidth={1.8} />
          <input
            ref={findRef}
            type="search"
            placeholder={s.find}
            aria-label={s.find}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setFound(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                find(found !== null, e.shiftKey);
              }
            }}
          />
          {found && found.total > 0 && (
            <span className="vx-search__key">{s.matches(found.current, found.total)}</span>
          )}
        </label>
      </div>
      {error && (
        <div className="vx-banner vx-banner--warn" role="alert">
          <span className="vx-banner__mark" aria-hidden="true" />
          <span className="vx-banner__text">{s.failed(error)}</span>
        </div>
      )}
      <div className="vx-pdf-body">
        {thumbs && doc && (
          <nav className="vx-pdf-thumbs" aria-label={s.thumbnails}>
            {Array.from({ length: doc.numPages }, (_, i) => (
              <Thumb key={i} doc={doc} page={i + 1} active={page === i + 1} onClick={() => go(i + 1)} />
            ))}
          </nav>
        )}
        <div
          ref={containerRef}
          className="vx-pdf-container"
          tabIndex={0}
          onClick={(e) => {
            const a = (e.target as HTMLElement).closest('a');
            if (!a) return;
            const href = a.getAttribute('href') ?? '';
            if (/^https?:/i.test(href)) {
              e.preventDefault();
              void vx().shell.openExternal(href);
            }
          }}
        >
          <div ref={viewerRef} className="pdfViewer" />
        </div>
      </div>
    </div>
  );
}
