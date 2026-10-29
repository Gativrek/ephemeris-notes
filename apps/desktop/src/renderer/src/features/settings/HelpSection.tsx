/**
 * Settings > Help (SPECS 11.2): a Markdown page browser rendered read-only by the note
 * renderer, so plugin blocks inside help pages render live. Plugin pages are listed
 * under the plugin's name and disappear when it is disabled.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { EditorContext } from '../../editor/context';
import { createReadOnlyView } from '../../editor/setup';
import { CORE_HELP } from '../../help';
import { fillShortcuts } from '../../help/shortcuts';
import { assetUrl } from '../../lib/asset';
import { HOTKEYS_KEY, isMacPlatform } from '../../lib/hotkeys';
import type { Overrides } from '../../lib/keymap';
import { useSettings } from '../../lib/settings';
import { vx } from '../../lib/vx';
import { usePlugins } from '../../plugins/store';
import { settingsStrings as s } from '../../strings/settings';

interface Page {
  key: string;
  title: string;
  markdown: string;
  group: string | null;
}

function helpContext(key: string): EditorContext {
  return {
    path: `help/${key}`,
    vaultPath: null,
    resolve: () => ({ path: null, candidates: [] }),
    open: () => undefined,
    loadNote: async () => null,
    assetUrl: (p) => assetUrl(p),
    linkText: (p) => p,
    files: () => [],
    numbering: 'all',
    macros: {},
    refFormat: 'eq',
    embedChain: [],
  };
}

function Article({ page }: { page: Page }) {
  const ref = useRef<HTMLDivElement>(null);
  // Re-render when a plugin block renderer arrives or leaves.
  const pluginCount = usePlugins((st) => st.plugins.filter((p) => p.state === 'loaded').length);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const view = createReadOnlyView(
      el,
      page.markdown,
      helpContext(page.key),
      (url) => void vx().shell.openExternal(url),
    );
    el.scrollTop = 0;
    return () => view.destroy();
  }, [page, pluginCount]);
  return <div ref={ref} className="vx-editor vx-help__article" data-testid="help-article" />;
}

export function HelpSection({ page, onPage }: { page: string | null; onPage: (key: string) => void }) {
  const help = usePlugins((st) => st.help);
  const commands = usePlugins((st) => st.commands);
  // The shortcuts page shows the keys as set now.
  const overrides = useSettings((st) => st.values[HOTKEYS_KEY]) as Overrides | undefined;
  const pages = useMemo<Page[]>(
    () => [
      ...CORE_HELP.map((p) => ({
        key: `core:${p.id}`,
        title: p.title,
        markdown:
          p.id === 'shortcuts'
            ? fillShortcuts(
                p.markdown,
                overrides ?? {},
                (id) => s.keyboard.titles[id] ?? commands.find((c) => c.id === id)?.title ?? id,
                isMacPlatform(),
              )
            : p.markdown,
        group: null,
      })),
      ...help.map((h) => ({
        key: `${h.owner}:${h.page.id}`,
        title: h.page.title,
        markdown: h.page.markdown,
        group: h.ownerName,
      })),
    ],
    [help, overrides, commands],
  );
  const current = pages.find((p) => p.key === page) ?? pages[0]!;
  const groups = [...new Set(pages.map((p) => p.group).filter((g): g is string => !!g))];
  const row = (p: Page) => (
    <div
      key={p.key}
      className="vx-row"
      role="link"
      tabIndex={0}
      aria-current={p.key === current.key ? 'page' : undefined}
      onClick={() => onPage(p.key)}
      onKeyDown={(e) => e.key === 'Enter' && onPage(p.key)}
    >
      <span className="vx-row__name">{p.title}</span>
    </div>
  );
  return (
    <div className="vx-help" data-testid="settings-help">
      <nav className="vx-help__nav" aria-label={s.sections.help}>
        {pages.filter((p) => !p.group).map(row)}
        {groups.map((g) => (
          <div key={g} className="vx-help__group">
            <div className="vx-help__group-title vx-caps">{g}</div>
            {pages.filter((p) => p.group === g).map(row)}
          </div>
        ))}
      </nav>
      <Article page={current} />
    </div>
  );
}
