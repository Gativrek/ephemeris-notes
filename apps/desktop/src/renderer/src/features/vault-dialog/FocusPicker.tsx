import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useImageSize } from '../chooser/cover';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The cover image with a draggable focus point (SPECS 8). Arrow keys move the point by
 * 2% (Shift: 10%), so the whole dialog works from the keyboard.
 */
export function FocusPicker({
  url,
  focus,
  onChange,
  label,
}: {
  url: string;
  focus: { x: number; y: number };
  onChange: (f: { x: number; y: number }) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const natural = useImageSize(url);

  /** The rectangle the image occupies inside the box (object-fit: contain). */
  const imageRect = useCallback(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || !natural) return null;
    const s = Math.min(box.width / natural.width, box.height / natural.height);
    const w = natural.width * s;
    const h = natural.height * s;
    return { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, width: w, height: h };
  }, [natural]);

  const fromPointer = (e: PointerEvent) => {
    const r = imageRect();
    if (!r) return;
    onChange({ x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    onChange({ x: clamp01(focus.x + m[0]), y: clamp01(focus.y + m[1]) });
  };

  // Marker position inside the box, in percent of the box.
  let markLeft = `${focus.x * 100}%`;
  let markTop = `${focus.y * 100}%`;
  const box = ref.current?.getBoundingClientRect();
  const r = imageRect();
  if (box && r && box.width > 0 && box.height > 0) {
    markLeft = `${((r.left - box.left + focus.x * r.width) / box.width) * 100}%`;
    markTop = `${((r.top - box.top + focus.y * r.height) / box.height) * 100}%`;
  }

  return (
    <div
      ref={ref}
      className="vx-focus"
      tabIndex={0}
      role="group"
      aria-label={`${label}: ${Math.round(focus.x * 100)}% across, ${Math.round(focus.y * 100)}% down`}
      data-testid="focus-picker"
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        fromPointer(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
      }}
    >
      <img className="vx-focus__img" src={url} alt="" draggable={false} />
      <span className="vx-focus__mark" style={{ left: markLeft, top: markTop }} />
    </div>
  );
}
