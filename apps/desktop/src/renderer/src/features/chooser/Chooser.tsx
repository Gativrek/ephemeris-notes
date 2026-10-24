import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Domain, VaultInfo } from '@shared/bridge';
import appIcon from '@design/assets/Logos/ephemeris-icon.svg';
import { Icon } from '../../components/Icon';
import { mixHex, setWindowChromeColors } from '../../lib/chrome';
import { Hint, Kbd } from '../../components/Keycap';
import { OrnamentFrame } from '../../components/OrnamentFrame';
import { assetUrl } from '../../lib/asset';
import { relativeTime } from '../../lib/time';
import { unwrap, vx } from '../../lib/vx';
import { useApp, vaultsIn } from '../../store/app';
import { chooserStrings as s } from '../../strings/chooser';
import { DOMAIN_ORDER, domainStrings } from '../../strings/domains';
import { useCardStrip } from './strip';
import { NewVaultCard, VaultCard, type CardModel } from './VaultCard';

/** Cards in view at 1920 × 1080; more scroll (SPECS 7). */
export const VISIBLE_CARDS = 5;
/** One card plus the gap after it: the strip scrolls and snaps in these steps. */
const STRIDE = 300 + 44;
/** Natural size of the framed panel at 1920 × 1080 (cards, header, scroll indicator). */
const PANEL = { width: 5 * 300 + 4 * 44 + 2 * 44, height: 92 + 8 + 570 + 24 + 72 + 40 };
const BAND_HEIGHT = 54;

export function cardModel(v: VaultInfo): CardModel {
  const edited = v.lastEdited ? relativeTime(v.lastEdited) : null;
  return {
    id: v.id,
    name: v.name,
    meta: v.broken ? s.broken : s.meta(v.noteCount, edited),
    cover: v.cover
      ? {
          url: assetUrl(`${v.path}/.vault/${v.cover.file}`, v.coverVersion),
          focus: v.cover.focus,
          zoom: v.cover.zoom,
        }
      : null,
  };
}

function isTyping(el: Element | null): boolean {
  return (
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)
  );
}

export function Chooser() {
  const { vaults, domain, selection, dialog, openVault, library } = useApp();
  const app = useApp.getState;
  const inDomain = useMemo(() => vaultsIn(vaults, domain), [vaults, domain]);
  const selected = selection[domain];
  // Performance mark for the SPECS 16 measurement (e2e/perf.spec.ts).
  useEffect(() => void performance.mark('vx-chooser'), []);
  const rootRef = useRef<HTMLDivElement>(null);
  // The window controls take the top bar's ground and ink (the chooser is light-only).
  // The bar is a vertical gradient and the controls one solid colour: use the gradient's
  // colour at the controls' vertical centre, where the eye compares them.
  useEffect(() => {
    const root = rootRef.current;
    const bar = root?.querySelector<HTMLElement>('.vx-chooser__topbar');
    if (!root || !bar) return;
    const css = getComputedStyle(root);
    const top = css.getPropertyValue('--chooser-topbar').trim();
    const end = css.getPropertyValue('--chooser-topbar-end').trim();
    const controls = 44;
    const span = bar.clientHeight || 83;
    setWindowChromeColors(
      mixHex(top, end, controls / 2 / span),
      css.getPropertyValue('--chooser-ink').trim(),
      controls,
    );
  }, []);
  const d = domainStrings[domain];

  // ---- Arrange (R): cards move, the order is saved to vault.json (SPECS 4.3 order) ----
  // While arranging, cards stay in their DOM order (`base`) and slide to their place in
  // `order` with a transform, so moves animate; the dragged card follows the pointer.
  const [arrange, setArrange] = useState<{
    base: string[];
    order: string[];
    drag: { path: string; offset: number } | null;
  } | null>(null);
  const arrangeRef = useRef(arrange);
  arrangeRef.current = arrange;
  const finishArrange = useCallback(
    (keep: boolean) => {
      const a = arrangeRef.current;
      if (!a) return;
      setArrange(null);
      if (!keep || a.order.every((p, i) => p === a.base[i])) {
        if (!keep) app().select(a.base.indexOf(a.order[app().selection[app().domain]] ?? ''));
        return;
      }
      // Shown at once; written to each Vault's vault.json behind it.
      const rank = new Map(a.order.map((p, i) => [p, i + 1]));
      useApp.setState((st) => ({
        vaults: [...st.vaults]
          .map((v) => (rank.has(v.path) ? { ...v, order: rank.get(v.path)! } : v))
          .sort(
            (x, y) => x.order - y.order || x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }),
          ),
      }));
      void unwrap(vx().vaults.reorder(app().domain, a.order)).catch(() => undefined);
    },
    [app],
  );
  const startArrange = useCallback(() => {
    const paths = vaultsIn(app().vaults, app().domain).map((v) => v.path);
    if (paths.length < 2) return;
    setArrange({ base: paths, order: paths, drag: null });
  }, [app]);
  /** Moves the Vault at visual position `from` to `to`. */
  const moveCard = useCallback((from: number, to: number) => {
    setArrange((a) => {
      if (!a || to < 0 || to >= a.order.length || from === to) return a;
      const order = [...a.order];
      const [p] = order.splice(from, 1);
      order.splice(to, 0, p!);
      return { ...a, order };
    });
  }, []);
  // Leaving the chooser or the Domain ends arranging, keeping the new order.
  useEffect(() => () => finishArrange(true), [domain, finishArrange]);

  // ---- the card strip: drag, flick, wheel; keyboard selection stays in view ------
  const viewportRef = useRef<HTMLDivElement>(null);

  // ---- the centred stat: total notes in the active Domain (GOALS Q4) -------------
  const [stat, setStat] = useState<Record<Domain, number> | null>(null);
  useEffect(() => {
    let live = true;
    void unwrap(vx().library.stats()).then(
      (r) => live && setStat(r.notes),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [vaults, library]);

  // ---- scale the panel to fit the window; place the band over its lower edge -----
  const stageRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, bandTop: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const scale = Math.min(1, (w - 48) / PANEL.width, (h - 24) / PANEL.height);
      const panelBottom = h / 2 + (PANEL.height * scale) / 2;
      setFit({ scale, bandTop: panelBottom - BAND_HEIGHT / 2 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const strip = useCardStrip(viewportRef, { stride: STRIDE, scale: fit.scale, disabled: !!arrange });
  useEffect(() => {
    strip.scrollCardIntoView(selected);
    // Only when the selection or Domain changes.
  }, [selected, domain]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pointer drag of a card while arranging; the strip scrolls when the card nears an edge.
  const onCardPointerDown = (e: ReactPointerEvent<HTMLDivElement>, path: string) => {
    const a = arrangeRef.current;
    const vp = viewportRef.current;
    if (!a || !vp || e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startScroll = vp.scrollLeft;
    const startPos = a.order.indexOf(path);
    app().select(startPos);
    let lastX = startX;
    let raf = 0;
    const update = () => {
      const cur = arrangeRef.current;
      if (!cur) return;
      const desired = startPos * STRIDE + (lastX - startX) / fit.scale + (vp.scrollLeft - startScroll);
      const pos = Math.max(0, Math.min(cur.order.length - 1, Math.round(desired / STRIDE)));
      const now = cur.order.indexOf(path);
      const order = [...cur.order];
      if (pos !== now) {
        order.splice(now, 1);
        order.splice(pos, 0, path);
        app().select(pos);
      }
      setArrange({ ...cur, order, drag: { path, offset: desired - pos * STRIDE } });
    };
    const edgeScroll = () => {
      const r = vp.getBoundingClientRect();
      const edge = 80 * fit.scale;
      const speed = lastX < r.left + edge ? -14 : lastX > r.right - edge ? 14 : 0;
      if (speed) {
        vp.scrollLeft += speed;
        update();
      }
      raf = requestAnimationFrame(edgeScroll);
    };
    raf = requestAnimationFrame(edgeScroll);
    const move = (ev: PointerEvent) => {
      lastX = ev.clientX;
      update();
    };
    const up = () => {
      cancelAnimationFrame(raf);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setArrange((cur) => (cur ? { ...cur, drag: null } : cur));
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  // ---- roving focus: the selected card holds focus -------------------------------
  const cardsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (dialog) return;
    const active = document.activeElement;
    if (active && active !== document.body && !cardsRef.current?.contains(active)) return;
    cardsRef.current
      ?.querySelector<HTMLElement>('.vx-card-slot.is-selected .vx-card')
      ?.focus({ preventScroll: true });
  }, [selected, domain, dialog, vaults]);

  const activate = useCallback(
    (index: number) => {
      const v = inDomain[index];
      if (v) app().openVaultPath(v.path);
      else app().openDialog({ mode: 'new', domain });
    },
    [inDomain, domain, app],
  );

  // ---- keyboard map (SPECS 7) -----------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (app().dialog || app().screen !== 'chooser') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(document.activeElement)) return;
      const sel = app().selection[app().domain];
      if (arrangeRef.current) {
        const n = arrangeRef.current.order.length;
        switch (e.key) {
          case 'ArrowLeft':
            if (sel > 0 && sel < n) {
              moveCard(sel, sel - 1);
              app().select(sel - 1);
            }
            break;
          case 'ArrowRight':
            if (sel < n - 1) {
              moveCard(sel, sel + 1);
              app().select(sel + 1);
            }
            break;
          case 'Enter':
          case 'r':
          case 'R':
            finishArrange(true);
            break;
          case 'Escape':
            finishArrange(false);
            break;
          case '[':
          case ']':
            finishArrange(true);
            app().cycleDomain(e.key === '[' ? -1 : 1);
            break;
          default:
            return;
        }
        e.preventDefault();
        return;
      }
      switch (e.key) {
        case 'r':
        case 'R':
          startArrange();
          break;
        case 'ArrowLeft':
          app().select(sel - 1);
          break;
        case 'ArrowRight':
          app().select(sel + 1);
          break;
        case 'Enter':
          activate(sel);
          break;
        case '[':
          app().cycleDomain(-1);
          break;
        case ']':
          app().cycleDomain(1);
          break;
        case 'e':
        case 'E': {
          const v = vaultsIn(app().vaults, app().domain)[sel];
          if (v) app().openDialog({ mode: 'edit', path: v.path });
          else return;
          break;
        }
        case 'Escape':
          if (!app().openVault) return;
          app().showWorkspace();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activate, app, finishArrange, moveCard, startArrange]);

  const header = s.header(d.name, inDomain.length);

  return (
    <div ref={rootRef} className="vx-chooser vx-chooser-bg" data-theme="light" data-testid="chooser">
      <header className="vx-chooser__topbar">
        <h1 className="vx-chooser__title">
          <img className="vx-chooser__icon" src={appIcon} width={48} height={48} alt="" />
          <span className="vx-chooser__wordmark">{s.title}</span>
        </h1>
        <div className="vx-chooser__stat" data-testid="chooser-stat">
          {stat && (
            <>
              <span className="vx-chooser__stat-value">{s.stat(stat[domain]).value}</span>
              <span>{s.stat(stat[domain]).label}</span>
            </>
          )}
        </div>
        <nav className="vx-domain-tabs" aria-label={s.domainsLabel}>
          <Kbd>[</Kbd>
          {DOMAIN_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              className="vx-domain-tab"
              aria-pressed={id === domain}
              style={{ ['--domain' as string]: domainStrings[id].color }}
              onClick={() => app().setDomain(id)}
            >
              <Icon name={domainStrings[id].icon} />
              <span className="vx-domain-tab__label">
                <span className="vx-diamond" />
                {domainStrings[id].name}
              </span>
            </button>
          ))}
          <Kbd>]</Kbd>
        </nav>
      </header>

      <div className="vx-chooser__stage" ref={stageRef}>
        <div className="vx-chooser__scale" style={{ transform: `scale(${fit.scale})` }}>
          <OrnamentFrame
            className="vx-chooser__panel"
            label={`${d.name} Vaults`}
            style={{ width: PANEL.width }}
          >
            <div className="vx-panel-head">
              <span className="vx-panel-head__rule" aria-hidden="true" />
              {arrange ? (
                <h2 className="vx-panel-head__title" data-testid="panel-header">
                  <span>{s.arranging}</span>
                  <span className="vx-panel-head__dot" aria-hidden="true">
                    ·
                  </span>
                  <span className="vx-panel-head__hint">{s.arrangeHint}</span>
                  <button
                    type="button"
                    className="vx-btn vx-btn--small vx-panel-head__done"
                    onClick={() => finishArrange(true)}
                  >
                    {s.done}
                  </button>
                </h2>
              ) : (
                <h2 className="vx-panel-head__title" data-testid="panel-header">
                  <span>{header.domain}</span>
                  <span className="vx-panel-head__dot" aria-hidden="true">
                    ·
                  </span>
                  {header.count === 0 ? (
                    <span>{s.noVaults}</span>
                  ) : (
                    <>
                      <span className="vx-panel-head__count vx-gold">{header.count}</span>
                      <span>{header.noun}</span>
                    </>
                  )}
                </h2>
              )}
              <span className="vx-panel-head__rule vx-panel-head__rule--r" aria-hidden="true" />
            </div>
            <div
              ref={viewportRef}
              className={`vx-cards-viewport${strip.state.overflow ? ' is-overflowing' : ''}${strip.state.atStart ? ' at-start' : ''}${strip.state.atEnd ? ' at-end' : ''}`}
              data-testid="card-strip"
            >
              <div
                className={`vx-cards${arrange ? ' is-arranging' : ''}`}
                ref={cardsRef}
                role="listbox"
                aria-label={`${d.name} Vaults`}
              >
                {(arrange ? arrange.base : inDomain.map((v) => v.path)).map((p, domIndex) => {
                  const v = inDomain.find((x) => x.path === p);
                  if (!v) return null;
                  const pos = arrange ? arrange.order.indexOf(p) : domIndex;
                  const dragged = arrange?.drag?.path === p;
                  const x = arrange ? (pos - domIndex) * STRIDE + (dragged ? arrange.drag!.offset : 0) : 0;
                  return (
                    <div
                      key={v.path}
                      className={`vx-card-cell${dragged ? ' is-dragged' : ''}`}
                      style={x ? { transform: `translateX(${x}px)` } : undefined}
                      onPointerDown={arrange ? (e) => onCardPointerDown(e, v.path) : undefined}
                    >
                      <VaultCard
                        card={cardModel(v)}
                        selected={pos === selected}
                        onSelect={() => app().select(pos)}
                        onActivate={() => (arrange ? app().select(pos) : activate(pos))}
                        {...(arrange
                          ? {}
                          : { onEdit: () => app().openDialog({ mode: 'edit', path: v.path }) })}
                        editLabel={s.editVault(v.name)}
                      />
                    </div>
                  );
                })}
                {!arrange && (
                  <div className="vx-card-cell">
                    <NewVaultCard
                      selected={inDomain.length === selected}
                      onSelect={() => app().select(inDomain.length)}
                      onActivate={() => activate(inDomain.length)}
                      title={s.newVault}
                      hint={s.newVaultHint}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="vx-pager" aria-hidden="true">
              {strip.state.overflow && (
                <span className="vx-strip-track" data-testid="strip-indicator">
                  <span
                    className="vx-strip-thumb"
                    style={{
                      left: `${strip.state.thumb.left * 100}%`,
                      width: `${strip.state.thumb.width * 100}%`,
                    }}
                  />
                </span>
              )}
            </div>
          </OrnamentFrame>
        </div>
        <div
          className="vx-band vx-chooser__band"
          style={{ top: fit.bandTop, ['--band-mark' as string]: d.band }}
          data-testid="domain-band"
        >
          <span className="vx-diamond" aria-hidden="true" />
          <span className="vx-band__label">{d.name}</span>
          <span className="vx-diamond" aria-hidden="true" />
        </div>
      </div>

      <footer className="vx-chooser__hints" aria-label="Keyboard">
        {arrange ? (
          <>
            <Hint keys={[{ label: '←' }, { label: '→' }]}>{s.hints.move}</Hint>
            <Hint keys={[{ label: 'Enter', word: true }]}>{s.hints.done}</Hint>
            <Hint keys={[{ label: 'Esc', word: true }]}>{s.hints.cancel}</Hint>
          </>
        ) : (
          <>
            <Hint keys={[{ label: '←' }, { label: '→' }]}>{s.hints.select}</Hint>
            <Hint keys={[{ label: 'Enter', word: true }]}>{s.hints.open}</Hint>
            <Hint keys={[{ label: '[' }, { label: ']' }]}>{s.hints.domain}</Hint>
            <Hint keys={[{ label: 'E' }]}>{s.hints.edit}</Hint>
            {inDomain.length > 1 && <Hint keys={[{ label: 'R' }]}>{s.hints.arrange}</Hint>}
            {openVault && <Hint keys={[{ label: 'Esc', word: true }]}>{s.hints.back}</Hint>}
          </>
        )}
      </footer>
    </div>
  );
}
