/**
 * The native window controls (minimize, maximize, close) are drawn by the system over
 * the top-right corner (title-bar overlay, SPECS 9.2). Each screen gives them its own
 * ground and ink, read from the design tokens in effect on that screen's root element
 * (the chooser is light-only, so it reads its own light values even in dark mode).
 */
import { vx } from './vx';

const HEX = /^#[0-9a-f]{6}$/i;

export function setWindowChrome(scope: Element, background: string, ink: string, height = 44): void {
  const css = getComputedStyle(scope);
  setWindowChromeColors(css.getPropertyValue(background).trim(), css.getPropertyValue(ink).trim(), height);
}

export function setWindowChromeColors(background: string, ink: string, height = 44): void {
  if (HEX.test(background) && HEX.test(ink)) void vx().window.setChrome({ background, symbols: ink, height });
}

/** The colour `t` (0 to 1) of the way from `a` to `b`, both #rrggbb. */
export function mixHex(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
