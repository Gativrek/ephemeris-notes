import type { MouseEvent } from 'react';
import { Icon } from '../components/Icon';
import { unwrap, vx } from '../lib/vx';
import { workspaceStrings as s } from '../strings/workspace';
import { currentVault } from './actions';
import { closeDoc, useDocs } from './docs';
import { useWorkspace } from './store';
import { dailyParts, displayName } from './tree';

const DAILY = /^\d{4}-\d{2}-\d{2}\.md$/;

function titleOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return DAILY.test(name) ? dailyParts(name).weekday : displayName(name).replace(/\.pdf$/i, '');
}

function subOf(path: string, vaultPath: string, dailyFolder: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (path.startsWith(`${dailyFolder}/`) && DAILY.test(name)) {
    return name.slice(0, 10) === new Date().toISOString().slice(0, 10) ? s.desk.dailyToday : s.desk.daily;
  }
  const rest = path.slice(vaultPath.length + 1);
  const section = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : 'Unfiled';
  return section;
}

export function closeItem(path: string): void {
  const ws = useWorkspace.getState();
  ws.closeItem(path);
  if (!ws.desk.pinned.includes(path)) void closeDoc(path);
}

function Card({ path, pinned, active }: { path: string; pinned: boolean; active: boolean }) {
  const vault = currentVault();
  const dirty = useDocs((st) => st.meta[path]?.dirty ?? false);
  if (!vault) return null;
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dailyFolder = `${vault.path}/${vault.settings.daily}`;
  const isDaily = path.startsWith(`${dailyFolder}/`) && DAILY.test(name);
  const isPdf = /\.pdf$/i.test(path);
  const ws = useWorkspace.getState;

  const onContext = async (e: MouseEvent) => {
    e.preventDefault();
    const choice = await unwrap(
      vx().window.contextMenu([
        { id: pinned ? 'unpin' : 'pin', label: pinned ? s.menu.unpin : s.menu.pin },
        { id: 'close', label: s.menu.close, enabled: !pinned },
        { id: 'others', label: s.menu.closeOthers },
        { id: 'reveal', label: s.menu.reveal, separatorBefore: true },
      ]),
    ).catch(() => null);
    if (choice === 'pin') ws().pin(path);
    if (choice === 'unpin') ws().unpin(path);
    if (choice === 'close') closeItem(path);
    if (choice === 'others') for (const p of ws().desk.open) if (p !== path) closeItem(p);
    if (choice === 'reveal') void vx().shell.revealInFolder(path);
  };

  return (
    <button
      type="button"
      role="tab"
      className="vx-desk-card"
      aria-selected={active}
      title={path}
      data-testid={pinned ? 'desk-pinned' : 'desk-card'}
      data-path={path}
      style={{ width: active ? 270 : 210 }}
      onClick={() => ws().activate(path)}
      onAuxClick={(e) => {
        if (e.button === 1 && !pinned) closeItem(path);
      }}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onContextMenu={(e) => void onContext(e)}
    >
      {isDaily ? (
        <span className="vx-desk-card__thumb vx-desk-card__thumb--date">{dailyParts(name).day}</span>
      ) : isPdf ? (
        <span className="vx-desk-card__thumb vx-desk-card__thumb--pdf">
          <span className="vx-pdf">PDF</span>
        </span>
      ) : (
        <span className="vx-desk-card__thumb vx-desk-card__thumb--note vx-cover-contour" />
      )}
      <span className="vx-desk-card__body">
        <span className="vx-desk-card__title">
          {titleOf(path)}
          {dirty ? ' •' : ''}
        </span>
        <span className="vx-desk-card__sub">
          {pinned ? (
            <>
              <span className="vx-diamond vx-diamond--gold" aria-hidden="true" />
              {s.desk.pinned}
            </>
          ) : (
            subOf(path, vault.path, dailyFolder)
          )}
        </span>
      </span>
    </button>
  );
}

export function Desk() {
  const desk = useWorkspace((st) => st.desk);
  return (
    <div className="vx-desk" role="tablist" aria-label={s.desk.label} data-testid="desk">
      {desk.open.map((p) => (
        <Card key={p} path={p} pinned={false} active={desk.active === p} />
      ))}
      {desk.pinned.length > 0 && <span className="vx-desk__divider" aria-hidden="true" />}
      {desk.pinned.map((p) => (
        <Card key={p} path={p} pinned active={desk.active === p} />
      ))}
      <button
        type="button"
        className="vx-desk-add"
        aria-label={s.desk.add}
        title={s.desk.add}
        onClick={() => useWorkspace.setState({ overlay: { kind: 'quickOpen' } })}
      >
        <Icon name="plus" />
      </button>
      {desk.open.length > 0 && (
        <button
          type="button"
          className="vx-desk-clear"
          onClick={() => {
            for (const p of desk.open) void closeDoc(p);
            useWorkspace.getState().clearUnpinned();
          }}
        >
          {s.desk.clear}
        </button>
      )}
    </div>
  );
}
