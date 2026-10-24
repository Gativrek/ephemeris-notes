/**
 * The chooser's card strip scrolls like a phone carousel (SPECS 7): drag it with the
 * mouse, flick it and it coasts, then it settles on a card; the wheel and touchpad
 * scroll it too. A drag never counts as a click on a card. The workspace Desk uses it
 * without snapping (its cards differ in width).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface StripState {
  overflow: boolean;
  atStart: boolean;
  atEnd: boolean;
  /** Indicator thumb, as fractions of the track. */
  thumb: { left: number; width: number };
}

const DRAG_THRESHOLD = 6;
/** Velocity decay per 16 ms frame while coasting. */
const FRICTION = 0.94;

export function useCardStrip(
  viewportRef: RefObject<HTMLDivElement | null>,
  opts: { stride: number; scale: number; disabled: boolean; snap?: boolean },
): { state: StripState; scrollCardIntoView: (index: number) => void; dragging: RefObject<boolean> } {
  const [state, setState] = useState<StripState>({
    overflow: false,
    atStart: true,
    atEnd: true,
    thumb: { left: 0, width: 1 },
  });
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const dragging = useRef(false);
  const coast = useRef(0);

  const measure = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next: StripState = {
      overflow: max > 1,
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft >= max - 1,
      thumb: {
        left: max > 0 ? el.scrollLeft / el.scrollWidth : 0,
        width: el.scrollWidth > 0 ? el.clientWidth / el.scrollWidth : 1,
      },
    };
    setState((p) =>
      p.overflow === next.overflow &&
      p.atStart === next.atStart &&
      p.atEnd === next.atEnd &&
      Math.abs(p.thumb.left - next.thumb.left) < 0.002 &&
      Math.abs(p.thumb.width - next.thumb.width) < 0.002
        ? p
        : next,
    );
  }, [viewportRef]);

  /** Settles on the nearest card, leaning in the direction of travel. */
  const snap = useCallback(
    (direction = 0) => {
      const el = viewportRef.current;
      if (!el) return;
      const { stride, snap: snapping = true } = optsRef.current;
      if (!snapping) return;
      const raw = el.scrollLeft / stride;
      const index =
        direction > 0 ? Math.ceil(raw - 0.15) : direction < 0 ? Math.floor(raw + 0.15) : Math.round(raw);
      const max = el.scrollWidth - el.clientWidth;
      el.scrollTo({ left: Math.max(0, Math.min(max, index * stride)), behavior: 'smooth' });
    },
    [viewportRef],
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    // Cards come and go, and change width, without the viewport resizing.
    const mo = new MutationObserver(() => requestAnimationFrame(measure));
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    el.addEventListener('scroll', measure, { passive: true });

    // Wheel and touchpad: vertical wheels scroll the strip sideways; settle when idle.
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      if (optsRef.current.disabled || el.scrollWidth <= el.clientWidth) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      e.preventDefault();
      cancelAnimationFrame(coast.current);
      el.scrollLeft += delta;
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => snap(Math.sign(delta)), 160);
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    // Drag to scroll, with momentum.
    let start: { x: number; scroll: number; id: number } | null = null;
    let samples: Array<{ t: number; x: number }> = [];
    const onDown = (e: PointerEvent) => {
      if (optsRef.current.disabled || e.button !== 0 || el.scrollWidth <= el.clientWidth) return;
      cancelAnimationFrame(coast.current);
      start = { x: e.clientX, scroll: el.scrollLeft, id: e.pointerId };
      samples = [{ t: e.timeStamp, x: e.clientX }];
      dragging.current = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      if (!dragging.current) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return;
        dragging.current = true;
        el.setPointerCapture(e.pointerId);
        el.classList.add('is-dragging');
      }
      el.scrollLeft = start.scroll - dx / optsRef.current.scale;
      samples.push({ t: e.timeStamp, x: e.clientX });
      if (samples.length > 6) samples.shift();
    };
    const onUp = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      if (!dragging.current) return;
      el.classList.remove('is-dragging');
      // A drag is not a click: swallow the click that follows it.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => {
        window.removeEventListener('click', swallow, { capture: true });
        dragging.current = false;
      }, 0);
      // Coast with the release velocity (px per ms, in strip units), then settle.
      const first = samples[0]!;
      const last = samples[samples.length - 1]!;
      const dt = Math.max(1, last.t - first.t);
      let v = -((last.x - first.x) / dt) / optsRef.current.scale;
      const direction = Math.sign(v);
      if (e.timeStamp - last.t > 80) v = 0; // Released after stopping: no coasting.
      let prev = performance.now();
      const step = (now: number) => {
        const frames = (now - prev) / 16;
        prev = now;
        el.scrollLeft += v * 16 * frames;
        v *= Math.pow(FRICTION, frames);
        const max = el.scrollWidth - el.clientWidth;
        if (Math.abs(v) > 0.05 && el.scrollLeft > 0 && el.scrollLeft < max)
          coast.current = requestAnimationFrame(step);
        else snap(direction);
      };
      coast.current = requestAnimationFrame(step);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener('scroll', measure);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      if (wheelTimer) clearTimeout(wheelTimer);
      cancelAnimationFrame(coast.current);
    };
  }, [viewportRef, measure, snap]);

  /** Keeps the card at `index` in view (keyboard selection), moving as little as possible. */
  const scrollCardIntoView = useCallback(
    (index: number) => {
      const el = viewportRef.current;
      if (!el || dragging.current) return;
      const { stride } = optsRef.current;
      const left = index * stride;
      const visible = Math.max(1, Math.floor((el.clientWidth + 1) / stride));
      let target = el.scrollLeft;
      if (left < el.scrollLeft) target = left;
      else if (left + stride > el.scrollLeft + visible * stride) target = left - (visible - 1) * stride;
      const max = el.scrollWidth - el.clientWidth;
      target = Math.max(0, Math.min(max, target));
      if (Math.abs(target - el.scrollLeft) > 1) el.scrollTo({ left: target, behavior: 'smooth' });
    },
    [viewportRef],
  );

  return { state, scrollCardIntoView, dragging };
}
