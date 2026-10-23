/**
 * The workspace (SPECS 9): title bar, rail, sidebar, desk, editor, outline panel and
 * status bar, with the core shortcuts of SPECS 11.4.
 */
import { useEffect, useRef, useState } from 'react';
import type { Backlink, VaultInfo } from '@shared/bridge';
import { Settings, type SettingsSection } from '../settings/Settings';
import { PluginOverlays } from '../../plugins/PluginOverlays';
import { setPluginNotifier, startPlugins } from '../../plugins/host';
import { usePlugins, type CommandEntry } from '../../plugins/store';
import type { SearchHandle } from '../../workspace/SearchBox';
import { useCatalog, wireCatalog } from '../../lib/catalog';
import { currentTheme, onThemeChange } from '../../lib/theme';
import { useSettings, wireSettings } from '../../lib/settings';
import { unwrap, vx } from '../../lib/vx';
import { useApp } from '../../store/app';
import { workspaceStrings as s } from '../../strings/workspace';
import { newNote, openDailyNote, setNotifier } from '../../workspace/actions';
import { setDateLocale } from '../../workspace/tree';
import { Rail, StatusBar, TitleBar, type SearchScopeKind } from '../../workspace/Chrome';
import { closeItem, Desk } from '../../workspace/Desk';
import { externalChange, externalDelete, getRecord, saveAll, useDocs } from '../../workspace/docs';
import { EditorPane } from '../../workspace/EditorPane';
import { Outline, useOutline } from '../../workspace/Outline';
import { Overlays } from '../../workspace/Overlays';
import { Sidebar } from '../../workspace/Sidebar';
import { useWorkspace } from '../../workspace/store';

const NO_BACKLINKS: Backlink[] = [];

/** Backlinks of the active note from the index (SPECS 9.6), refreshed as the index changes. */
function useBacklinks(path: string | null): Backlink[] {
  const [links, setLinks] = useState<Backlink[]>(NO_BACKLINKS);
  useEffect(() => {
    if (!path) {
      setLinks(NO_BACKLINKS);
      return;
    }
    let live = true;
    const load = () =>
      void unwrap(vx().index.backlinks(path)).then(
        (b) => live && setLinks(b),
        () => undefined,
      );
    load();
    const off = vx().index.onChanged(load);
    return () => {
      live = false;
      off();
    };
  }, [path]);
  return links;
}

/** Native window-control colours follow the theme (title-bar overlay). */
function syncChrome(): void {
  const css = getComputedStyle(document.documentElement);
  const bg = css.getPropertyValue('--surface-chrome').trim();
  const ink = css.getPropertyValue('--ink').trim();
  if (/^#[0-9a-f]{6}$/i.test(bg) && /^#[0-9a-f]{6}$/i.test(ink))
    void vx().window.setChrome({ background: bg, symbols: ink });
}

function useNotice(): [string | null, (m: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg, setMsg];
}

export function Workspace({ vaultPath }: { vaultPath: string }) {
  const vault = useApp((st) => st.vaults.find((v) => v.path === vaultPath)) as VaultInfo | undefined;
  const sidebar = useWorkspace((st) => st.sidebar);
  const outlineOpen = useWorkspace((st) => st.outline);
  const active = useWorkspace((st) => st.desk.active);
  const activeTitle = useDocs((st) => (active ? st.meta[active]?.path : null));
  const searchRef = useRef<SearchHandle>(null);
  const [settingsAt, setSettingsAt] = useState<{ section: SettingsSection; page: string | null } | null>(
    null,
  );
  const toggleSettings = (section: SettingsSection = 'general', page: string | null = null) =>
    setSettingsAt((cur) => (cur && cur.section === section && !page ? null : { section, page }));
  const dateLanguage = useSettings((st) => st.get<string>('general.dateLanguage'));
  setDateLocale(dateLanguage);
  const [scope, setScope] = useState<SearchScopeKind>('vault');
  const [notice, setNotice] = useNotice();
  const notePath = active && /\.md$/i.test(active) ? active : null;
  const backlinks = useBacklinks(notePath);
  const outline = useOutline(notePath, backlinks);
  useSettings((st) => st.loaded);

  useEffect(() => setNotifier(setNotice), [setNotice]);
  useEffect(() => setPluginNotifier((m) => setNotice(m)), [setNotice]);

  // Plugins load after the workspace's first paint (SPECS 12.3 step 6).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() => {
      t = setTimeout(() => void startPlugins(), 0);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (t) clearTimeout(t);
    };
  }, []);

  // Core commands for the palette (SPECS 11.3).
  useEffect(() => {
    const c = s.commands.core;
    const ws = () => useWorkspace.getState();
    const core: Array<[string, string, () => void]> = [
      ['search', c.search, () => searchRef.current?.focus()],
      ['new-note', c.newNote, () => void newNote()],
      ['open-note', c.openNote, () => useWorkspace.setState({ overlay: { kind: 'quickOpen' } })],
      ['insert-link', c.insertLink, () => useWorkspace.setState({ overlay: { kind: 'insertLink' } })],
      ['toggle-source', c.toggleSource, () => ws().setPanels({ source: !ws().source })],
      ['toggle-sidebar', c.toggleSidebar, () => ws().setPanels({ sidebar: !ws().sidebar })],
      ['toggle-outline', c.toggleOutline, () => ws().setPanels({ outline: !ws().outline })],
      [
        'close-item',
        c.closeItem,
        () => {
          const d = ws().desk;
          if (d.active && d.open.includes(d.active)) closeItem(d.active);
        },
      ],
      ['daily', c.daily, () => void openDailyNote()],
      ['settings', c.settings, () => setSettingsAt({ section: 'general', page: null })],
      ['help', c.help, () => setSettingsAt({ section: 'help', page: null })],
      ['switch-vault', c.switchVault, () => useApp.getState().showChooser()],
      ['rebuild-index', c.rebuildIndex, () => void vx().index.rebuild()],
    ];
    const entries: CommandEntry[] = core.map(([id, title, run]) => ({
      id: `core:${id}`,
      title,
      owner: 'core',
      run,
    }));
    usePlugins.setState((st) => ({
      commands: [...entries, ...st.commands.filter((x) => x.owner !== 'core')],
    }));
    return () => usePlugins.setState((st) => ({ commands: st.commands.filter((x) => x.owner !== 'core') }));
  }, []);
  useEffect(() => wireCatalog(), []);
  useEffect(() => wireSettings(), []);

  useEffect(() => {
    if (vault) void useWorkspace.getState().init(vault.path, vault.id);
    // Re-initialize only when a different Vault opens.
  }, [vault?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Window title: "<note title> · <Vault name> · {AppName}" (SPECS 9.2).
  useEffect(() => {
    if (!vault) return;
    const note = active ? active.slice(active.lastIndexOf('/') + 1).replace(/\.md$/i, '') : null;
    void vx().window.setTitle([note, vault.name, s.appName].filter(Boolean).join(' · '));
  }, [vault, active, activeTitle]);

  // Theme-coloured window controls.
  useEffect(() => {
    syncChrome();
    return onThemeChange(() => requestAnimationFrame(syncChrome));
  }, []);
  void currentTheme;

  // External changes (SPECS 4.9) and the save-before-close handshake.
  useEffect(() => {
    const offChanged = vx().events.onFileChanged((e) => {
      if (getRecord(e.path)) void externalChange(e.path);
    });
    const offCreated = vx().events.onFileCreated((e) => {
      if (getRecord(e.path)) void externalChange(e.path);
    });
    const offDeleted = vx().events.onFileDeleted((e) => externalDelete(e.path));
    return () => {
      offChanged();
      offCreated();
      offDeleted();
    };
  }, []);

  // Core shortcuts (SPECS 11.4). They never shadow CodeMirror's own keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const ws = useWorkspace.getState();
      if (key === 'k' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (key === 'n' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void newNote();
      } else if (key === 'e' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        ws.setPanels({ source: !ws.source });
      } else if (key === 'w' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (ws.desk.active && ws.desk.open.includes(ws.desk.active)) closeItem(ws.desk.active);
      } else if (e.key === '\\' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        ws.setPanels({ sidebar: !ws.sidebar });
      } else if (key === 'o' && e.shiftKey && !e.altKey) {
        e.preventDefault();
        ws.setPanels({ outline: !ws.outline });
      } else if (key === 'd' && e.shiftKey && !e.altKey) {
        e.preventDefault();
        void openDailyNote();
      } else if (key === 'p' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        useWorkspace.setState({ overlay: ws.overlay?.kind === 'commands' ? null : { kind: 'commands' } });
      } else if (e.key === ',' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setSettingsAt((o) => (o ? null : { section: 'general', page: null }));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // A Vault switch or a window reload: save everything first.
  useEffect(() => () => void saveAll(), []);

  if (!vault) return null;
  return (
    <div className="vx-shell" data-testid="workspace">
      <TitleBar vault={vault} searchRef={searchRef} scope={scope} onScope={setScope} />
      <Rail
        onSearch={() => searchRef.current?.focus()}
        onInbox={() => undefined}
        onHelp={() => toggleSettings('help')}
        onSettings={() => toggleSettings('general')}
        inboxEnabled={false}
        helpEnabled
        settingsEnabled
      />
      {sidebar && <Sidebar vault={vault} />}
      <main className="vx-main">
        <Desk />
        <EditorPane />
      </main>
      {outlineOpen && (
        <div className="vx-outline-wrap">
          <Outline model={outline.model} currentLine={outline.currentLine} />
        </div>
      )}
      <StatusBar vault={vault} extra={notice ? <span role="status">{notice}</span> : null} />
      {settingsAt && (
        <Settings
          onClose={() => setSettingsAt(null)}
          initial={settingsAt.section}
          helpPage={settingsAt.page}
        />
      )}
      <Overlays />
      <PluginOverlays />
    </div>
  );
}

void useCatalog;
