/** Title bar (SPECS 9.2), tool rail (9.3) and status bar (9.7). */
import { useEffect, useState, type ReactNode } from 'react';
import type { VaultInfo } from '@shared/bridge';
import { Icon, type IconName } from '../components/Icon';
import { useCatalog } from '../lib/catalog';
import { useApp } from '../store/app';
import { domainStrings } from '../strings/domains';
import { workspaceStrings as s } from '../strings/workspace';
import { openDailyNote } from './actions';
import { getRecord, useDocs } from './docs';
import { editorStats } from './EditorPane';
import { SearchBox, useIndexStatus, type SearchHandle } from './SearchBox';
import { useWorkspace } from './store';

export type SearchScopeKind = 'vault' | 'domain' | 'all';

export function TitleBar({
  vault,
  searchRef,
  scope,
  onScope,
  children,
}: {
  vault: VaultInfo;
  searchRef: React.RefObject<SearchHandle | null>;
  scope: SearchScopeKind;
  onScope: (s: SearchScopeKind) => void;
  children?: ReactNode;
}) {
  return (
    <header className="vx-titlebar" data-testid="titlebar">
      <SearchBox ref={searchRef} vault={vault} scope={scope} />
      <div
        role="group"
        aria-label={s.search.scopeLabel}
        className="vx-segmented vx-segmented--small vx-titlebar__scope"
      >
        {(['vault', 'domain', 'all'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={scope === k} onClick={() => onScope(k)}>
            {s.search.scopes[k]}
          </button>
        ))}
      </div>
      {children}
    </header>
  );
}

function RailButton({
  icon,
  label,
  title,
  pressed,
  onClick,
  badge,
  disabled,
}: {
  icon: IconName;
  label: string;
  title: string;
  pressed?: boolean;
  onClick: () => void;
  badge?: number;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="vx-icon-btn vx-icon-btn--rail"
      aria-label={label}
      title={title}
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      style={disabled ? { opacity: 0.45, cursor: 'default' } : undefined}
    >
      <Icon name={icon} />
      {badge ? <span className="vx-rail__badge">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}

export function Rail({
  onSearch,
  onInbox,
  onHelp,
  onSettings,
  inboxEnabled,
  helpEnabled,
  settingsEnabled,
}: {
  onSearch: () => void;
  onInbox: () => void;
  onHelp: () => void;
  onSettings: () => void;
  inboxEnabled: boolean;
  helpEnabled: boolean;
  settingsEnabled: boolean;
}) {
  const sidebar = useWorkspace((st) => st.sidebar);
  const inboxCount = useCatalog(
    (st) => st.paths.filter((p) => p.startsWith('Inbox/') && !p.slice(6).includes('/')).length,
  );
  return (
    <nav className="vx-rail" aria-label="Tools">
      <RailButton
        icon="vaults"
        label={s.rail.vaults}
        title={s.rail.vaultsTitle}
        onClick={() => useApp.getState().showChooser()}
      />
      <RailButton
        icon="folder"
        label={s.rail.files}
        title={s.rail.filesTitle}
        pressed={sidebar}
        onClick={() => useWorkspace.getState().setPanels({ sidebar: !sidebar })}
      />
      <RailButton icon="search" label={s.rail.search} title={s.rail.searchTitle} onClick={onSearch} />
      <RailButton
        icon="inbox"
        label={s.rail.inbox}
        title={s.rail.inboxTitle}
        onClick={onInbox}
        badge={inboxCount}
        disabled={!inboxEnabled}
      />
      <RailButton
        icon="calendar"
        label={s.rail.daily}
        title={s.rail.dailyTitle}
        onClick={() => void openDailyNote()}
      />
      <span className="vx-rail__spacer" />
      <RailButton
        icon="help"
        label={s.rail.help}
        title={s.rail.helpTitle}
        onClick={onHelp}
        disabled={!helpEnabled}
      />
      <RailButton
        icon="settings"
        label={s.rail.settings}
        title={s.rail.settingsTitle}
        onClick={onSettings}
        disabled={!settingsEnabled}
      />
    </nav>
  );
}

function useEditorStats(): { line: number; col: number; words: number } {
  const [st, setSt] = useState({ line: 1, col: 1, words: 0 });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fn = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const text = editorStats.path ? (getRecord(editorStats.path)?.state.doc.toString() ?? '') : '';
        const words = (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
        setSt({ line: editorStats.line, col: editorStats.col, words });
      }, 200);
    };
    editorStats.listeners.add(fn);
    return () => {
      editorStats.listeners.delete(fn);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return st;
}

export function StatusBar({ vault, extra }: { vault: VaultInfo; extra?: ReactNode }) {
  const active = useWorkspace((st) => st.desk.active);
  const meta = useDocs((st) => (active ? st.meta[active] : undefined));
  const stats = useEditorStats();
  const index = useIndexStatus();
  const d = domainStrings[vault.domain];
  const crumbs = active
    ? active
        .slice(vault.path.length + 1)
        .split('/')
        .slice(0, -1)
    : [];
  const save = !meta
    ? ''
    : meta.readOnly
      ? s.status.readOnly
      : meta.saving
        ? s.status.saving
        : meta.dirty
          ? s.status.unsaved
          : s.status.saved;
  return (
    <footer className="vx-statusbar" data-testid="statusbar">
      <span className="vx-statusbar__crumbs">
        <span className="vx-diamond" style={{ ['--domain' as string]: d.color }} aria-hidden="true" />
        <span>{vault.name}</span>
        {crumbs.map((c, i) => (
          <span key={i}>› {c}</span>
        ))}
      </span>
      <span className="vx-statusbar__spacer" />
      {extra}
      {index.state === 'indexing' && (
        <span data-testid="index-progress">{s.status.indexing(index.done, index.total)}</span>
      )}
      {meta && <span>{s.status.words(stats.words)}</span>}
      {meta && <span>{s.status.position(stats.line, stats.col)}</span>}
      {meta && <span data-testid="save-state">{save}</span>}
    </footer>
  );
}
