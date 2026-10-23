/**
 * The annotated outline (SPECS 9.6, AnnotatedOutline): each heading lists its links,
 * equations and code, then "Linked from". Built from the outline model; backlinks
 * come from the index (M3).
 */
import { useEffect, useMemo, useState } from 'react';
import { addContributions, buildOutline, type OutlineItem, type OutlineModel } from './outlineModel';
import { domainOf } from '@ephemeris-notes/markdown';
import type { Domain } from '@ephemeris-notes/plugin-api';
import { usePlugins } from '../plugins/store';
import { currentVault } from './actions';
import { useCatalog } from '../lib/catalog';
import { useSettings } from '../lib/settings';
import { isCodeLanguage } from '../editor/languages';
import { workspaceStrings as s } from '../strings/workspace';
import { openPath } from './actions';
import { getRecord } from './docs';
import { editorStats } from './EditorPane';
import { settleDelay } from './Chrome';
import { useWorkspace } from './store';
import { DocumentMap, Inspector, MarginTrack, activateItem, itemGlyph } from './OutlineStyles';

const MAX_ITEMS = 5;
/** SPECS 12.11.3: entries per plugin per note, and the time a contributor may take. */
const MAX_PLUGIN_ENTRIES = 200;
const CONTRIBUTOR_BUDGET_MS = 5;

/** Plugin outline entries for this note; slow or throwing contributors are skipped. */
function pluginEntries(path: string, text: string, model: OutlineModel): OutlineItem[] {
  const contributors = usePlugins.getState().outline;
  if (!contributors.length) return [];
  const vaultPath = currentVault()?.path ?? null;
  const domain = vaultPath ? ((domainOf(vaultPath)?.toLowerCase() ?? null) as Domain | null) : null;
  const note = { path, vaultPath, domain, frontmatter: model.properties ?? {} };
  const headings = model.headings
    .filter((h) => h.level > 0)
    .map((h) => ({ level: h.level, text: h.text, line: h.line }));
  const out: OutlineItem[] = [];
  for (const c of contributors) {
    const started = performance.now();
    let entries: ReturnType<typeof c.fn>;
    try {
      entries = c.fn({ note, text, headings });
    } catch (err) {
      console.error(`[plugin ${c.owner}] outline contributor failed`, err);
      continue;
    }
    if (performance.now() - started > CONTRIBUTOR_BUDGET_MS) {
      console.warn(`[plugin ${c.owner}] outline contributor took over ${CONTRIBUTOR_BUDGET_MS} ms; skipped`);
      continue;
    }
    if (!Array.isArray(entries)) continue;
    for (const e of entries.slice(0, MAX_PLUGIN_ENTRIES)) {
      if (!e || typeof e.line !== 'number' || typeof e.label !== 'string') continue;
      out.push({
        kind: 'plugin',
        plugin: c.owner,
        line: Math.max(1, Math.floor(e.line)),
        label: e.label,
        ...(typeof e.glyph === 'string' && e.glyph ? { glyph: [...e.glyph][0]! } : {}),
        ...(typeof e.onClick === 'function' ? { onClick: e.onClick } : {}),
      });
    }
  }
  return out;
}

export function useOutline(
  path: string | null,
  backlinks: OutlineModel['backlinks'],
): { model: OutlineModel | null; currentLine: number } {
  const [model, setModel] = useState<OutlineModel | null>(null);
  const [line, setLine] = useState(1);
  const catalogVersion = useCatalog((st) => st.version);
  const numbering = useSettings((st) => st.values['math.numbering']);
  const contributors = usePlugins((st) => st.outline);
  useEffect(() => {
    if (!path) {
      setModel(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastText = '';
    let forced = true;
    const rebuild = () => {
      const rec = getRecord(path);
      if (!rec) return;
      const text = rec.state.doc.toString();
      if (editorStats.path === path) setLine(editorStats.line);
      if (text === lastText && !forced) return;
      forced = false;
      lastText = text;
      const model = buildOutline(
        text,
        path,
        (t) => useCatalog.getState().links.resolve(t, path).path,
        backlinks,
        {
          numbering: numbering === 'labeled' ? 'labeled' : 'all',
          isCodeLanguage,
        },
      );
      setModel(addContributions(model, pluginEntries(path, text, model)));
    };
    let lastEdit = 0;
    const schedule = () => {
      lastEdit = Date.now();
      if (timer) clearTimeout(timer);
      timer = setTimeout(rebuild, Math.max(150, settleDelay(getRecord(path)?.state.doc.length ?? 0)));
    };
    rebuild();
    // Catches changes that bypass the editor (reloads); never while the user is typing.
    const poll = setInterval(() => Date.now() - lastEdit > 1500 && rebuild(), 1500);
    editorStats.listeners.add(schedule);
    return () => {
      editorStats.listeners.delete(schedule);
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [path, backlinks, catalogVersion, numbering, contributors]);
  return { model, currentLine: line };
}

function scrollTo(line: number) {
  useWorkspace.setState((st) => ({ jump: st.desk.active ? { path: st.desk.active, line } : null }));
}

/** The outline panel in the style chosen in Settings > Appearance. */
export function Outline({
  model,
  currentLine,
  path = null,
}: {
  model: OutlineModel | null;
  currentLine: number;
  path?: string | null;
}) {
  const style = useSettings((st) => st.get<string>('appearance.outlineStyle'));
  if (!model) return null;
  if (style === 'margin') return <MarginTrack model={model} currentLine={currentLine} />;
  if (style === 'map') return <DocumentMap model={model} currentLine={currentLine} />;
  if (style === 'inspector') return <Inspector model={model} currentLine={currentLine} path={path} />;
  return <AnnotatedOutline model={model} currentLine={currentLine} />;
}

function AnnotatedOutline({ model, currentLine }: { model: OutlineModel; currentLine: number }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const current = useMemo(() => {
    let idx = -1;
    model.headings.forEach((h, i) => {
      if (h.line <= currentLine) idx = i;
    });
    return idx;
  }, [model, currentLine]);

  return (
    <aside className="vx-outline" data-style="annotated" aria-label={s.outline.label} data-testid="outline">
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
                  if (it.kind === 'plugin') {
                    return (
                      <a
                        key={j}
                        href="#"
                        className="vx-outline__item vx-outline__item--plugin"
                        data-plugin={it.plugin}
                        onClick={(e) => {
                          e.preventDefault();
                          activateItem(it);
                        }}
                      >
                        <span className="vx-outline__glyph">{itemGlyph(it)}</span>
                        <span className="vx-outline__text">{it.label}</span>
                      </a>
                    );
                  }
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
