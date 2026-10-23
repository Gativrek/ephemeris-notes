/**
 * Installed plugins (SPECS 12.2): `userData/plugins/<id>/` holding manifest.json,
 * main.js (an ES module), optional styles.css and assets. Manifests are validated and
 * checked against API_VERSION; files are served under `vx-plugin://<id>/`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { API_VERSION } from '@vaults/plugin-api';
import type { PluginInfo, PluginManifestInfo } from '@shared/bridge';
import { fail } from '@shared/result';
import { satisfies } from '@shared/semver';
import { isInside } from '../library/paths';

export const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const REL_FILE = /^(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9._\-/]+$/;

/** Validates manifest.json; returns the manifest or throws a readable reason. */
export function validateManifest(raw: unknown): PluginManifestInfo {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    fail('INVALID_ARGUMENT', 'manifest.json is not an object.');
  const m = raw as Record<string, unknown>;
  const str = (k: string, required = true) => {
    const v = m[k];
    if (v === undefined && !required) return undefined;
    if (typeof v !== 'string' || !v.trim()) fail('INVALID_ARGUMENT', `manifest.json needs a "${k}" string.`);
    return v;
  };
  const id = str('id')!;
  if (!PLUGIN_ID.test(id))
    fail('INVALID_ARGUMENT', `Plugin id "${id}" must match ^[a-z0-9][a-z0-9-]{1,47}$.`);
  const main = str('main')!;
  if (!REL_FILE.test(main) || !main.endsWith('.js'))
    fail('INVALID_ARGUMENT', '"main" must be a .js file inside the plugin folder.');
  const styles = str('styles', false);
  if (styles !== undefined && (!REL_FILE.test(styles) || !styles.endsWith('.css'))) {
    fail('INVALID_ARGUMENT', '"styles" must be a .css file inside the plugin folder.');
  }
  const manifest: PluginManifestInfo = {
    id,
    name: str('name')!,
    version: str('version')!,
    apiVersion: str('apiVersion')!,
    main,
  };
  if (styles) manifest.styles = styles;
  const description = str('description', false);
  if (description) manifest.description = description;
  const author = str('author', false);
  if (author) manifest.author = author;
  return manifest;
}

export class PluginManager {
  constructor(
    readonly dir: string,
    private readonly enabledIds: () => string[],
  ) {}

  private async readOne(folder: string): Promise<PluginInfo | null> {
    let manifest: PluginManifestInfo;
    try {
      manifest = validateManifest(
        JSON.parse(await fs.readFile(path.join(this.dir, folder, 'manifest.json'), 'utf8')),
      );
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return null;
      return {
        manifest: { id: folder, name: folder, version: '?', apiVersion: '?', main: '' },
        enabled: false,
        compatible: false,
        problem: (err as Error).message,
      };
    }
    if (manifest.id !== folder) {
      return {
        manifest,
        enabled: false,
        compatible: false,
        problem: `The folder name "${folder}" does not match the id "${manifest.id}".`,
      };
    }
    const compatible = satisfies(API_VERSION, manifest.apiVersion);
    const enabled = this.enabledIds().includes(manifest.id);
    try {
      await fs.access(path.join(this.dir, folder, ...manifest.main.split('/')));
    } catch {
      return { manifest, enabled, compatible: false, problem: `${manifest.main} is missing.` };
    }
    return compatible
      ? { manifest, enabled, compatible }
      : {
          manifest,
          enabled,
          compatible,
          problem: `Needs plugin API ${manifest.apiVersion}; this app provides ${API_VERSION}.`,
        };
  }

  async list(): Promise<PluginInfo[]> {
    let entries;
    try {
      entries = await fs.readdir(this.dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: PluginInfo[] = [];
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const info = await this.readOne(e.name);
      if (info) out.push(info);
    }
    return out.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }

  /** Copies a plugin folder into the plugins directory (replacing an older copy). */
  async install(source: string): Promise<PluginInfo> {
    const manifest = validateManifest(
      JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8')),
    );
    await fs.access(path.join(source, ...manifest.main.split('/')));
    const target = path.join(this.dir, manifest.id);
    if (isInside(path.resolve(source), target) || isInside(target, path.resolve(source))) {
      fail('INVALID_ARGUMENT', 'Choose the plugin folder itself, outside the app data.');
    }
    await fs.mkdir(this.dir, { recursive: true });
    const staging = `${target}.installing`;
    await fs.rm(staging, { recursive: true, force: true });
    await fs.cp(source, staging, {
      recursive: true,
      filter: (src) => !path.basename(src).startsWith('.') && path.basename(src) !== 'node_modules',
    });
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(staging, target);
    const info = await this.readOne(manifest.id);
    if (!info) fail('IO', 'The installed plugin could not be read back.');
    return info;
  }

  /** Absolute path of a plugin file for `vx-plugin://<id>/<rel>`, or null. */
  async resolveFile(id: string, rel: string): Promise<string | null> {
    if (!PLUGIN_ID.test(id) || !REL_FILE.test(rel)) return null;
    const root = path.join(this.dir, id);
    const abs = path.resolve(root, ...rel.split('/'));
    if (!isInside(root, abs)) return null;
    try {
      const real = await fs.realpath(abs);
      if (!isInside(await fs.realpath(root), real)) return null;
      return real;
    } catch {
      return null;
    }
  }
}
