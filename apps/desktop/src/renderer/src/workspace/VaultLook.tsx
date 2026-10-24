/**
 * How a Vault looks from inside: section icons (SPECS 4.4) and the header banner
 * (SPECS 4.3 `banner`). Both are stored in vault.json, so they sync with the notes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { VaultInfo } from '@shared/bridge';
import { Icon, type IconName } from '../components/Icon';
import { Palette } from '../components/Palette';
import { placeCover, useImageSize } from '../features/chooser/cover';
import { FocusPicker } from '../features/vault-dialog/FocusPicker';
import { assetUrl } from '../lib/asset';
import { errorMessage, unwrap, vx } from '../lib/vx';
import { useApp } from '../store/app';
import { workspaceStrings as s } from '../strings/workspace';
import { currentVault, report } from './actions';
import { useWorkspace } from './store';
import { SECTION_ICONS, sectionIcon, type SectionKind } from './tree';

// ---- Section icons ------------------------------------------------------------------

async function saveIcons(vault: VaultInfo, icons: Record<string, string>): Promise<void> {
  const info = await unwrap(vx().vaults.setSectionIcons(vault.path, icons));
  useApp.setState((st) => ({ vaults: st.vaults.map((v) => (v.path === info.path ? info : v)) }));
}

/** Sets (or clears, with null) the icon of the section folder `name`. */
export async function setSectionIcon(name: string, icon: string | null): Promise<void> {
  const v = currentVault();
  if (!v) return;
  const { [name]: _old, ...rest } = v.sectionIcons;
  await saveIcons(v, icon ? { ...rest, [name]: icon } : rest).catch(report);
}

/** A renamed section keeps its icon; a deleted one drops it. */
export async function moveSectionIcon(from: string, to: string | null): Promise<void> {
  const v = currentVault();
  if (!v || !(from in v.sectionIcons)) return;
  const { [from]: icon, ...rest } = v.sectionIcons;
  await saveIcons(v, to ? { ...rest, [to]: icon! } : rest).catch(report);
}

export function SectionIconPicker({ name, kind }: { name: string; kind: SectionKind }) {
  const vault = currentVault();
  const close = () => useWorkspace.setState({ overlay: null });
  const chosen = vault?.sectionIcons[name];
  const items = [
    {
      id: '',
      label: s.sectionIcon.automatic,
      detail: chosen ? undefined : s.sectionIcon.current,
      icon: <Icon name={sectionIcon(name, kind) as IconName} />,
    },
    ...SECTION_ICONS.map((icon) => ({
      id: icon,
      label: s.sectionIcon.names[icon] ?? icon,
      ...(chosen === icon ? { detail: s.sectionIcon.current } : {}),
      icon: <Icon name={icon as IconName} />,
    })),
  ];
  return (
    <Palette
      title={s.sectionIcon.title(name)}
      placeholder={s.sectionIcon.placeholder}
      testId="section-icon"
      keepOrder
      empty={s.sectionIcon.none}
      items={items}
      onClose={close}
      onChoose={(it) => {
        close();
        void setSectionIcon(name, it.id || null);
      }}
    />
  );
}

// ---- Banner -------------------------------------------------------------------------

/** The Vault header's size (sidebar width × header height, design: Workspace README). */
export const BANNER_WINDOW = { width: 304, height: 112 };
const ACCEPT = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';

/** The image behind the Vault header: the banner, or the card cover as before. */
export const useHeaderImage = (vault: VaultInfo) => headerImage(vault);

export function headerImage(vault: VaultInfo): {
  url: string;
  focus: { x: number; y: number };
  zoom: number;
  banner: boolean;
} | null {
  if (vault.banner)
    return {
      url: assetUrl(`${vault.path}/.vault/${vault.banner.file}`, vault.bannerVersion),
      focus: vault.banner.focus,
      zoom: vault.banner.zoom,
      banner: true,
    };
  if (vault.cover)
    return {
      url: assetUrl(`${vault.path}/.vault/${vault.cover.file}`, vault.coverVersion),
      focus: vault.cover.focus,
      zoom: 1,
      banner: false,
    };
  return null;
}

/** An image placed in a window like a cover: scaled to fill, zoomed, focus centred. */
export function PlacedImage({
  url,
  focus,
  zoom,
  win,
  className,
}: {
  url: string;
  focus: { x: number; y: number };
  zoom: number;
  win: { width: number; height: number };
  className?: string;
}) {
  const natural = useImageSize(url);
  if (!natural) return null;
  const p = placeCover(natural, focus, zoom, win);
  return (
    <img
      className={className}
      src={url}
      alt=""
      draggable={false}
      style={{
        position: 'absolute',
        left: p.x,
        top: p.y,
        width: p.width,
        height: p.height,
        maxWidth: 'none',
      }}
    />
  );
}

export function BannerDialog() {
  const vault = currentVault();
  const close = () => useWorkspace.setState({ overlay: null });
  const existing = vault?.banner
    ? assetUrl(`${vault.path}/.vault/${vault.banner.file}`, vault.bannerVersion)
    : null;
  const [image, setImage] = useState<{ url: string; bytes?: ArrayBuffer } | null>(
    existing ? { url: existing } : null,
  );
  const [focus, setFocus] = useState(vault?.banner?.focus ?? { x: 0.5, y: 0.5 });
  const [zoom, setZoom] = useState(vault?.banner?.zoom ?? 1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const blobUrl = useRef<string | null>(null);
  useEffect(() => () => void (blobUrl.current && URL.revokeObjectURL(blobUrl.current)), []);
  const preview = useMemo(
    () => ({ width: BANNER_WINDOW.width * 1.5, height: BANNER_WINDOW.height * 1.5 }),
    [],
  );
  if (!vault) return null;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const bytes = await file.arrayBuffer();
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = URL.createObjectURL(new Blob([bytes], { type: file.type || 'image/png' }));
    setImage({ url: blobUrl.current, bytes });
    setFocus({ x: 0.5, y: 0.5 });
    setZoom(1);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      if (!image) return;
      const info = await unwrap(
        vx().vaults.setBanner(vault.path, { ...(image.bytes ? { bytes: image.bytes } : {}), focus, zoom }),
      );
      useApp.setState((st) => ({ vaults: st.vaults.map((v) => (v.path === info.path ? info : v)) }));
    });
  const remove = () =>
    run(async () => {
      const info = await unwrap(vx().vaults.setBanner(vault.path, null));
      useApp.setState((st) => ({ vaults: st.vaults.map((v) => (v.path === info.path ? info : v)) }));
    });

  return (
    <div className="vx-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="vx-palette vx-banner-dialog"
        role="dialog"
        aria-label={s.banner.title}
        data-testid="banner-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
      >
        <div className="vx-palette__title vx-caps">{s.banner.title}</div>
        <div className="vx-palette__body vx-banner-dialog__body">
          <div className="vx-banner-preview" style={preview} data-testid="banner-preview">
            {image ? (
              <PlacedImage url={image.url} focus={focus} zoom={zoom} win={preview} />
            ) : (
              <span className="vx-banner-preview__empty">{s.banner.empty}</span>
            )}
          </div>
          <div className="vx-banner-dialog__row">
            <button type="button" className="vx-btn vx-btn--small" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={16} />
              {image ? s.banner.replace : s.banner.choose}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              hidden
              data-testid="banner-file"
              onChange={(e) => {
                void choose(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <span className="vx-settings__hint">{s.banner.hint}</span>
          </div>
          {image && (
            <>
              <span className="vx-caps">{s.banner.focus}</span>
              <FocusPicker url={image.url} focus={focus} label={s.banner.focus} onChange={setFocus} />
              <label className="vx-caps" htmlFor="vx-banner-zoom">
                {s.banner.zoom}
              </label>
              <div className="vx-range-row">
                <input
                  id="vx-banner-zoom"
                  className="vx-range"
                  type="range"
                  min={100}
                  max={250}
                  step={5}
                  value={Math.round(zoom * 100)}
                  onChange={(e) => setZoom(Number(e.target.value) / 100)}
                />
                <span className="vx-range-row__value">{Math.round(zoom * 100)}%</span>
              </div>
            </>
          )}
          {error && (
            <p className="vx-dialog__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="vx-palette__foot">
          {vault.banner && (
            <button
              type="button"
              className="vx-btn vx-btn--small vx-btn--danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              {s.banner.remove}
            </button>
          )}
          <span style={{ flex: '1 1 auto' }} />
          <button type="button" className="vx-btn vx-btn--small" onClick={close}>
            {s.confirm.cancel}
          </button>
          <button
            type="button"
            className="vx-btn vx-btn--small vx-btn--primary"
            disabled={busy || !image}
            onClick={() => void save()}
          >
            {s.banner.save}
          </button>
        </div>
      </div>
    </div>
  );
}
