/**
 * The Inbox (SPECS 4.6): files other tools created in `Inbox/`, listed in the sidebar
 * area, newest first. "Move to…" files a note into a Vault section; the app may also
 * open, edit or trash Inbox notes. Outside tools only ever add files.
 */
import { useEffect, useMemo, useState } from 'react';
import type { VaultInfo } from '@shared/bridge';
import { Icon } from '../components/Icon';
import { Palette } from '../components/Palette';
import { useCatalog } from '../lib/catalog';
import { relativeTime } from '../lib/time';
import { unwrap, vx } from '../lib/vx';
import { useApp } from '../store/app';
import { domainStrings } from '../strings/domains';
import { workspaceStrings as s } from '../strings/workspace';
import { baseName, notice, openPath, renamePath, report } from './actions';
import { useWorkspace } from './store';
import { buildSections, collator, displayName } from './tree';

const INBOX = 'Inbox/';

export function inboxFiles(paths: string[]): string[] {
  return paths.filter((p) => p.startsWith(INBOX) && !p.slice(INBOX.length).includes('/'));
}

/** A free name in `folder`: "name.md", then "name 2.md", "name 3.md". */
export function freeName(folder: string, name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const key = (n: string) => `${folder}/${n}`.toLowerCase();
  if (!taken.has(key(name))) return name;
  for (let i = 2; ; i++) {
    const n = `${stem} ${i}${ext}`;
    if (!taken.has(key(n))) return n;
  }
}

async function inboxMenu(path: string): Promise<void> {
  const choice = await unwrap(
    vx().window.contextMenu([
      { id: 'open', label: s.inbox.open },
      { id: 'move', label: s.menu.moveTo },
      { id: 'reveal', label: s.menu.reveal, separatorBefore: true },
      { id: 'trash', label: s.menu.delete, separatorBefore: true },
    ]),
  ).catch(() => null);
  if (choice === 'open') openPath(path);
  else if (choice === 'move') useWorkspace.setState({ overlay: { kind: 'moveTo', path } });
  else if (choice === 'reveal') void vx().shell.revealInFolder(path);
  else if (choice === 'trash') useWorkspace.setState({ overlay: { kind: 'confirmTrash', path } });
}

export function InboxPanel() {
  const files = useCatalog((st) => st.files);
  const active = useWorkspace((st) => st.desk.active);
  const items = useMemo(
    () =>
      files
        .filter((f) => f.path.startsWith(INBOX) && !f.path.slice(INBOX.length).includes('/'))
        // Capture names start with a timestamp, so newest first by name, then by time.
        .sort((a, b) => collator.compare(baseName(b.path), baseName(a.path)) || b.mtime - a.mtime),
    [files],
  );
  return (
    <aside className="vx-side vx-inbox" aria-label={s.inbox.title} data-testid="inbox">
      <div className="vx-inbox__head">
        <button
          type="button"
          className="vx-icon-btn"
          aria-label={s.inbox.back}
          title={s.inbox.back}
          onClick={() => useWorkspace.setState({ inbox: false })}
        >
          <Icon name="chevron-left" />
        </button>
        <span className="vx-inbox__title">{s.inbox.title}</span>
        <span className="vx-row__meta">{s.inbox.count(items.length)}</span>
      </div>
      <div className="vx-side__scroll" role="list">
        {items.length === 0 && <p className="vx-inbox__empty">{s.inbox.empty}</p>}
        {items.map((f) => {
          const name = baseName(f.path);
          const note = /\.md$/i.test(name);
          return (
            <div
              key={f.path}
              role="listitem"
              className="vx-row vx-inbox__row"
              aria-current={active === f.path ? 'page' : undefined}
              tabIndex={0}
              onClick={() => openPath(f.path)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') openPath(f.path);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                void inboxMenu(f.path);
              }}
            >
              {/\.pdf$/i.test(name) ? (
                <span className="vx-pdf">PDF</span>
              ) : (
                <Icon name="note" className="vx-row__doc" />
              )}
              <span className="vx-inbox__text">
                <span className="vx-row__name">{note ? displayName(name) : name}</span>
                <span className="vx-row__meta">{relativeTime(f.mtime)}</span>
              </span>
              <button
                type="button"
                className="vx-btn vx-btn--small vx-inbox__move"
                onClick={(e) => {
                  e.stopPropagation();
                  useWorkspace.setState({ overlay: { kind: 'moveTo', path: f.path } });
                }}
              >
                {s.inbox.moveTo}
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

interface Target {
  folder: string;
  label: string;
  detail: string;
}

/** Every section of every Vault (and each Vault root), current Vault first. */
function useTargets(): Target[] | null {
  const vaults = useApp((st) => st.vaults);
  const paths = useCatalog((st) => st.paths);
  const current = useWorkspace((st) => st.vaultPath);
  const [targets, setTargets] = useState<Target[] | null>(null);
  useEffect(() => {
    let live = true;
    const ordered = [...vaults].sort(
      (a, b) => Number(b.path === current) - Number(a.path === current) || a.order - b.order,
    );
    void Promise.all(
      ordered.map(async (v: VaultInfo) => {
        const top = await unwrap(vx().fs.list(v.path)).catch(() => []);
        const sections = buildSections(
          v,
          top.filter((e) => e.kind === 'folder').map((e) => e.name),
          paths,
        ).filter((x) => x.kind !== 'unfiled');
        const domain = domainStrings[v.domain].name;
        return [
          ...sections.map((x) => ({ folder: x.path, label: `${v.name} / ${x.name}`, detail: domain })),
          { folder: v.path, label: `${v.name} / ${s.inbox.vaultRoot}`, detail: domain },
        ];
      }),
    ).then((lists) => live && setTargets(lists.flat()));
    return () => {
      live = false;
    };
  }, [vaults, paths, current]);
  return targets;
}

export function MoveToPicker({ path }: { path: string }) {
  const targets = useTargets();
  const close = () => useWorkspace.setState({ overlay: null });
  if (!targets) return null;
  const name = baseName(path);
  return (
    <Palette
      title={s.inbox.moveToTitle(displayName(name))}
      placeholder={s.inbox.placeholder}
      testId="move-to"
      empty={s.inbox.noTargets}
      items={targets.map((t) => ({
        id: t.folder,
        label: t.label,
        detail: t.detail,
        icon: <Icon name="folder" className="vx-row__doc" />,
      }))}
      onClose={close}
      onChoose={(it) => {
        close();
        const target = targets.find((t) => t.folder === it.id);
        if (!target) return;
        const taken = new Set(useCatalog.getState().paths.map((p) => p.toLowerCase()));
        const to = `${target.folder}/${freeName(target.folder, name, taken)}`;
        void renamePath(path, to).then(
          (done) => done && notice(s.inbox.moved(target.label)),
          (err: unknown) => report(err),
        );
      }}
    />
  );
}
