/**
 * Stepping to the previous or next Vault of the open Vault's Domain (SPECS 9.4), in the
 * chooser's order, wrapping at the ends. The move is a slide: the banner turns like a
 * carousel (the next Vault's banner comes in beside the old one), the files and the
 * editor leave towards it, and the new Vault's files arrive from the other side.
 */
import type { VaultInfo } from '@shared/bridge';
import { vx } from '../lib/vx';
import { useApp, vaultsIn, type VaultMotion } from '../store/app';
import { saveAll } from './docs';
import { headerImage } from './VaultLook';

/** Must match the leave and enter animations in bundle.css. */
export const LEAVE_MS = 280;
export const ENTER_MS = 240;

/** The Vaults one step back and forward, or null when the Domain has only this one. */
export function vaultNeighbours(vault: VaultInfo): { prev: VaultInfo; next: VaultInfo } | null {
  const list = vaultsIn(useApp.getState().vaults, vault.domain).filter((v) => !v.broken);
  const i = list.findIndex((v) => v.path === vault.path);
  if (i < 0 || list.length < 2) return null;
  return { prev: list[(i - 1 + list.length) % list.length]!, next: list[(i + 1) % list.length]! };
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Loads an image so the incoming banner never pops in; gives up after `ms`. */
function preload(url: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    const done = () => resolve();
    img.onload = done;
    img.onerror = done;
    img.src = url;
    setTimeout(done, ms);
  });
}

export async function stepVault(dir: 1 | -1): Promise<void> {
  const app = useApp.getState();
  if (app.vaultMotion) return; // One step at a time.
  const vault = app.vaults.find((v) => v.path === app.openVault);
  const near = vault && vaultNeighbours(vault);
  if (!near) return;
  const to = dir > 0 ? near.next : near.prev;
  const index = vaultsIn(app.vaults, to.domain).indexOf(to);
  // One store update, so the new workspace mounts already entering (never leaving).
  const open = (vaultMotion: VaultMotion | null) => {
    useApp.setState((st) => ({
      openVault: to.path,
      screen: 'workspace',
      dialog: null,
      selection: { ...st.selection, [to.domain]: index },
      vaultMotion,
    }));
    void vx().ui.set('lastVault', to.path);
  };
  if (reducedMotion()) {
    await saveAll();
    open(null);
    return;
  }
  const image = headerImage(to);
  if (image) await preload(image.url, 300);
  useApp.setState({ vaultMotion: { phase: 'leave', dir, to: to.path } });
  try {
    await Promise.all([saveAll(), wait(LEAVE_MS)]);
  } finally {
    open({ phase: 'enter', dir, to: to.path });
    setTimeout(() => {
      if (useApp.getState().vaultMotion?.to === to.path) useApp.setState({ vaultMotion: null });
    }, ENTER_MS);
  }
}
