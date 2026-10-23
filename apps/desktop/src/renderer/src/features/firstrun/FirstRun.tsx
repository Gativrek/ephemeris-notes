import { useState } from 'react';
import appIcon from '@design/assets/Logos/ephemeris-icon.svg';
import { firstRunStrings as s } from '../../strings/firstrun';
import { errorMessage, unwrap, vx } from '../../lib/vx';

/**
 * Shown when no library is open. Not yet in the design system (recorded as a gap in
 * PROGRESS.md): composed from the existing button styles only.
 */
export function FirstRun() {
  const [pending, setPending] = useState<{ token: string; folder: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const open = () =>
    run(async () => {
      const r = await unwrap(vx().library.open());
      if (r.kind === 'not-library') setPending({ token: r.token, folder: r.folder });
    });

  const create = (token?: string) =>
    run(async () => {
      await unwrap(vx().library.create(token));
      setPending(null);
    });

  return (
    <main className="vx-firstrun" data-testid="first-run">
      <img className="vx-firstrun__icon" src={appIcon} width={96} height={96} alt="" />
      <h1 className="vx-firstrun__title">{s.title}</h1>
      {pending ? (
        <>
          <p className="vx-firstrun__hint">{s.notLibrary(pending.folder)}</p>
          <div className="vx-firstrun__actions">
            <button type="button" className="vx-btn" disabled={busy} onClick={() => setPending(null)}>
              {s.cancel}
            </button>
            <button
              type="button"
              className="vx-btn vx-btn--primary"
              disabled={busy}
              onClick={() => void create(pending.token)}
            >
              {s.createHere}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="vx-firstrun__hint">{s.hint}</p>
          <div className="vx-firstrun__actions">
            <button type="button" className="vx-btn" disabled={busy} onClick={() => void create()}>
              {s.create}
            </button>
            <button
              type="button"
              className="vx-btn vx-btn--primary"
              disabled={busy}
              onClick={() => void open()}
            >
              {s.open}
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="vx-firstrun__error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
