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
  const bg = css.getPropertyValue(background).trim();
  const symbols = css.getPropertyValue(ink).trim();
  if (HEX.test(bg) && HEX.test(symbols)) void vx().window.setChrome({ background: bg, symbols, height });
}
