/**
 * The sidebar's right edge, a handle to change its width (SPECS 9.4): drag it, or focus it
 * and use the arrow keys (16 px), Home and End; a double-click goes back to the default.
 */
import { useRef } from 'react';
import { workspaceStrings as s } from '../strings/workspace';
import { clampWidth, maxWidth, SIDEBAR, useSidebarWidth } from './sidebarWidth';

export function SidebarResize() {
  const width = useSidebarWidth((st) => st.width);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const shown = clampWidth(width, window.innerWidth);
  const set = (w: number) => useSidebarWidth.getState().set(w);
  return (
    <div
      className="vx-side__resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={s.sidebar.resize}
      aria-valuemin={SIDEBAR.min}
      aria-valuemax={maxWidth(window.innerWidth)}
      aria-valuenow={shown}
      tabIndex={0}
      title={s.sidebar.resizeHint}
      data-testid="sidebar-resize"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width: shown };
      }}
      onPointerMove={(e) => {
        if (drag.current) set(drag.current.width + e.clientX - drag.current.x);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => set(SIDEBAR.default)}
      onKeyDown={(e) => {
        const next =
          e.key === 'ArrowLeft'
            ? shown - SIDEBAR.step
            : e.key === 'ArrowRight'
              ? shown + SIDEBAR.step
              : e.key === 'Home'
                ? SIDEBAR.min
                : e.key === 'End'
                  ? SIDEBAR.max
                  : null;
        if (next === null) return;
        e.preventDefault();
        set(next);
      }}
    />
  );
}
