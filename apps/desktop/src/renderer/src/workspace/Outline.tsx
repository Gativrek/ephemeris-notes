/**
 * The annotated outline (SPECS 9.6, AnnotatedOutline): each heading lists its links,
 * equations and code, then "Linked from". Built from the outline model; backlinks
 * come from the index (M3).
 */
import { useEffect, useMemo, useState } from 'react';
import { buildOutline, type OutlineModel } from './outlineModel';
import { useCatalog } from '../lib/catalog';
import { workspaceStrings as s } from '../strings/workspace';
import { openPath } from './actions';
import { getRecord } from './docs';
import { editorStats } from './EditorPane';
import { useWorkspace } from './store';

const MAX_ITEMS = 5;

export function useOutline(
  path: string | null,
  backlinks: OutlineModel['backlinks'],
): { model: OutlineModel | null; currentLine: number } {
  const [model, setModel] = useState<OutlineModel | null>(null);
  const [line, setLine] = useState(1);
  const catalogVersion = useCatalog((st) => st.version);
  useEffect(() => {
    if (!path) {
      setModel(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastText = '';
    const rebuild = () => {
      const rec = getRecord(path);
      if (!rec) return;
      const text = rec.state.doc.toString();
      if (editorStats.path === path) setLine(editorStats.line);
      if (text === lastText) return;
      lastText = text;
      setModel(buildOutline(text, path, (t) => useCatalog.getState().links.resolve(t, path).path, backlinks));
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(rebuild, 150);
    };
    rebuild();
    const poll = setInterval(rebuild, 1500);
    editorStats.listeners.add(schedule);
    return () => {
      editorStats.listeners.delete(schedule);
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [path, backlinks, catalogVersion]);
  return { model, currentLine: line };
}

function scrollTo(line: number) {
  useWorkspace.setState((st) => ({ jump: st.desk.active ? { path: st.desk.active, line } : null }));
}

export function Outline({ model, currentLine }: { model: OutlineModel | null; currentLine: number }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const current = useMemo(() => {
    if (!model) return -1;
    let idx = -1;
    model.headings.forEach((h, i) => {
      if (h.line <= currentLine) idx = i;
    });
    return idx;
  }, [model, currentLine]);

  if (!model) return null;
  return (
    <aside className="vx-outline" aria-label={s.outline.label} data-testid="outline">
      <div className="vx-outline__label">
        <span className="vx-caps">{s.outline.label}</span>
      </div>
      {model.headings.length === 0 && <span className="vx-row__meta">{s.outline.empty}</span>}
      {model.headings.map((h, i) => {
        const items = h.items;
        const expanded = open[i] ?? false;
        const shown = expanded ? items : items.slice(0, MAX_ITEMS);
        return (
          <div key={`${h.line}-${i}`}>
            <a
              href="#"
              className={`vx-outline__heading${h.level <= 1 ? ' vx-outline__heading--title' : ''}`}
              aria-current={i === current ? 'location' : undefined}
              style={{ paddingLeft: 8 + Math.max(0, h.level - 2) * 12 }}
              onClick={(e) => {
                e.preventDefault();
                scrollTo(h.line);
              }}
            >
              {i === current && <span className="vx-diamond vx-diamond--cyan" aria-hidden="true" />}
              {h.level === 0 ? s.outline.top : h.text}
            </a>
            {items.length > 0 && (
              <div className="vx-outline__items">
                {shown.map((it, j) => {
                  if (it.kind === 'link' || it.kind === 'embed') {
                    const missing = it.kind === 'link' && !it.resolved;
                    return (
                      <a
                        key={j}
                        href="#"
                        className={`vx-outline__item${missing ? ' vx-outline__item--missing' : ''}`}
                        onClick={(e) => {
                          e.preventDefault();
                          if (it.kind === 'link' && it.resolved) openPath(it.resolved);
                          else scrollTo(it.line);
                        }}
                      >
                        <span className="vx-outline__glyph">{missing ? '+' : '→'}</span>
                        <span>{it.target}</span>
                      </a>
                    );
                  }
                  return (
                    <a
                      key={j}
                      href="#"
                      className="vx-outline__item vx-outline__item--block"
                      onClick={(e) => {
                        e.preventDefault();
                        scrollTo(it.line);
                      }}
                    >
                      <span className="vx-outline__glyph">{it.kind === 'equation' ? '∑' : '{}'}</span>
                      <span>
                        {it.kind === 'equation'
                          ? s.outline.equation(it.number, it.label ?? null)
                          : it.lang || 'code'}
                      </span>
                    </a>
                  );
                })}
                {items.length > MAX_ITEMS && !expanded && (
                  <a
                    href="#"
                    className="vx-outline__item vx-outline__item--block"
                    onClick={(e) => {
                      e.preventDefault();
                      setOpen((o) => ({ ...o, [i]: true }));
                    }}
                  >
                    <span className="vx-outline__glyph" />
                    <span>{s.outline.more(items.length - MAX_ITEMS)}</span>
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
      {model.backlinks.length > 0 && (
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
              <span>{b.title}</span>
            </a>
          ))}
        </>
      )}
    </aside>
  );
}
