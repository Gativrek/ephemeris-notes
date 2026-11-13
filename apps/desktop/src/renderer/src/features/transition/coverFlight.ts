/**
 * The cover flight (SPECS 7): opening a Vault carries its card's cover to the Vault header;
 * going back carries the header to its card. The screens switch at once and stay usable;
 * a wash over them goes from the old screen's ground to the new one's through neutral greys
 * (the chooser is always light, the workspace may be dark), fading as it goes, and the
 * flight is a picture above it (inert copies of the two covers) that fades out as it lands,
 * so the Vault's title shows through early. With reduced motion, neither plays.
 */
import { useApp } from '../../store/app';

const DURATION = 400;

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const cardCover = (vaultId: string) =>
  document.querySelector<HTMLElement>(
    `.vx-card-slot[data-vault-id="${CSS.escape(vaultId)}"] .vx-card__cover`,
  );
const headerCover = () =>
  document.querySelector<HTMLElement>(
    '[data-testid="vault-header"] .vx-vault-head__cover:not(.vx-vault-head__cover--incoming)',
  );

/** A copy for show only: no ids, test ids or tab stops, hidden from assistive technology. */
function inertCopy(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  for (const n of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
    n.removeAttribute('data-testid');
    n.removeAttribute('id');
    n.removeAttribute('tabindex');
  }
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  return copy;
}

interface Captured {
  rect: DOMRect;
  radius: number;
  copy: HTMLElement;
}

function capture(el: HTMLElement | null): Captured | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return { rect, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, copy: inertCopy(el) };
}

/** Waits for an element to exist and be laid out, for at most a second. */
function waitFor<T extends HTMLElement>(find: () => T | null): Promise<T | null> {
  return new Promise((resolve) => {
    const until = performance.now() + 1000;
    const look = () => {
      const el = find();
      if (el && el.getBoundingClientRect().width) return resolve(el);
      if (performance.now() > until) return resolve(null);
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}

/** A colour as red, green and blue, resolved by the page from any CSS colour. */
function rgb(css: string): [number, number, number] | null {
  const probe = document.createElement('span');
  probe.style.color = css;
  document.body.append(probe);
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(probe).color);
  probe.remove();
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

/**
 * A full-window wash from one screen's ground to the other's, passing through the neutral
 * grey halfway in brightness, and fading out as it goes, so the new screen shows through.
 */
function wash(fromToken: string, toToken: string): void {
  const a = rgb(token(fromToken));
  const b = rgb(token(toToken));
  if (!a || !b) return;
  const luma = ([r, g, bl]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  const grey = Math.round((luma(a) + luma(b)) / 2);
  const el = document.createElement('div');
  el.className = 'vx-wash';
  el.setAttribute('aria-hidden', 'true');
  document.body.append(el);
  el.animate(
    [
      { backgroundColor: `rgb(${a.join(',')})`, opacity: 1 },
      { backgroundColor: `rgb(${grey},${grey},${grey})`, opacity: 0.6, offset: 0.45 },
      { backgroundColor: `rgb(${b.join(',')})`, opacity: 0 },
    ],
    { duration: DURATION, easing: 'ease-in-out', fill: 'forwards' },
  ).onfinish = () => el.remove();
}

let landing: (() => void) | null = null;

/**
 * Flies `from` (a copy of the cover left behind) onto `target`. The target is never hidden:
 * the frame crossfades into a copy of it and fades away over the last stretch.
 */
function fly(from: Captured, target: HTMLElement): void {
  landing?.();
  const to = capture(target);
  if (!to) return;
  const frame = document.createElement('div');
  frame.className = 'vx-flight';
  frame.setAttribute('aria-hidden', 'true');
  frame.inert = true;
  const layers = [from, to];
  for (const c of layers) {
    Object.assign(c.copy.style, {
      position: 'absolute',
      inset: 'auto',
      left: '0',
      top: '0',
      margin: '0',
      width: `${c.rect.width}px`,
      height: `${c.rect.height}px`,
      transformOrigin: 'center center',
      visibility: 'visible',
    });
    frame.append(c.copy);
  }
  document.body.append(frame);
  const ease = (t: number) => 1 - (1 - t) ** 3;
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const between = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const start = performance.now();
  let raf = 0;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / DURATION);
    const e = ease(t);
    // The target is followed as it lays out (the sidebar's width arrives after the first paint).
    const end = target.getBoundingClientRect();
    const w = mix(from.rect.width, end.width, e);
    const h = mix(from.rect.height, end.height, e);
    Object.assign(frame.style, {
      left: `${mix(from.rect.left, end.left, e)}px`,
      top: `${mix(from.rect.top, end.top, e)}px`,
      width: `${w}px`,
      height: `${h}px`,
      borderRadius: `${mix(from.radius, to.radius, e)}px`,
      // Gone over the last stretch, so what lies under the landing (the title) shows.
      opacity: String(1 - between(t, 0.45, 1)),
    });
    // Each cover fills the frame as its own picture would ("cover"), then they cross.
    for (const c of layers) {
      const s = Math.max(w / c.rect.width, h / c.rect.height);
      c.copy.style.transform = `translate(${(w - c.rect.width) / 2}px, ${(h - c.rect.height) / 2}px) scale(${s})`;
    }
    const cross = between(t, 0.15, 0.6);
    from.copy.style.opacity = String(1 - cross);
    to.copy.style.opacity = String(cross);
    if (t < 1) raf = requestAnimationFrame(step);
    else land();
  };
  const land = () => {
    cancelAnimationFrame(raf);
    frame.remove();
    landing = null;
  };
  landing = land;
  raf = requestAnimationFrame(step);
}

/** Opens a Vault from its card in the chooser. */
export function enterVault(path: string): void {
  const app = useApp.getState();
  const vault = app.vaults.find((v) => v.path === path);
  const from = !reduced() && vault ? capture(cardCover(vault.id)) : null;
  // Laid before the switch, so the workspace's first frame is already under it.
  if (!reduced()) wash('chooser-ground', 'surface');
  app.openVaultPath(path);
  if (from) void waitFor(headerCover).then((to) => to && fly(from, to));
}

/** Back to the Vault already open (Escape in the chooser). */
export function returnToVault(): void {
  const app = useApp.getState();
  if (app.openVault) enterVault(app.openVault);
}

/** From the workspace back to the chooser: the header flies to its card. */
export function leaveVault(): void {
  const app = useApp.getState();
  const vault = app.vaults.find((v) => v.path === app.openVault);
  const from = !reduced() && vault && app.screen === 'workspace' ? capture(headerCover()) : null;
  if (!reduced() && app.screen === 'workspace') wash('surface', 'chooser-ground');
  app.showChooser();
  if (from && vault) void waitFor(() => cardCover(vault.id)).then((to) => to && fly(from, to));
}
