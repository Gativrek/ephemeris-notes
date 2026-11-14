/**
 * The PDF viewer desk item (SPECS 10.8): page navigation, zoom, fit width, text
 * selection and copy, find in document, a thumbnails sidebar. Remembers the last page
 * per PDF (per machine). Annotations are display-only; the file is never modified.
 *
 * Highlights (SPECS 10.8.1): every note link to a passage of this PDF is drawn over its
 * page; a selection can be kept as a highlight in the PDF's highlights note, or copied as
 * a quote; the sidebar lists the highlights; a followed link flashes its passage.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { PdfSelection } from '@ephemeris-notes/markdown';
import type { PdfHighlightLink } from '@shared/bridge';
import { Icon } from '../components/Icon';
import { errorMessage, unwrap, vx } from '../lib/vx';
import { pdfStrings as s } from '../strings/pdf';
import { openPath } from '../workspace/actions';
import { highlightBlock, quoteOf, type TextItem } from './highlights';
import { boxesOf, rangeOf, selectionOnPage, type Box } from './highlightLayer';
import {
  appendToHighlightsNote,
  pdfLinkText,
  removableRange,
  removeHighlight,
  usePdfHighlightLinks,
} from './highlightNotes';
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

/** pdf.js's page view, as far as the highlights use it. */
interface PageView {
  div: HTMLElement;
  textLayer?: { highlighter?: { textDivs?: HTMLElement[] | null } | null } | null;
}

type Sidebar = 'thumbs' | 'highlights' | null;

/** The highlights of one passage: the links that mark it, and its boxes on the page. */
interface Mark {
  key: string;
  page: number;
  selection: PdfSelection;
  links: PdfHighlightLink[];
  boxes: Box[];
}

const keyOf = (l: Pick<PdfHighlightLink, 'page' | 'selection'>) => `${l.page}:${l.selection.join(',')}`;
const SIDEBAR_WIDTH: Record<Exclude<Sidebar, null>, number> = { thumbs: 149, highlights: 261 };

export function PdfViewer({
  path,
  page: initialPage,
  selection: initialSelection,
  onPage,
}: {
  path: string;
  page?: number | null;
  /** A passage to flash once its page is drawn (a followed selection link). */
  selection?: PdfSelection | null;
  onPage?: (n: number) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pdfViewer = useRef<PDFViewer | null>(null);
  const bus = useRef<EventBus | null>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [sidebar, setSidebar] = useState<Sidebar>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ current: number; total: number } | null>(null);

  // ---- Highlights state ---------------------------------------------------------
  const links = usePdfHighlightLinks(path);
  const linksRef = useRef(links);
  linksRef.current = links;
  const marks = useRef(new Map<number, Mark[]>());
  const items = useRef(new Map<number, Promise<TextItem[]>>());
  const pendingFlash = useRef<{ page: number; selection: PdfSelection } | null>(null);
  const [selBar, setSelBar] = useState<{ x: number; y: number } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [notice, setNotice] = useState<{ text: string; open: string | null } | null>(null);
  const [quotes, setQuotes] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let live = true;
    setDoc(null);
    setError(null);
    items.current.clear();
    void loadPdf(path).then(
      (d) => live && setDoc(d),
      (err) => live && setError(errorMessage(err)),
    );
    return () => {
      live = false;
    };
  }, [path]);

  /** A page's text items, as the text layer numbers them (unnormalized, so offsets agree). */
  const pageItems = useCallback(
    (n: number): Promise<TextItem[]> => {
      if (!doc) return Promise.resolve([]);
      let p = items.current.get(n);
      if (!p) {
        p = doc
          .getPage(n)
          .then((pg) => pg.getTextContent({ disableNormalization: true }))
          .then((tc) =>
            tc.items
              .filter((it): it is typeof it & { str: string; hasEOL: boolean } => 'str' in it)
              .map((it) => ({ str: it.str, hasEOL: it.hasEOL })),
          );
        items.current.set(n, p);
      }
      return p;
    },
    [doc],
  );

  const pageView = (n: number): PageView | null =>
    (pdfViewer.current?.getPageView(n - 1) as PageView | undefined) ?? null;
  const textDivs = (n: number): HTMLElement[] | null => {
    const divs = pageView(n)?.textLayer?.highlighter?.textDivs;
    return divs && divs.length ? divs : null;
  };

  /** Draws page `n`'s highlights, when its text layer is there to place them by. */
  const paint = useCallback((n: number) => {
    const pv = pageView(n);
    const divs = textDivs(n);
    pv?.div.querySelector(':scope > .vx-pdf-hl-layer:not(.is-flash-layer)')?.remove();
    if (!pv || !divs) return;
    const groups = new Map<string, Mark>();
    for (const l of linksRef.current) {
      if (l.page !== n) continue;
      const key = keyOf(l);
      const g = groups.get(key);
      if (g) g.links.push(l);
      else groups.set(key, { key, page: n, selection: l.selection, links: [l], boxes: [] });
    }
    const layer = document.createElement('div');
    layer.className = 'vx-pdf-hl-layer';
    layer.setAttribute('aria-hidden', 'true');
    for (const m of groups.values()) {
      const r = rangeOf(m.selection, divs);
      m.boxes = r ? boxesOf(r, pv.div) : [];
      for (const b of m.boxes) layer.append(boxEl(b, 'vx-pdf-hl'));
    }
    marks.current.set(n, [...groups.values()]);
    pv.div.append(layer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Flashes a passage once, and brings it into view. */
  const flash = useCallback((n: number, sel: PdfSelection): boolean => {
    const pv = pageView(n);
    const divs = textDivs(n);
    if (!pv || !divs) return false;
    const r = rangeOf(sel, divs);
    const boxes = r ? boxesOf(r, pv.div) : [];
    if (!boxes.length) return true;
    const layer = document.createElement('div');
    layer.className = 'vx-pdf-hl-layer is-flash-layer';
    layer.setAttribute('aria-hidden', 'true');
    for (const b of boxes) layer.append(boxEl(b, 'vx-pdf-hl is-flash'));
    pv.div.append(layer);
    setTimeout(() => layer.remove(), 1800);
    const c = containerRef.current;
    if (c) {
      const top = pv.div.offsetTop + (boxes[0]!.top / 100) * pv.div.clientHeight;
      c.scrollTop = Math.max(0, top - c.clientHeight / 3);
    }
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    marks.current.clear();
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
    // Text layers are redrawn on zoom and as pages scroll in: highlights follow them.
    eventBus.on('textlayerrendered', (e: { pageNumber: number }) => {
      paint(e.pageNumber);
      const p = pendingFlash.current;
      if (p && p.page === e.pageNumber && flash(p.page, p.selection)) pendingFlash.current = null;
    });
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

  // A link to a passage flashes it, now if its page is drawn, else when it is.
  useEffect(() => {
    if (!initialSelection || !initialPage || !doc) return;
    pendingFlash.current = { page: initialPage, selection: initialSelection };
    if (flash(initialPage, initialSelection)) pendingFlash.current = null;
  }, [initialSelection, initialPage, doc, flash]);

  // New or changed highlight links: redraw the pages already drawn.
  useEffect(() => {
    if (!doc) return;
    for (let n = 1; n <= doc.numPages; n++) if (textDivs(n)) paint(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links, doc, paint]);

  // The list's quotes come from the PDF's own text.
  useEffect(() => {
    if (!doc) return;
    let live = true;
    void Promise.all(
      links.map(async (l) => [keyOf(l), quoteOf(await pageItems(l.page), l.selection)] as const),
    ).then(
      (pairs) => live && setQuotes(Object.fromEntries(pairs)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [links, doc, pageItems]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // ---- Selection ------------------------------------------------------------------

  /** The current selection inside the pages, if any. */
  const pageSelection = (): Range | null => {
    const sel = window.getSelection();
    const c = containerRef.current;
    if (!sel || sel.isCollapsed || !sel.rangeCount || !c) return null;
    const r = sel.getRangeAt(0);
    return c.contains(r.commonAncestorContainer) ? r : null;
  };

  const placeBar = () => {
    const r = pageSelection();
    const body = bodyRef.current;
    if (!r || !body || !r.toString().trim()) return setSelBar(null);
    const rect = r.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    const above = rect.top - b.top - 44;
    setSelBar({ x: rect.left + rect.width / 2 - b.left, y: above >= 4 ? above : rect.bottom - b.top + 8 });
  };

  useEffect(() => {
    const onChange = () => {
      if (!pageSelection()) setSelBar(null);
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, []);

  /** The selection as highlight blocks, one per page it covers. */
  const selectionBlocks = async (): Promise<string[]> => {
    const range = pageSelection();
    if (!range || !doc) return [];
    const link = pdfLinkText(path);
    const out: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pv = pageView(n);
      const divs = textDivs(n);
      if (!pv || !divs || !range.intersectsNode(pv.div)) continue;
      const sel = selectionOnPage(range, divs);
      if (!sel) continue;
      const quote = quoteOf(await pageItems(n), sel);
      if (quote) out.push(highlightBlock(quote, link, n, sel));
    }
    return out;
  };

  const highlight = async () => {
    const blocks = await selectionBlocks();
    if (!blocks.length) return;
    window.getSelection()?.removeAllRanges();
    setSelBar(null);
    try {
      const note = await appendToHighlightsNote(path, blocks.join('\n'));
      setNotice({ text: s.added(note.slice(note.lastIndexOf('/') + 1).replace(/\.md$/i, '')), open: note });
    } catch (err) {
      setNotice({ text: s.highlightFailed(errorMessage(err)), open: null });
    }
  };

  const copyQuote = async () => {
    const blocks = await selectionBlocks();
    if (!blocks.length) return;
    setSelBar(null);
    if (await copyText(blocks.join('\n'))) setNotice({ text: s.copied(blocks.length), open: null });
  };

  // ---- Hover and click on highlights ---------------------------------------------

  /** The highlight under a point, if any. */
  const markAt = (e: { clientX: number; clientY: number; target: EventTarget | null }): Mark | null => {
    const pageEl = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('.page');
    const n = Number(pageEl?.dataset.pageNumber);
    if (!pageEl || !n) return null;
    const r = pageEl.getBoundingClientRect();
    const x = (100 * (e.clientX - r.left)) / r.width;
    const y = (100 * (e.clientY - r.top)) / r.height;
    return (
      marks.current
        .get(n)
        ?.find((m) =>
          m.boxes.some((b) => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height),
        ) ?? null
    );
  };

  const noteNames = (m: Mark) => {
    const notes = [...new Set(m.links.map((l) => l.title))];
    return notes.length === 1 ? notes[0]! : s.notes(notes.length);
  };

  const go = (n: number) => {
    if (!pdfViewer.current || !doc) return;
    pdfViewer.current.currentPageNumber = Math.min(Math.max(1, n), doc.numPages);
  };
  const goTo = (l: PdfHighlightLink) => {
    pendingFlash.current = { page: l.page, selection: l.selection };
    go(l.page);
    if (flash(l.page, l.selection)) pendingFlash.current = null;
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

  const listed = useMemo(
    () =>
      [...links].sort(
        (a, b) =>
          a.page - b.page ||
          a.selection[0] - b.selection[0] ||
          a.selection[1] - b.selection[1] ||
          a.path.localeCompare(b.path) ||
          a.line - b.line,
      ),
    [links],
  );

  const onItemContext = async (e: React.MouseEvent, l: PdfHighlightLink) => {
    e.preventDefault();
    const removable = !!(await removableRange(path, l).catch(() => null));
    const choice = await unwrap(
      vx().window.contextMenu([
        { id: 'open', label: s.openNote },
        { id: 'remove', label: s.removeHighlight, enabled: removable },
      ]),
    ).catch(() => null);
    if (choice === 'open') openPath(l.path, { line: l.line });
    if (choice === 'remove') await removeHighlight(path, l).catch(() => false);
  };

  const toggle = (which: Exclude<Sidebar, null>) => setSidebar((cur) => (cur === which ? null : which));

  return (
    <div
      className="vx-pdf-view"
      data-testid="pdf-viewer"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          findRef.current?.focus();
          findRef.current?.select();
          return;
        }
        if ((e.target as HTMLElement).closest('input, textarea')) return;
        if (!pageSelection()) return;
        if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'h') {
          e.preventDefault();
          void highlight();
        } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
          e.preventDefault();
          void copyQuote();
        }
      }}
    >
      <div className="vx-pdf-bar" role="toolbar" aria-label={s.toolbar}>
        <button
          type="button"
          className="vx-icon-btn"
          aria-label={s.thumbnails}
          title={s.thumbnails}
          aria-pressed={sidebar === 'thumbs'}
          onClick={() => toggle('thumbs')}
        >
          <Icon name="panel" />
        </button>
        <button
          type="button"
          className="vx-icon-btn"
          aria-label={s.highlights}
          title={s.highlights}
          aria-pressed={sidebar === 'highlights'}
          onClick={() => toggle('highlights')}
        >
          <Icon name="highlight" />
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
      <div className="vx-pdf-body" ref={bodyRef}>
        {sidebar && doc && (
          <div className="vx-pdf-side">
            <div className="vx-pdf-side__tabs" role="tablist" aria-label={s.sidebar}>
              {(['thumbs', 'highlights'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  className="vx-pdf-side__tab"
                  aria-selected={sidebar === t}
                  onClick={() => setSidebar(t)}
                >
                  {t === 'thumbs'
                    ? s.thumbnails
                    : `${s.highlights}${links.length ? ` (${links.length})` : ''}`}
                </button>
              ))}
            </div>
            {sidebar === 'thumbs' ? (
              <nav className="vx-pdf-thumbs" aria-label={s.thumbnails}>
                {Array.from({ length: doc.numPages }, (_, i) => (
                  <Thumb key={i} doc={doc} page={i + 1} active={page === i + 1} onClick={() => go(i + 1)} />
                ))}
              </nav>
            ) : listed.length ? (
              <ul className="vx-pdf-hls" aria-label={s.highlights} data-testid="pdf-highlights">
                {listed.map((l) => {
                  const q = quotes[keyOf(l)];
                  return (
                    <li key={`${l.path}:${l.line}:${l.col}`}>
                      <button
                        type="button"
                        className="vx-pdf-hls__item"
                        data-testid="pdf-highlight-item"
                        onClick={() => goTo(l)}
                        onContextMenu={(e) => void onItemContext(e, l)}
                      >
                        <span className={`vx-pdf-hls__quote${q === null ? ' is-missing' : ''}`}>
                          {q === undefined ? '…' : (q ?? s.notFound)}
                        </span>
                        <span className="vx-pdf-hls__meta">
                          {s.pageShort(l.page)} · {l.title}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="vx-pdf-hls vx-pdf-hls__empty">{s.none}</p>
            )}
          </div>
        )}
        <div
          ref={containerRef}
          className={`vx-pdf-container${tip ? ' is-over-highlight' : ''}`}
          style={sidebar && doc ? { left: SIDEBAR_WIDTH[sidebar] } : undefined}
          tabIndex={0}
          onMouseUp={() => setTimeout(placeBar, 0)}
          onKeyUp={(e) => e.shiftKey && placeBar()}
          onScroll={() => {
            if (selBar) setSelBar(null);
            if (tip) setTip(null);
          }}
          onMouseMove={(e) => {
            if (e.buttons) return;
            const m = markAt(e);
            const b = bodyRef.current?.getBoundingClientRect();
            if (!m || !b) {
              if (tip) setTip(null);
              return;
            }
            setTip({ x: e.clientX - b.left + 12, y: e.clientY - b.top + 16, text: noteNames(m) });
          }}
          onMouseLeave={() => setTip(null)}
          onClick={(e) => {
            const a = (e.target as HTMLElement).closest('a');
            if (a) {
              const href = a.getAttribute('href') ?? '';
              if (/^https?:/i.test(href)) {
                e.preventDefault();
                void vx().shell.openExternal(href);
              }
              return;
            }
            if (pageSelection()) return;
            const m = markAt(e);
            if (m) openPath(m.links[0]!.path, { line: m.links[0]!.line });
          }}
        >
          <div ref={viewerRef} className="pdfViewer" />
        </div>
        {selBar && (
          <div
            className="vx-pdf-selbar"
            role="toolbar"
            aria-label={s.selectionTools}
            data-testid="pdf-selection-bar"
            style={{ left: selBar.x, top: selBar.y }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button type="button" className="vx-btn vx-btn--small" onClick={() => void highlight()}>
              <Icon name="highlight" size={15} />
              {s.highlight}
              <kbd className="vx-search__key">{s.highlightKey}</kbd>
            </button>
            <button type="button" className="vx-btn vx-btn--small" onClick={() => void copyQuote()}>
              <Icon name="copy" size={15} />
              {s.copyQuote}
            </button>
          </div>
        )}
        {tip && (
          <div className="vx-pdf-tip" style={{ left: tip.x, top: tip.y }} data-testid="pdf-highlight-tip">
            {tip.text}
          </div>
        )}
        {notice && (
          <div className="vx-pdf-notice" role="status" data-testid="pdf-notice">
            <span>{notice.text}</span>
            {notice.open && (
              <button
                type="button"
                className="vx-btn vx-btn--small"
                onClick={() => {
                  openPath(notice.open!);
                  setNotice(null);
                }}
              >
                {s.open}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The clipboard API refuses a window without focus; the copy command does not, and the
 * text is on the clipboard either way.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    Object.assign(area.style, { position: 'fixed', opacity: '0', pointerEvents: 'none' });
    const before = document.activeElement as HTMLElement | null;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    before?.focus();
    return ok;
  }
}

function boxEl(b: Box, cls: string): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  Object.assign(el.style, {
    left: `${b.left}%`,
    top: `${b.top}%`,
    width: `${b.width}%`,
    height: `${b.height}%`,
  });
  return el;
}
