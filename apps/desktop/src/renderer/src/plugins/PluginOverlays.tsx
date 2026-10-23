/**
 * Plugin overlays (`ctx.ui.openOverlay`, `host.openOverlay`): a large or full-window
 * panel with a title, an unsaved-changes mark and a close button. `onRequestClose` may
 * keep it open. Rendering and closing are wrapped so a plugin error cannot break the app.
 */
import { useEffect, useRef } from 'react';
import { Icon } from '../components/Icon';
import { workspaceStrings as s } from '../strings/workspace';
import { overlayHandles } from './host';
import { usePlugins, type OverlayEntry } from './store';

async function requestClose(entry: OverlayEntry): Promise<void> {
  let ok = true;
  try {
    ok = (await entry.opts.onRequestClose?.()) !== false;
  } catch (err) {
    console.error(`[plugin ${entry.owner}] onRequestClose failed`, err);
  }
  if (ok) overlayHandles.get(entry.key)?.close();
}

function PluginOverlay({ entry, top }: { entry: OverlayEntry; top: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = body.current;
    const handle = overlayHandles.get(entry.key);
    if (!el || !handle) return;
    let cleanup: void | (() => void);
    try {
      cleanup = entry.opts.render(el, handle);
    } catch (err) {
      console.error(`[plugin ${entry.owner}] overlay render failed`, err);
      const p = document.createElement('p');
      p.className = 'vx-plugin-block__message';
      p.textContent = `${entry.owner}: ${err instanceof Error ? err.message : String(err)}`;
      el.replaceChildren(p);
    }
    return () => {
      try {
        if (typeof cleanup === 'function') cleanup();
      } catch {
        // A plugin's cleanup failing must not break the app.
      }
      overlayHandles.delete(entry.key);
      el.replaceChildren();
    };
    // The render function runs once per overlay.
  }, [entry.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      void requestClose(entry);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [entry, top]);

  return (
    <div className="vx-overlay vx-plugin-overlay__backdrop">
      <div
        className={`vx-plugin-overlay vx-plugin-overlay--${entry.opts.size ?? 'large'}`}
        role="dialog"
        aria-modal="true"
        aria-label={entry.title}
        data-plugin={entry.owner}
        data-testid="plugin-overlay"
      >
        <header className="vx-plugin-overlay__head">
          <span className="vx-plugin-overlay__title">{entry.title}</span>
          {entry.dirty && (
            <span
              className="vx-plugin-overlay__dirty"
              title={s.overlay.unsaved}
              aria-label={s.overlay.unsaved}
            />
          )}
          <button
            type="button"
            className="vx-icon-btn"
            aria-label={s.overlay.close}
            title={s.overlay.close}
            onClick={() => void requestClose(entry)}
          >
            <Icon name="close" />
          </button>
        </header>
        <div ref={body} className="vx-plugin-overlay__body" />
      </div>
    </div>
  );
}

export function PluginOverlays() {
  const overlays = usePlugins((st) => st.overlays);
  return (
    <>
      {overlays.map((o, i) => (
        <PluginOverlay key={o.key} entry={o} top={i === overlays.length - 1} />
      ))}
    </>
  );
}
