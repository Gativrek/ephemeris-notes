/**
 * App-wide state (KICKOFF 5: React state plus a small Zustand store): the open library,
 * its Vaults, which screen shows, and the chooser's Domain and selection.
 */
import { create } from 'zustand';
import type { Domain, LibraryInfo, VaultInfo } from '@shared/bridge';
import { unwrap, vx } from '../lib/vx';
import { DOMAIN_ORDER } from '../strings/domains';

export type Screen = 'chooser' | 'workspace';
export type VaultDialogState = { mode: 'new'; domain: Domain } | { mode: 'edit'; path: string } | null;

interface AppState {
  library: LibraryInfo | null | undefined;
  vaults: VaultInfo[];
  screen: Screen;
  /** The Vault open in the workspace. */
  openVault: string | null;
  domain: Domain;
  /** Selected card index per Domain; the New Vault card is index vaults.length. */
  selection: Record<Domain, number>;
  dialog: VaultDialogState;

  setLibrary(library: LibraryInfo | null): Promise<void>;
  refreshVaults(): Promise<void>;
  setDomain(d: Domain): void;
  cycleDomain(step: 1 | -1): void;
  select(index: number): void;
  openVaultPath(path: string): void;
  showChooser(): void;
  showWorkspace(): void;
  openDialog(d: VaultDialogState): void;
}

export const vaultsIn = (vaults: VaultInfo[], d: Domain) => vaults.filter((v) => v.domain === d);

export const useApp = create<AppState>((set, get) => ({
  library: undefined,
  vaults: [],
  screen: 'chooser',
  openVault: null,
  domain: 'academic',
  selection: { academic: 0, work: 0, personal: 0 },
  dialog: null,

  async setLibrary(library) {
    set({ library, vaults: [], openVault: null, screen: 'chooser', dialog: null });
    if (!library) return;
    await get().refreshVaults();
    const [lastVault, lastDomain, reopen] = await Promise.all([
      unwrap(vx().ui.get('lastVault')).catch(() => null),
      unwrap(vx().ui.get('chooser.domain')).catch(() => null),
      unwrap(vx().settings.get('general.reopenLastVault')).catch(() => null),
    ]);
    if (typeof lastDomain === 'string' && (DOMAIN_ORDER as string[]).includes(lastDomain)) {
      set({ domain: lastDomain as Domain });
    }
    const vaults = get().vaults;
    if (typeof lastVault === 'string') {
      const v = vaults.find((x) => x.path === lastVault);
      if (v) {
        const index = vaultsIn(vaults, v.domain).indexOf(v);
        set((s) => ({ domain: v.domain, selection: { ...s.selection, [v.domain]: index } }));
        if (reopen === true) get().openVaultPath(v.path);
      }
    }
  },

  async refreshVaults() {
    if (!get().library) return;
    const vaults = await unwrap(vx().vaults.list()).catch(() => get().vaults);
    set((s) => {
      // Keep selections within range after Vaults appear or disappear.
      const selection = { ...s.selection };
      for (const d of DOMAIN_ORDER) selection[d] = Math.min(selection[d], vaultsIn(vaults, d).length);
      const openVault = s.openVault && vaults.some((v) => v.path === s.openVault) ? s.openVault : null;
      return { vaults, selection, openVault, screen: openVault ? s.screen : 'chooser' };
    });
  },

  setDomain(d) {
    // DomainTab README: switching Domains resets the selection to the first Vault.
    set((s) => ({ domain: d, selection: { ...s.selection, [d]: 0 } }));
    void vx().ui.set('chooser.domain', d);
  },

  cycleDomain(step) {
    const i = DOMAIN_ORDER.indexOf(get().domain);
    get().setDomain(DOMAIN_ORDER[(i + step + DOMAIN_ORDER.length) % DOMAIN_ORDER.length]!);
  },

  select(index) {
    const { domain, vaults } = get();
    const max = vaultsIn(vaults, domain).length; // New Vault is the last card.
    set((s) => ({ selection: { ...s.selection, [domain]: Math.max(0, Math.min(max, index)) } }));
  },

  openVaultPath(path) {
    set({ openVault: path, screen: 'workspace', dialog: null });
    void vx().ui.set('lastVault', path);
  },

  showChooser() {
    set({ screen: 'chooser' });
  },

  showWorkspace() {
    if (get().openVault) set({ screen: 'workspace' });
  },

  openDialog(dialog) {
    set({ dialog });
  },
}));
