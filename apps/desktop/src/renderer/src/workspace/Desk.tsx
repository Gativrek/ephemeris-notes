import { useEffect, useRef, type MouseEvent } from 'react';
import { ICON_NAMES, Icon, type IconName } from '../components/Icon';
import { useCardStrip } from '../features/chooser/strip';
import { isViewId, parseViewId, requestViewClose, useViewCard } from '../plugins/views';
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
  // A plugin view may keep itself open (unsaved state, SPECS 12.11.4).
  if (isViewId(path)) {
    void requestViewClose(path).then((ok) => ok && useWorkspace.getState().closeItem(path));
    return;
  }
  ws.closeItem(path);
  if (!ws.desk.pinned.includes(path)) void closeDoc(path);
}

function ViewCard({ id, pinned, active }: { id: string; pinned: boolean; active: boolean }) {
  const card = useViewCard(id);
  const ws = useWorkspace.getState;
  const onContext = async (e: MouseEvent) => {
    e.preventDefault();
    const choice = await unwrap(
      vx().window.contextMenu([
        { id: pinned ? 'unpin' : 'pin', label: pinned ? s.menu.unpin : s.menu.pin },
        { id: 'close', label: s.menu.close, enabled: !pinned },
        { id: 'others', label: s.menu.closeOthers },
      ]),
    ).catch(() => null);
    if (choice === 'pin') ws().pin(id);
    if (choice === 'unpin') ws().unpin(id);
    if (choice === 'close') closeItem(id);
    if (choice === 'others') for (const p of ws().desk.open) if (p !== id) closeItem(p);
  };
  const icon = card.icon && (ICON_NAMES as string[]).includes(card.icon) ? (card.icon as IconName) : 'note';
  return (
    <button
      type="button"
      role="tab"
      className="vx-desk-card"
      aria-selected={active}
      title={card.title}
      data-testid={pinned ? 'desk-pinned' : 'desk-card'}
      data-path={id}
      style={{ width: active ? 270 : 210 }}
      onClick={() => ws().activate(id)}
      onAuxClick={(e) => {
        if (e.button === 1 && !pinned) closeItem(id);
      }}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onContextMenu={(e) => void onContext(e)}
    >
      <span className="vx-desk-card__thumb vx-desk-card__thumb--view">
        <Icon name={icon} />
      </span>
      <span className="vx-desk-card__body">
        <span className="vx-desk-card__title">
          {card.title}
          {card.dirty ? ' •' : ''}
        </span>
        <span className="vx-desk-card__sub">
          {card.missing ??
            (pinned ? (
              <>
                <span className="vx-diamond vx-diamond--gold" aria-hidden="true" />
                {s.desk.pinned}
              </>
            ) : (
              parseViewId(id)?.owner
            ))}
        </span>
      </span>
    </button>
  );
}

function Card({ path, pinned, active }: { path: string; pinned: boolean; active: boolean }) {
  if (isViewId(path)) return <ViewCard id={path} pinned={pinned} active={active} />;
  return <NoteCard path={path} pinned={pinned} active={active} />;
}

function NoteCard({ path, pinned, active }: { path: string; pinned: boolean; active: boolean }) {
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
  // Scrolls like the chooser strip: drag, flick or wheel; no scrollbar eating its height.
  const ref = useRef<HTMLDivElement>(null);
  const { state: strip } = useCardStrip(ref, { stride: 220, scale: 1, disabled: false, snap: false });
  useEffect(() => {
    const el = ref.current;
    if (!el || !desk.active) return;
    const card = [...el.querySelectorAll<HTMLElement>('.vx-desk-card')].find(
      (c) => c.dataset.path === desk.active,
    );
    if (!card) return;
    // Bring the active card in clear of the edge fade (48px), moving as little as possible.
    const r = card.getBoundingClientRect();
    const v = el.getBoundingClientRect();
    const pad = 56;
    if (r.left < v.left + pad) el.scrollBy({ left: r.left - v.left - pad, behavior: 'smooth' });
    else if (r.right > v.right - pad) el.scrollBy({ left: r.right - v.right + pad, behavior: 'smooth' });
  }, [desk.active, desk.open.length, desk.pinned.length]);
  return (
    <div
      ref={ref}
      className={[
        'vx-desk',
        strip.overflow && 'is-overflowing',
        strip.atStart && 'at-start',
        strip.atEnd && 'at-end',
      ]
        .filter(Boolean)
        .join(' ')}
      role="tablist"
      aria-label={s.desk.label}
      data-testid="desk"
    >
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
            for (const p of desk.open) if (!isViewId(p)) void closeDoc(p);
            useWorkspace.getState().clearUnpinned();
          }}
        >
          {s.desk.clear}
        </button>
      )}
    </div>
  );
}
