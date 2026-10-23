import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { NewVaultCard, VaultCard, type CardModel } from './VaultCard';

export const PER_PAGE = 5;
/** Natural size of the framed panel at 1920 × 1080 (cards, header, pager). */
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
  const itemCount = inDomain.length + 1;
  const pages = Math.max(1, Math.ceil(itemCount / PER_PAGE));
  const page = Math.floor(selected / PER_PAGE);
  const onPage = Array.from(
    { length: Math.min(PER_PAGE, itemCount - page * PER_PAGE) },
    (_, i) => page * PER_PAGE + i,
  );
  const d = domainStrings[domain];

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
      switch (e.key) {
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
  }, [activate, app]);

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
              <span className="vx-panel-head__rule vx-panel-head__rule--r" aria-hidden="true" />
            </div>
            <div className="vx-cards" ref={cardsRef} role="listbox" aria-label={`${d.name} Vaults`}>
              {onPage.map((i) => {
                const v = inDomain[i];
                return v ? (
                  <VaultCard
                    key={v.path}
                    card={cardModel(v)}
                    selected={i === selected}
                    onSelect={() => app().select(i)}
                    onActivate={() => activate(i)}
                    onEdit={() => app().openDialog({ mode: 'edit', path: v.path })}
                    editLabel={s.editVault(v.name)}
                  />
                ) : (
                  <NewVaultCard
                    key="new"
                    selected={i === selected}
                    onSelect={() => app().select(i)}
                    onActivate={() => activate(i)}
                    title={s.newVault}
                    hint={s.newVaultHint}
                  />
                );
              })}
            </div>
            <div className="vx-pager" aria-hidden={pages === 1}>
              {pages > 1 && (
                <>
                  <button
                    type="button"
                    className="vx-pager__btn"
                    aria-label={s.previousPage}
                    title={s.previousPage}
                    disabled={page === 0}
                    onClick={() => app().select((page - 1) * PER_PAGE)}
                  >
                    <Icon name="chevron-left" />
                  </button>
                  <span className="vx-pager__dots">
                    {Array.from({ length: pages }, (_, i) => (
                      <button
                        key={i}
                        type="button"
                        className="vx-pager__dot"
                        aria-label={s.page(i + 1, pages)}
                        aria-current={i === page ? 'true' : undefined}
                        onClick={() => app().select(i * PER_PAGE)}
                      />
                    ))}
                  </span>
                  <button
                    type="button"
                    className="vx-pager__btn"
                    aria-label={s.nextPage}
                    title={s.nextPage}
                    disabled={page === pages - 1}
                    onClick={() => app().select((page + 1) * PER_PAGE)}
                  >
                    <Icon name="chevron-right" />
                  </button>
                </>
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
        <Hint keys={[{ label: '←' }, { label: '→' }]}>{s.hints.select}</Hint>
        <Hint keys={[{ label: 'Enter', word: true }]}>{s.hints.open}</Hint>
        <Hint keys={[{ label: '[' }, { label: ']' }]}>{s.hints.domain}</Hint>
        <Hint keys={[{ label: 'E' }]}>{s.hints.edit}</Hint>
        {openVault && <Hint keys={[{ label: 'Esc', word: true }]}>{s.hints.back}</Hint>}
      </footer>
    </div>
  );
}
