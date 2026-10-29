/**
 * The workspace (SPECS 9): title bar, rail, sidebar, desk, editor, outline panel and
 * status bar, with the core shortcuts of SPECS 11.4.
 */
import { useEffect, useRef, useState } from 'react';
import type { Backlink, VaultInfo } from '@shared/bridge';
import { Settings, type SettingsSection } from '../settings/Settings';
import { PluginOverlays } from '../../plugins/PluginOverlays';
import { isViewId, viewTitle } from '../../plugins/views';
import { setPluginNotifier, startPlugins } from '../../plugins/host';
import { usePlugins, type CommandEntry } from '../../plugins/store';
import { noteCommandRun } from '../../plugins/activity';
import type { SearchHandle } from '../../workspace/SearchBox';
import { useCatalog, wireCatalog } from '../../lib/catalog';
import { currentTheme, onThemeChange } from '../../lib/theme';
import { setWindowChrome } from '../../lib/chrome';
import { useSettings, wireSettings } from '../../lib/settings';
import { unwrap, vx } from '../../lib/vx';
import { useApp } from '../../store/app';
import { workspaceStrings as s } from '../../strings/workspace';
import { newNote, newUnfiledNote, openDailyNote, setNotifier } from '../../workspace/actions';
import { setDateLocale } from '../../workspace/tree';
import { HOTKEYS_KEY, eventKey, isMacPlatform, recording } from '../../lib/hotkeys';
import { commandFor, currentOverrides, scopeOf, type Overrides } from '../../lib/keymap';
import { Rail, StatusBar, TitleBar, type SearchScopeKind } from '../../workspace/Chrome';
import { insertCodeBlock } from '../../editor/fences';
import { applyEditorShortcuts } from '../../editor/setup';
import { closeItem, Desk } from '../../workspace/Desk';
import { externalChange, externalDelete, getRecord, saveAll, useDocs } from '../../workspace/docs';
import { currentEditor, EditorPane } from '../../workspace/EditorPane';
import { Outline, useOutline } from '../../workspace/Outline';
import { Overlays } from '../../workspace/Overlays';
import { Sidebar } from '../../workspace/Sidebar';
import { InboxPanel } from '../../workspace/Inbox';
import { useWorkspace } from '../../workspace/store';
import { stepVault } from '../../workspace/vaultStep';

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
  // The title bar is 44 px including its 1px bottom border: stop the controls above the border.
  setWindowChrome(document.documentElement, '--surface-chrome', '--ink', 43);
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
  const motion = useApp((st) => st.vaultMotion);
  const sidebar = useWorkspace((st) => st.sidebar);
  const inbox = useWorkspace((st) => st.inbox);
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
      ['new-unfiled-note', c.newUnfiled, () => void newUnfiledNote()],
      ['open-note', c.openNote, () => useWorkspace.setState({ overlay: { kind: 'quickOpen' } })],
      ['insert-link', c.insertLink, () => useWorkspace.setState({ overlay: { kind: 'insertLink' } })],
      [
        'insert-code-block',
        c.insertCodeBlock,
        () => {
          const view = currentEditor();
          if (view) insertCodeBlock(view);
        },
      ],
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
      ['prev-vault', c.prevVault, () => void stepVault(-1)],
      ['next-vault', c.nextVault, () => void stepVault(1)],
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
  // Settings > Keyboard: open editors take new keys at once.
  useEffect(
    () =>
      useSettings.subscribe((st, prev) => {
        const next = st.values[HOTKEYS_KEY];
        if (next !== prev.values[HOTKEYS_KEY]) applyEditorShortcuts((next as Overrides) ?? {});
      }),
    [],
  );

  useEffect(() => {
    if (vault) void useWorkspace.getState().init(vault.path, vault.id);
    // Re-initialize only when a different Vault opens.
  }, [vault?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Window title: "<note title> · <Vault name> · Ephemeris" (SPECS 9.2).
  useEffect(() => {
    if (!vault) return;
    const note = isViewId(active)
      ? viewTitle(active ?? '')
      : active
        ? active.slice(active.lastIndexOf('/') + 1).replace(/\.md$/i, '')
        : null;
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

  // Shortcuts for app commands (SPECS 11.3, 11.4): the keys in Settings > Keyboard, or
  // the defaults. Editor commands are left to the note editor's keymap, and Switch
  // Vault to App, since it also works in the chooser.
  useEffect(() => {
    const mac = isMacPlatform();
    // Two shortcuts toggle, where their palette commands only open.
    const toggles: Record<string, () => void> = {
      'core:palette': () =>
        useWorkspace.setState((st) => ({
          overlay: st.overlay?.kind === 'commands' ? null : { kind: 'commands' },
        })),
      'core:settings': () => setSettingsAt((o) => (o ? null : { section: 'general', page: null })),
    };
    const onKey = (e: KeyboardEvent) => {
      if (recording.active) return;
      const pressed = eventKey(e, mac);
      const id = pressed ? commandFor(pressed, currentOverrides()) : undefined;
      if (!id || scopeOf(id) === 'editor' || id === 'core:switch-vault') return;
      const toggle = toggles[id];
      const cmd = toggle ? null : usePlugins.getState().commands.find((c) => c.id === id);
      if (!toggle && !cmd) return;
      e.preventDefault();
      e.stopPropagation();
      if (toggle) return toggle();
      void (async () => {
        try {
          if (cmd!.owner !== 'core') noteCommandRun(cmd!.owner);
          await cmd!.run();
        } catch (err) {
          console.error(`[${cmd!.owner}] command ${cmd!.id} failed`, err);
          setNotice(s.commands.failed(cmd!.title, err instanceof Error ? err.message : String(err)));
        }
      })();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setNotice]);

  // A Vault switch or a window reload: save everything first.
  useEffect(() => () => void saveAll(), []);

  if (!vault) return null;
  // Stepping between Vaults slides the sidebar and fades the rest (vaultStep.ts).
  const motionClass = motion
    ? ` is-vault-${motion.phase} is-vault-${motion.phase}--${motion.dir > 0 ? 'next' : 'prev'}`
    : '';
  return (
    <div className={`vx-shell${motionClass}`} data-testid="workspace">
      <TitleBar vault={vault} searchRef={searchRef} scope={scope} onScope={setScope} />
      <Rail
        onSearch={() => searchRef.current?.focus()}
        onInbox={() => useWorkspace.setState((st) => ({ inbox: !(st.inbox && st.sidebar), sidebar: true }))}
        onHelp={() => toggleSettings('help')}
        onSettings={() => toggleSettings('general')}
        inboxEnabled
        helpEnabled
        settingsEnabled
      />
      {sidebar && (inbox ? <InboxPanel /> : <Sidebar vault={vault} />)}
      <main className="vx-main">
        <Desk />
        <EditorPane />
      </main>
      {outlineOpen && (
        <div className="vx-outline-wrap">
          <Outline model={outline.model} currentLine={outline.currentLine} path={notePath} />
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
