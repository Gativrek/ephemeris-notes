/**
 * The renderer's copy of the file catalog, for link resolution (SPECS 5) and
 * autocomplete. Refreshed whenever main reports that the file list changed.
 */
import { create } from 'zustand';
import { LinkCatalog } from '@vaults/markdown';
import type { CatalogEntry } from '@shared/bridge';
import { unwrap, vx } from './vx';

interface CatalogState {
  version: number;
  files: CatalogEntry[];
  links: LinkCatalog;
  paths: string[];
  load(): Promise<void>;
}

export const useCatalog = create<CatalogState>((set) => ({
  version: -1,
  files: [],
  links: new LinkCatalog([]),
  paths: [],
  async load() {
    try {
      const { version, files } = await unwrap(vx().library.files());
      const paths = files.map((f) => f.path).sort();
      set({ version, files, paths, links: new LinkCatalog(paths) });
    } catch {
      set({ version: -1, files: [], paths: [], links: new LinkCatalog([]) });
    }
  },
}));

let wired = false;
/** Loads the catalog now and on every change. Call once per app. */
export function wireCatalog(): () => void {
  if (wired) return () => undefined;
  wired = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const reload = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void useCatalog.getState().load(), 60);
  };
  void useCatalog.getState().load();
  const offFiles = vx().library.onFilesChanged(reload);
  const offLib = vx().library.onChanged(reload);
  return () => {
    wired = false;
    offFiles();
    offLib();
  };
}
