/**
 * Settings > Help (SPECS 11.2): a Markdown page browser rendered read-only by the note
 * renderer, so plugin blocks inside help pages render live. Plugin pages are listed
 * in one Plugins folder, by plugin name, and disappear when it is disabled.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import type { EditorContext } from '../../editor/context';
import { createReadOnlyView } from '../../editor/setup';
import { CORE_HELP } from '../../help';
import { fillShortcuts } from '../../help/shortcuts';
import { assetUrl } from '../../lib/asset';
import { HOTKEYS_KEY, isMacPlatform } from '../../lib/hotkeys';
import type { Overrides } from '../../lib/keymap';
import { useSettings } from '../../lib/settings';
import { unwrap, vx } from '../../lib/vx';
import { usePlugins } from '../../plugins/store';
import { settingsStrings as s } from '../../strings/settings';

/** Whether the Plugins folder is open (per machine). */
const FOLDER_KEY = 'help.pluginsOpen';

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
  const groups = [...new Set(pages.map((p) => p.group).filter((g): g is string => !!g))].sort((a, b) =>
    a.localeCompare(b),
  );
  const pluginPages = pages.filter((p) => p.group);
  // The Plugins folder (SPECS 11.2): closed unless opened, or showing one of its pages.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void unwrap(vx().ui.get(FOLDER_KEY)).then(
      (v) => v === true && setOpen(true),
      () => undefined,
    );
  }, []);
  const showing = open || !!current.group;
  const toggle = () => {
    const next = !showing;
    setOpen(next);
    void vx().ui.set(FOLDER_KEY, next);
    // Closing the folder on one of its pages goes back to the first core page.
    if (!next && current.group) onPage(pages[0]!.key);
  };
  const row = (p: Page, label = p.title) => (
    <div
      key={p.key}
      className="vx-row"
      role="link"
      tabIndex={0}
      aria-current={p.key === current.key ? 'page' : undefined}
      title={label === p.title ? undefined : p.title}
      onClick={() => onPage(p.key)}
      onKeyDown={(e) => e.key === 'Enter' && onPage(p.key)}
    >
      <span className="vx-row__name">{label}</span>
    </div>
  );
  return (
    <div className="vx-help" data-testid="settings-help">
      <nav className="vx-help__nav" aria-label={s.sections.help}>
        {pages.filter((p) => !p.group).map((p) => row(p))}
        {pluginPages.length > 0 && (
          <div className="vx-help__folder">
            <button
              type="button"
              className="vx-help__folder-head"
              aria-expanded={showing}
              aria-controls="vx-help-plugins"
              data-testid="help-plugins-folder"
              onClick={toggle}
            >
              <Icon name={showing ? 'chevron-down' : 'chevron-right'} size={14} strokeWidth={2.2} />
              <Icon name="folder" size={16} />
              <span className="vx-help__folder-name">{s.helpPlugins}</span>
              <span className="vx-help__folder-count">{groups.length}</span>
            </button>
            {showing && (
              <div
                className="vx-help__folder-body"
                id="vx-help-plugins"
                role="group"
                aria-label={s.helpPlugins}
              >
                {groups.map((g) => {
                  const own = pluginPages.filter((p) => p.group === g);
                  // One page reads as the plugin's name; several sit under it.
                  if (own.length === 1) return row(own[0]!, g);
                  return (
                    <div key={g} className="vx-help__group">
                      <div className="vx-help__group-title vx-caps">{g}</div>
                      {own.map((p) => row(p))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>
      <Article page={current} />
    </div>
  );
}
