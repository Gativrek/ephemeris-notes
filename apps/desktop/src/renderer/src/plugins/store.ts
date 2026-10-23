/**
 * What plugins contributed: commands, help pages, settings fields and panes, open
 * overlays, and each plugin's state. Every entry carries its owner so disabling a
 * plugin removes exactly what it added.
 */
import { create } from 'zustand';
import type {
  HelpPage,
  OutlineEntry,
  OutlineNote,
  OverlayOptions,
  SettingField,
  ViewFactory,
} from '@ephemeris-notes/plugin-api';
import type { PluginInfo } from '@shared/bridge';

export type PluginState = 'disabled' | 'loading' | 'loaded' | 'failed' | 'incompatible';

export interface PluginRuntime {
  info: PluginInfo;
  state: PluginState;
  error?: string;
}

export interface CommandEntry {
  /** `<pluginId>:<id>` for plugins, `core:<id>` for the app. */
  id: string;
  title: string;
  owner: string;
  run(): void | Promise<void>;
}

export interface SettingsEntry {
  key: number;
  owner: string;
  fields: SettingField[];
  pane?: (el: HTMLElement) => void | (() => void);
}

export interface HelpEntry {
  owner: string;
  ownerName: string;
  page: HelpPage;
}

export interface OverlayEntry {
  key: number;
  owner: string;
  opts: OverlayOptions;
  title: string;
  dirty: boolean;
}

export interface OutlineContributor {
  key: number;
  owner: string;
  fn: (note: OutlineNote) => OutlineEntry[];
}

export interface ViewType {
  /** `<plugin>:<type>` */
  id: string;
  owner: string;
  type: string;
  factory: ViewFactory;
}

interface PluginStore {
  plugins: PluginRuntime[];
  commands: CommandEntry[];
  settings: SettingsEntry[];
  help: HelpEntry[];
  overlays: OverlayEntry[];
  values: Record<string, Record<string, unknown>>;
  outline: OutlineContributor[];
  views: ViewType[];
  /** Per desk item (`view:…`): a title set by the view, and its unsaved mark. */
  viewTitles: Record<string, string>;
  viewDirty: Record<string, boolean>;
}

export const usePlugins = create<PluginStore>(() => ({
  plugins: [],
  commands: [],
  settings: [],
  help: [],
  overlays: [],
  values: {},
  outline: [],
  views: [],
  viewTitles: {},
  viewDirty: {},
}));

let nextKey = 1;
export const newKey = () => nextKey++;
