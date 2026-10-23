/**
 * Workspace state for the open Vault: the selected section, expanded folders, the desk
 * (SPECS 9.5) and panel visibility. Desk and pins persist per Vault, per machine.
 */
import { create } from 'zustand';
import { unwrap, vx } from '../lib/vx';

export const MAX_OPEN = 12;

export interface Desk {
  open: string[];
  pinned: string[];
  active: string | null;
  /** Most recently used first, for closing the oldest unpinned item at 13. */
  recent: string[];
}

export type Overlay =
  | { kind: 'templates'; folder: string }
  | { kind: 'quickOpen' }
  | { kind: 'insertLink' }
  | { kind: 'commands' }
  | { kind: 'moveTo'; path: string }
  | { kind: 'confirmTrash'; path: string }
  | { kind: 'createMissing'; target: string; folder: string }
  | { kind: 'renameLinks'; from: string; to: string; notes: Array<{ path: string; links: number }> }
  | null;

interface WorkspaceState {
  vaultPath: string | null;
  vaultId: string | null;
  section: string | null;
  moreTiles: boolean;
  expanded: Record<string, boolean>;
  desk: Desk;
  sidebar: boolean;
  /** The sidebar area shows the Inbox instead of the Vault (SPECS 4.6). */
  inbox: boolean;
  outline: boolean;
  source: boolean;
  renaming: string | null;
  overlay: Overlay;
  /** Saved state of plugin views on the desk (SPECS 12.11.4), per machine. */
  viewStates: Record<string, unknown>;
  setViewState(id: string, state: unknown): void;
  /** Pending jump inside the active note (heading, block or line). */
  jump: { path: string; heading?: string | null; block?: string | null; line?: number; page?: number } | null;

  init(vaultPath: string, vaultId: string): Promise<void>;
  setSection(path: string | null): void;
  toggleFolder(path: string): void;
  setExpanded(path: string, open: boolean): void;
  activate(path: string): void;
  openItem(path: string, opts?: { background?: boolean }): void;
  closeItem(path: string): void;
  pin(path: string): void;
  unpin(path: string): void;
  clearUnpinned(): void;
  renamePath(from: string, to: string): void;
  removePath(path: string): void;
  setPanels(p: Partial<Pick<WorkspaceState, 'sidebar' | 'outline' | 'source'>>): void;
}

const emptyDesk = (): Desk => ({ open: [], pinned: [], active: null, recent: [] });

function persist(s: WorkspaceState): void {
  if (!s.vaultId) return;
  void vx().ui.set(`desk.${s.vaultId}`, { open: s.desk.open, pinned: s.desk.pinned, active: s.desk.active });
  void vx().ui.set(`workspace.${s.vaultId}`, {
    section: s.section,
    expanded: s.expanded,
    sidebar: s.sidebar,
    outline: s.outline,
  });
}

const remap = (p: string, from: string, to: string) =>
  p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p;
const under = (p: string, root: string) => p === root || p.startsWith(`${root}/`);

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  vaultPath: null,
  vaultId: null,
  section: null,
  moreTiles: false,
  expanded: {},
  desk: emptyDesk(),
  sidebar: true,
  inbox: false,
  outline: typeof window !== 'undefined' ? window.innerWidth >= 1440 : true,
  source: false,
  renaming: null,
  overlay: null,
  jump: null,
  viewStates: {},

  async init(vaultPath, vaultId) {
    set({
      vaultPath,
      vaultId,
      section: null,
      expanded: {},
      desk: emptyDesk(),
      renaming: null,
      overlay: null,
      jump: null,
      moreTiles: false,
      inbox: false,
    });
    const [desk, ws, views] = await Promise.all([
      unwrap(vx().ui.get(`desk.${vaultId}`)).catch(() => null),
      unwrap(vx().ui.get(`workspace.${vaultId}`)).catch(() => null),
      unwrap(vx().ui.get(`views.${vaultId}`)).catch(() => null),
    ]);
    if (get().vaultId !== vaultId) return;
    const d = desk as Partial<Desk> | null;
    const w = ws as {
      section?: string | null;
      expanded?: Record<string, boolean>;
      sidebar?: boolean;
      outline?: boolean;
    } | null;
    // Plugin views (`view:…`) live on the desk next to the Vault's notes.
    const inVault = (p: unknown): p is string =>
      typeof p === 'string' && (under(p, vaultPath) || p.startsWith('view:'));
    const open = Array.isArray(d?.open) ? d.open.filter(inVault).slice(0, MAX_OPEN) : [];
    const pinned = Array.isArray(d?.pinned) ? d.pinned.filter(inVault) : [];
    const active =
      inVault(d?.active) && (open.includes(d.active) || pinned.includes(d.active))
        ? d.active
        : (open[0] ?? null);
    set({
      viewStates: views && typeof views === 'object' ? (views as Record<string, unknown>) : {},
      desk: { open, pinned, active, recent: active ? [active] : [] },
      section: w && (w.section === null || inVault(w.section)) ? (w.section ?? null) : null,
      expanded: w?.expanded ?? {},
      sidebar: w?.sidebar ?? true,
      outline: w?.outline ?? window.innerWidth >= 1440,
    });
  },

  setViewState(id, state) {
    const viewStates = { ...get().viewStates, [id]: state };
    set({ viewStates });
    const vaultId = get().vaultId;
    if (vaultId) void vx().ui.set(`views.${vaultId}`, viewStates);
  },

  setSection(path) {
    set({ section: path, moreTiles: get().moreTiles });
    persist(get());
  },

  setExpanded(path, open) {
    set((s) => ({ expanded: { ...s.expanded, [path]: open } }));
    persist(get());
  },

  toggleFolder(path) {
    set((s) => ({ expanded: { ...s.expanded, [path]: !s.expanded[path] } }));
    persist(get());
  },

  activate(path) {
    set((s) => ({
      desk: { ...s.desk, active: path, recent: [path, ...s.desk.recent.filter((p) => p !== path)] },
    }));
    persist(get());
  },

  openItem(path, opts) {
    set((s) => {
      const desk = { ...s.desk };
      if (!desk.open.includes(path) && !desk.pinned.includes(path)) {
        desk.open = [...desk.open, path];
        // At most 12 open items: the least recently used unpinned item makes room.
        while (desk.open.length > MAX_OPEN) {
          const victim = [...desk.open]
            .sort((a, b) => {
              const ra = desk.recent.indexOf(a);
              const rb = desk.recent.indexOf(b);
              return (rb < 0 ? Infinity : rb) - (ra < 0 ? Infinity : ra);
            })
            .find((p) => p !== path && p !== desk.active);
          if (!victim) break;
          desk.open = desk.open.filter((p) => p !== victim);
          desk.recent = desk.recent.filter((p) => p !== victim);
        }
      }
      if (!opts?.background) {
        desk.active = path;
        desk.recent = [path, ...desk.recent.filter((p) => p !== path)];
      } else if (!desk.recent.includes(path)) desk.recent = [...desk.recent, path];
      return { desk };
    });
    persist(get());
  },

  closeItem(path) {
    set((s) => {
      if (!s.desk.open.includes(path)) return s;
      const open = s.desk.open.filter((p) => p !== path);
      const recent = s.desk.recent.filter((p) => p !== path);
      let active = s.desk.active;
      if (active === path)
        active =
          recent.find((p) => open.includes(p) || s.desk.pinned.includes(p)) ?? open[open.length - 1] ?? null;
      return { desk: { ...s.desk, open, recent, active } };
    });
    persist(get());
  },

  pin(path) {
    set((s) => ({
      desk: {
        ...s.desk,
        open: s.desk.open.filter((p) => p !== path),
        pinned: s.desk.pinned.includes(path) ? s.desk.pinned : [...s.desk.pinned, path],
      },
    }));
    persist(get());
  },

  unpin(path) {
    set((s) => ({
      desk: {
        ...s.desk,
        pinned: s.desk.pinned.filter((p) => p !== path),
        open: s.desk.open.includes(path) ? s.desk.open : [...s.desk.open, path],
      },
    }));
    persist(get());
  },

  clearUnpinned() {
    set((s) => {
      const active =
        s.desk.active && s.desk.pinned.includes(s.desk.active) ? s.desk.active : (s.desk.pinned[0] ?? null);
      return {
        desk: { ...s.desk, open: [], active, recent: s.desk.recent.filter((p) => s.desk.pinned.includes(p)) },
      };
    });
    persist(get());
  },

  renamePath(from, to) {
    set((s) => ({
      desk: {
        open: s.desk.open.map((p) => remap(p, from, to)),
        pinned: s.desk.pinned.map((p) => remap(p, from, to)),
        active: s.desk.active ? remap(s.desk.active, from, to) : null,
        recent: s.desk.recent.map((p) => remap(p, from, to)),
      },
      section: s.section ? remap(s.section, from, to) : null,
      expanded: Object.fromEntries(Object.entries(s.expanded).map(([k, v]) => [remap(k, from, to), v])),
    }));
    persist(get());
  },

  removePath(path) {
    set((s) => {
      const keep = (p: string) => !under(p, path);
      const open = s.desk.open.filter(keep);
      const pinned = s.desk.pinned.filter(keep);
      const recent = s.desk.recent.filter(keep);
      const active =
        s.desk.active && keep(s.desk.active)
          ? s.desk.active
          : (recent.find((p) => open.includes(p) || pinned.includes(p)) ?? null);
      return {
        desk: { open, pinned, recent, active },
        section: s.section && keep(s.section) ? s.section : null,
      };
    });
    persist(get());
  },

  setPanels(p) {
    set(p);
    persist(get());
  },
}));
