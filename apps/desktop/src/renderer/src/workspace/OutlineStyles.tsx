/**
 * The other three outline styles (SPECS 9.6, M6), views of the same outline model:
 * the margin track (220px: ticks on a thin line in the editor's own ground), the
 * document map (300px: a semantic miniature with a viewport frame) and the tabbed
 * inspector (320px: Outline / Links / Info).
 */
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { workspaceStrings as s } from '../strings/workspace';
import { openPath } from './actions';
import { useEditorStats } from './Chrome';
import { editorStats } from './EditorPane';
import type { OutlineItem, OutlineModel } from './outlineModel';
import { useWorkspace } from './store';

export function scrollToLine(line: number): void {
  useWorkspace.setState((st) => ({ jump: st.desk.active ? { path: st.desk.active, line } : null }));
}

/** First and last visible editor lines, following scrolling. */
export function useViewport(): [number, number] {
  const [v, setV] = useState<[number, number]>([editorStats.viewTop, editorStats.viewBottom]);
  useEffect(() => {
    const fn = () =>
      setV((p) =>
        p[0] === editorStats.viewTop && p[1] === editorStats.viewBottom
          ? p
          : [editorStats.viewTop, editorStats.viewBottom],
      );
    fn();
    editorStats.listeners.add(fn);
    return () => void editorStats.listeners.delete(fn);
  }, []);
  return v;
}

export function currentHeading(model: OutlineModel, line: number): number {
  let idx = -1;
  model.headings.forEach((h, i) => {
    if (h.line <= line) idx = i;
  });
  return idx;
}

const pct = (line: number, lines: number) => `${(Math.max(0, line - 1) / Math.max(1, lines)) * 100}%`;
const headingText = (h: OutlineModel['headings'][number]) => (h.level === 0 ? s.outline.top : h.text);

/** Clicking a strip scrolls to the line at that height. */
function lineAtClick(e: MouseEvent<HTMLElement>, lines: number): number {
  const r = e.currentTarget.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height)));
  return Math.min(lines, Math.max(1, Math.floor(f * lines) + 1));
}

function itemLabel(it: OutlineItem): string {
  if (it.kind === 'link' || it.kind === 'embed') return it.target;
  if (it.kind === 'equation') return s.outline.equation(it.number, it.label ?? null);
  return it.lang || 'code';
}

function itemGlyph(it: OutlineItem): string {
  if (it.kind === 'link') return it.resolved ? '→' : '+';
  if (it.kind === 'embed') return '→';
  return it.kind === 'equation' ? '∑' : '{}';
}

function itemClass(it: OutlineItem): string {
  if (it.kind === 'link' && !it.resolved) return 'missing';
  if (it.kind === 'link' || it.kind === 'embed') return 'link';
  return 'block';
}

function Backlinks({ model }: { model: OutlineModel }) {
  if (!model.backlinks.length) return null;
  return (
    <>
      <div className="vx-outline__divider" />
      <div className="vx-outline__label">
        <span className="vx-caps">{s.outline.linkedFrom}</span>
      </div>
      {model.backlinks.map((b, i) => (
        <a
          key={i}
          href="#"
          className="vx-outline__item"
          title={b.snippet}
          onClick={(e) => {
            e.preventDefault();
            openPath(b.path, { line: b.line });
          }}
        >
          <span className="vx-outline__glyph">←</span>
          <span className="vx-outline__text">{b.title}</span>
        </a>
      ))}
    </>
  );
}

// ---- Margin track -----------------------------------------------------------------

export function MarginTrack({ model, currentLine }: { model: OutlineModel; currentLine: number }) {
  const [top, bottom] = useViewport();
  const current = currentHeading(model, currentLine);
  // Labels for headings down to level 3, skipping any that would overlap the previous one.
  const labelled = useMemo(() => {
    const out = new Set<number>();
    let last = -Infinity;
    model.headings.forEach((h, i) => {
      const at = (Math.max(0, h.line - 1) / Math.max(1, model.lines)) * 100;
      if (h.level <= 3 && at - last >= 4) {
        out.add(i);
        last = at;
      }
    });
    return out;
  }, [model]);
  const items = model.headings.flatMap((h) => h.items);
  return (
    <aside className="vx-margin" aria-label={s.outline.trackLabel} data-testid="outline" data-style="margin">
      <div className="vx-outline__label">
        <span className="vx-caps">{s.outline.label}</span>
      </div>
      <div
        className="vx-margin__track"
        role="presentation"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) return;
          scrollToLine(lineAtClick(e, model.lines));
        }}
      >
        <span className="vx-margin__rail" aria-hidden="true" />
        <span
          className="vx-margin__view"
          aria-hidden="true"
          style={{
            top: pct(top, model.lines),
            height: `max(6px, ${((bottom - top + 1) / Math.max(1, model.lines)) * 100}%)`,
          }}
        />
        {items.map((it, i) => (
          <span
            key={`m${i}`}
            className={`vx-margin__mark vx-margin__mark--${itemClass(it)}`}
            style={{ top: pct(it.line, model.lines) }}
            title={`${itemGlyph(it)} ${itemLabel(it)}`}
            aria-hidden="true"
          />
        ))}
        {model.headings.map((h, i) => (
          <a
            key={`h${i}`}
            href="#"
            className={`vx-margin__heading vx-margin__heading--l${Math.min(3, Math.max(1, h.level))}`}
            style={{ top: pct(h.line, model.lines) }}
            aria-current={i === current ? 'location' : undefined}
            aria-label={headingText(h)}
            title={headingText(h)}
            onClick={(e) => {
              e.preventDefault();
              scrollToLine(h.line);
            }}
          >
            {i === current ? (
              <span className="vx-diamond vx-diamond--cyan" aria-hidden="true" />
            ) : (
              <span className="vx-margin__tick" aria-hidden="true" />
            )}
            {labelled.has(i) && <span className="vx-margin__label">{headingText(h)}</span>}
          </a>
        ))}
      </div>
      <Backlinks model={model} />
    </aside>
  );
}

// ---- Document map -----------------------------------------------------------------

export function DocumentMap({ model, currentLine }: { model: OutlineModel; currentLine: number }) {
  const [top, bottom] = useViewport();
  const current = currentHeading(model, currentLine);
  const sections = useMemo(() => {
    const out: Array<{ index: number; from: number; to: number }> = [];
    const hs = model.headings;
    const first = hs[0]?.line ?? model.lines + 1;
    if (first > 1 && hs[0]?.level !== 0) out.push({ index: -1, from: 1, to: first - 1 });
    hs.forEach((h, i) => out.push({ index: i, from: h.line, to: (hs[i + 1]?.line ?? model.lines + 1) - 1 }));
    return out;
  }, [model]);
  return (
    <aside className="vx-map" aria-label={s.outline.mapLabel} data-testid="outline" data-style="map">
      <div className="vx-outline__label">
        <span className="vx-caps">{s.outline.label}</span>
      </div>
      <div
        className="vx-map__page"
        role="presentation"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) return;
          scrollToLine(lineAtClick(e, model.lines));
        }}
      >
        {sections.map((sec) => {
          const h = sec.index >= 0 ? model.headings[sec.index] : undefined;
          return (
            <div
              key={`${sec.index}-${sec.from}`}
              className="vx-map__section"
              style={{ flexGrow: Math.max(1, sec.to - sec.from + 1) }}
            >
              {h && (
                <a
                  href="#"
                  className={`vx-map__heading vx-map__heading--l${Math.min(3, Math.max(1, h.level))}`}
                  aria-current={sec.index === current ? 'location' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToLine(h.line);
                  }}
                >
                  {headingText(h)}
                </a>
              )}
              {h && h.items.length > 0 && (
                <span className="vx-map__chips">
                  {h.items.map((it, j) => (
                    <span
                      key={j}
                      className={`vx-map__chip vx-map__chip--${itemClass(it)}`}
                      title={`${itemGlyph(it)} ${itemLabel(it)}`}
                    >
                      {itemGlyph(it)} {itemLabel(it)}
                    </span>
                  ))}
                </span>
              )}
            </div>
          );
        })}
        <span
          className="vx-map__frame"
          aria-hidden="true"
          data-testid="map-frame"
          style={{
            top: pct(top, model.lines),
            height: `max(8px, ${((bottom - top + 1) / Math.max(1, model.lines)) * 100}%)`,
          }}
        />
      </div>
      <Backlinks model={model} />
    </aside>
  );
}

// ---- Tabbed inspector -------------------------------------------------------------

type Tab = 'outline' | 'links' | 'info';

function ItemLink({ it }: { it: OutlineItem }) {
  const cls = itemClass(it);
  return (
    <a
      href="#"
      className={`vx-outline__item${cls === 'missing' ? ' vx-outline__item--missing' : cls === 'block' ? ' vx-outline__item--block' : ''}`}
      onClick={(e) => {
        e.preventDefault();
        if (it.kind === 'link' && it.resolved) openPath(it.resolved);
        else scrollToLine(it.line);
      }}
    >
      <span className="vx-outline__glyph">{itemGlyph(it)}</span>
      <span className="vx-outline__text">{itemLabel(it)}</span>
    </a>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="vx-outline__label">
        <span className="vx-caps">{title}</span>
      </div>
      {children}
    </>
  );
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.map(formatValue).join(', ');
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v && typeof v === 'object') return JSON.stringify(v);
  return v === null || v === undefined ? '' : String(v);
}

export function Inspector({
  model,
  currentLine,
  path,
}: {
  model: OutlineModel;
  currentLine: number;
  path: string | null;
}) {
  const [tab, setTab] = useState<Tab>('outline');
  const current = currentHeading(model, currentLine);
  const items = model.headings.flatMap((h) => h.items);
  const links = items.filter((i) => i.kind === 'link');
  const embeds = items.filter((i) => i.kind === 'embed');
  const words = useEditorStats().words;
  const props = Object.entries(model.properties ?? {});
  return (
    <aside className="vx-inspector" aria-label={s.outline.label} data-testid="outline" data-style="inspector">
      <div className="vx-segmented vx-segmented--small" role="tablist" aria-label={s.outline.label}>
        {(['outline', 'links', 'info'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {s.outline.tabs[t]}
          </button>
        ))}
      </div>
      <div className="vx-inspector__body" role="tabpanel" aria-label={s.outline.tabs[tab]}>
        {tab === 'outline' && (
          <>
            {model.headings.length === 0 && <span className="vx-row__meta">{s.outline.empty}</span>}
            {model.headings.map((h, i) => (
              <a
                key={`${h.line}-${i}`}
                href="#"
                className={`vx-outline__heading${h.level <= 1 ? ' vx-outline__heading--title' : ''}`}
                aria-current={i === current ? 'location' : undefined}
                style={{ paddingLeft: 8 + Math.max(0, h.level - 2) * 12 }}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToLine(h.line);
                }}
              >
                {i === current && <span className="vx-diamond vx-diamond--cyan" aria-hidden="true" />}
                <span className="vx-outline__text">{headingText(h)}</span>
              </a>
            ))}
          </>
        )}
        {tab === 'links' && (
          <>
            {links.length === 0 && embeds.length === 0 && model.backlinks.length === 0 && (
              <span className="vx-row__meta">{s.outline.noLinks}</span>
            )}
            {links.length > 0 && (
              <Group title={s.outline.linksOut}>
                {links.map((it, i) => (
                  <ItemLink key={i} it={it} />
                ))}
              </Group>
            )}
            {embeds.length > 0 && (
              <Group title={s.outline.embeds}>
                {embeds.map((it, i) => (
                  <ItemLink key={i} it={it} />
                ))}
              </Group>
            )}
            <Backlinks model={model} />
          </>
        )}
        {tab === 'info' && (
          <>
            <Group title={s.outline.properties}>
              {props.length === 0 ? (
                <span className="vx-row__meta">{s.outline.noProperties}</span>
              ) : (
                <dl className="vx-inspector__props">
                  {props.map(([k, v]) => (
                    <div key={k} className="vx-inspector__prop">
                      <dt>{k}</dt>
                      <dd>{formatValue(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Group>
            <Group title={s.outline.stats}>
              <dl className="vx-inspector__props">
                {(
                  [
                    ['lines', model.lines],
                    ['words', words],
                    ['headings', model.headings.filter((h) => h.level > 0).length],
                    ['links', links.length],
                    ['equations', items.filter((i) => i.kind === 'equation').length],
                    ['code', items.filter((i) => i.kind === 'code' || i.kind === 'block').length],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="vx-inspector__prop">
                    <dt>{s.outline.statLabels[k]}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
                {path && (
                  <div className="vx-inspector__prop">
                    <dt>{s.outline.statLabels.path}</dt>
                    <dd>{path}</dd>
                  </div>
                )}
              </dl>
            </Group>
          </>
        )}
      </div>
    </aside>
  );
}
