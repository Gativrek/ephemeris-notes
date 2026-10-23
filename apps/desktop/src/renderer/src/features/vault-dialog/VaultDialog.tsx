import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { CoverInput, Domain, VaultInfo, VaultMoveImpact } from '@shared/bridge';
import { Icon } from '../../components/Icon';
import { OrnamentFrame } from '../../components/OrnamentFrame';
import { assetUrl } from '../../lib/asset';
import { errorMessage, unwrap, vx } from '../../lib/vx';
import { useApp, vaultsIn } from '../../store/app';
import { chooserStrings } from '../../strings/chooser';
import { DOMAIN_ORDER, domainStrings } from '../../strings/domains';
import { vaultDialogStrings as s } from '../../strings/vaultDialog';
import { cardModel } from '../chooser/Chooser';
import { VaultCard, type CardModel } from '../chooser/VaultCard';
import { FocusPicker } from './FocusPicker';

interface CoverDraft {
  url: string;
  bytes?: ArrayBuffer;
  focus: { x: number; y: number };
  zoom: number;
}

type Step = { kind: 'form' } | { kind: 'move'; impact: VaultMoveImpact } | { kind: 'delete' };

const ACCEPT = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('type') !== 'file' && el.offsetParent !== null,
  );
}

export function VaultDialog() {
  const dialog = useApp((st) => st.dialog);
  const vaults = useApp((st) => st.vaults);
  const editing: VaultInfo | null =
    dialog?.mode === 'edit' ? (vaults.find((v) => v.path === dialog.path) ?? null) : null;
  const initialDomain: Domain = editing?.domain ?? (dialog?.mode === 'new' ? dialog.domain : 'academic');

  const [name, setName] = useState(editing?.name ?? '');
  const [domain, setDomain] = useState<Domain>(initialDomain);
  const [cover, setCover] = useState<CoverDraft | null>(() =>
    editing?.cover
      ? {
          url: assetUrl(`${editing.path}/.vault/${editing.cover.file}`, editing.coverVersion),
          focus: editing.cover.focus,
          zoom: editing.cover.zoom,
        }
      : null,
  );
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const blobUrl = useRef<string | null>(null);
  const focusPickerNext = useRef(false);

  useEffect(
    () => () => {
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    },
    [],
  );
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const trimmed = name.trim();
  const nameError = useMemo(() => {
    if (trimmed.length === 0) return s.errors.empty;
    if ([...trimmed].length > 60) return s.errors.long;
    const key = trimmed.toLocaleLowerCase();
    if (
      vaultsIn(vaults, domain).some((v) => v.path !== editing?.path && v.name.toLocaleLowerCase() === key)
    ) {
      return s.errors.taken;
    }
    return null;
  }, [trimmed, vaults, domain, editing]);
  const valid = nameError === null;

  const close = () => useApp.getState().openDialog(null);

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const bytes = await file.arrayBuffer();
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    const url = URL.createObjectURL(new Blob([bytes], { type: file.type || 'image/png' }));
    blobUrl.current = url;
    // Keep keyboard flow: the focus-point picker takes focus once it renders.
    focusPickerNext.current = true;
    setCover((c) => ({ url, bytes, focus: c?.focus ?? { x: 0.5, y: 0.5 }, zoom: c?.zoom ?? 1 }));
  };

  useEffect(() => {
    if (!focusPickerNext.current || !cover) return;
    focusPickerNext.current = false;
    rootRef.current?.querySelector<HTMLElement>('[data-testid="focus-picker"]')?.focus();
  }, [cover]);

  const coverChange = (): CoverInput | null | undefined => {
    if (!cover) return editing?.cover ? null : undefined;
    const base = { focus: cover.focus, zoom: cover.zoom };
    if (cover.bytes) return { ...base, bytes: cover.bytes };
    if (!editing?.cover) return undefined;
    const same =
      editing.cover.focus.x === cover.focus.x &&
      editing.cover.focus.y === cover.focus.y &&
      editing.cover.zoom === cover.zoom;
    return same ? undefined : base;
  };

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

  const selectInChooser = async (v: VaultInfo) => {
    const app = useApp.getState();
    await app.refreshVaults();
    const list = vaultsIn(useApp.getState().vaults, v.domain);
    useApp.setState((st) => ({
      domain: v.domain,
      selection: {
        ...st.selection,
        [v.domain]: Math.max(
          0,
          list.findIndex((x) => x.path === v.path),
        ),
      },
    }));
  };

  const submit = () => {
    setTouched(true);
    if (!valid || busy) return;
    if (!editing) {
      void run(async () => {
        const c = coverChange();
        const created = await unwrap(
          vx().vaults.create(c ? { name: trimmed, domain, cover: c } : { name: trimmed, domain }),
        );
        await selectInChooser(created);
        close();
      });
      return;
    }
    if (domain !== editing.domain && step.kind === 'form') {
      void run(async () =>
        setStep({ kind: 'move', impact: await unwrap(vx().vaults.moveImpact(editing.path)) }),
      );
      return;
    }
    void run(async () => {
      const c = coverChange();
      let v = await unwrap(
        vx().vaults.update(editing.path, c === undefined ? { name: trimmed } : { name: trimmed, cover: c }),
      );
      if (domain !== editing.domain) v = await unwrap(vx().vaults.move(v.path, domain));
      const app = useApp.getState();
      if (app.openVault === editing.path) useApp.setState({ openVault: v.path });
      await selectInChooser(v);
      close();
    });
  };

  const confirmDelete = () => {
    if (!editing || typed.trim() !== editing.name || busy) return;
    void run(async () => {
      await unwrap(vx().vaults.remove(editing.path, typed.trim()));
      const app = useApp.getState();
      if (app.openVault === editing.path) useApp.setState({ openVault: null });
      await app.refreshVaults();
      close();
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (step.kind !== 'form') setStep({ kind: 'form' });
      else close();
      return;
    }
    if (e.key === 'Tab' && rootRef.current) {
      const els = focusables(rootRef.current);
      const i = els.indexOf(document.activeElement as HTMLElement);
      if (els.length && (e.shiftKey ? i <= 0 : i === els.length - 1)) {
        e.preventDefault();
        els[e.shiftKey ? els.length - 1 : 0]!.focus();
      }
      return;
    }
    if (e.key === 'Enter') {
      const t = e.target as HTMLElement;
      if (t.tagName === 'BUTTON') return; // Buttons handle their own Enter.
      e.preventDefault();
      e.stopPropagation();
      if (step.kind === 'delete') confirmDelete();
      else submit();
    }
  };

  // Live preview: the same card the chooser shows.
  const preview: CardModel = {
    ...(editing ? cardModel(editing) : { id: 'new', meta: chooserStrings.meta(0, null), cover: null }),
    name: trimmed || (editing?.name ?? s.newTitle),
    cover: cover ? { url: cover.url, focus: cover.focus, zoom: cover.zoom } : null,
  };
  const d = domainStrings[domain];

  return (
    <div className="vx-scrim" data-theme="light" onKeyDown={onKeyDown} ref={rootRef}>
      <OrnamentFrame dialog className="vx-dialog" role="dialog" label={editing ? s.editTitle : s.newTitle}>
        <div className="vx-dialog__head">
          <h2 className="vx-dialog__title">{editing ? s.editTitle : s.newTitle}</h2>
          <span className="vx-dialog__domain" style={{ ['--domain' as string]: d.color }}>
            <span className="vx-diamond" />
            {d.name}
          </span>
        </div>

        {step.kind === 'move' && editing && (
          <div className="vx-dialog__confirm" role="alertdialog" aria-label={s.move.title(d.name)}>
            <p>
              <strong>{s.move.title(d.name)}</strong>
            </p>
            <p>{s.move.body(step.impact.notes, step.impact.linkingNotes.length)}</p>
            <div className="vx-dialog__footer">
              <span className="vx-dialog__spacer" />
              <button type="button" className="vx-btn" onClick={() => setStep({ kind: 'form' })}>
                {s.cancel}
              </button>
              <button
                type="button"
                className="vx-btn vx-btn--primary"
                disabled={busy}
                onClick={submit}
                autoFocus
              >
                {s.move.confirm}
              </button>
            </div>
          </div>
        )}

        {step.kind === 'delete' && editing && (
          <div className="vx-dialog__confirm" role="alertdialog" aria-label={s.remove.confirm}>
            <p>{s.remove.body(editing.name)}</p>
            <div className="vx-field">
              <label className="vx-caps" htmlFor="vx-delete-name">
                {s.remove.label}
              </label>
              <input
                id="vx-delete-name"
                className="vx-input vx-input--ui"
                value={typed}
                autoFocus
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
            <div className="vx-dialog__footer">
              <span className="vx-dialog__spacer" />
              <button type="button" className="vx-btn" onClick={() => setStep({ kind: 'form' })}>
                {s.cancel}
              </button>
              <button
                type="button"
                className="vx-btn vx-btn--danger"
                disabled={typed.trim() !== editing.name || busy}
                onClick={confirmDelete}
              >
                <Icon name="trash" size={18} />
                {s.remove.confirm}
              </button>
            </div>
          </div>
        )}

        <div className="vx-dialog__body" hidden={step.kind !== 'form'}>
          <div className="vx-dialog__form">
            <div className="vx-field">
              <label className="vx-caps" htmlFor="vx-vault-name">
                {s.name}
              </label>
              <input
                id="vx-vault-name"
                ref={nameRef}
                className="vx-input"
                type="text"
                maxLength={120}
                value={name}
                aria-invalid={touched && !valid}
                aria-describedby="vx-vault-name-error"
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched(true)}
              />
              {touched && nameError && (
                <p className="vx-dialog__error" id="vx-vault-name-error" role="alert">
                  {nameError}
                </p>
              )}
            </div>

            <div className="vx-field">
              <span className="vx-caps" id="vx-vault-domain">
                {s.domain}
              </span>
              <div role="group" aria-labelledby="vx-vault-domain" className="vx-segmented">
                {DOMAIN_ORDER.map((id) => (
                  <button key={id} type="button" aria-pressed={id === domain} onClick={() => setDomain(id)}>
                    <Icon name={domainStrings[id].icon} />
                    {domainStrings[id].name}
                  </button>
                ))}
              </div>
            </div>

            <div className="vx-field vx-cover-pick">
              <span className="vx-caps">{s.cover}</span>
              <div className="vx-cover-pick__row">
                <button type="button" className="vx-btn" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={18} />
                  {cover ? s.replaceImage : s.chooseImage}
                </button>
                {cover && (
                  <button type="button" className="vx-btn" onClick={() => setCover(null)}>
                    {s.removeImage}
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPT}
                  hidden
                  data-testid="cover-file"
                  onChange={(e) => {
                    void chooseFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
              <p className="vx-dialog__hint">{s.coverHint}</p>
              {cover && (
                <>
                  <span className="vx-caps">{s.focus}</span>
                  <FocusPicker
                    url={cover.url}
                    focus={cover.focus}
                    label={s.focus}
                    onChange={(focus) => setCover((c) => (c ? { ...c, focus } : c))}
                  />
                  <p className="vx-dialog__hint">{s.focusHint}</p>
                  <label className="vx-caps" htmlFor="vx-vault-zoom">
                    {s.zoom}
                  </label>
                  <div className="vx-range-row">
                    <input
                      id="vx-vault-zoom"
                      className="vx-range"
                      type="range"
                      min={100}
                      max={250}
                      step={5}
                      value={Math.round(cover.zoom * 100)}
                      onChange={(e) =>
                        setCover((c) => (c ? { ...c, zoom: Number(e.target.value) / 100 } : c))
                      }
                    />
                    <span className="vx-range-row__value" data-testid="zoom-value">
                      {Math.round(cover.zoom * 100)}%
                    </span>
                  </div>
                </>
              )}
            </div>
            {error && (
              <p className="vx-dialog__error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="vx-dialog__preview">
            <span className="vx-caps">{s.preview}</span>
            <VaultCard card={preview} selected={false} preview />
          </div>
        </div>

        {step.kind === 'form' && (
          <div className="vx-dialog__footer">
            {editing && (
              <button
                type="button"
                className="vx-btn vx-btn--danger"
                onClick={() => setStep({ kind: 'delete' })}
              >
                <Icon name="trash" size={18} />
                {s.delete}
              </button>
            )}
            <span className="vx-dialog__spacer" />
            <button type="button" className="vx-btn" onClick={close}>
              {s.cancel}
            </button>
            <button type="button" className="vx-btn vx-btn--primary" disabled={busy} onClick={submit}>
              {editing ? s.save : s.create}
              <span className="vx-btn__key" aria-hidden="true">
                Enter
              </span>
            </button>
          </div>
        )}
      </OrnamentFrame>
    </div>
  );
}
