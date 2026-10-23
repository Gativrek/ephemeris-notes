/**
 * `vx.index` (SPECS 6) and rename with link updates (SPECS 5): the plan is computed by
 * the index worker, the rename and every rewrite go through the safe file layer.
 */
import type { Domain, RenameResult, SearchScope } from '@shared/bridge';
import { fail, toVxError } from '@shared/result';
import type { IndexClient } from '../index/client';
import { DOMAINS } from '../library/library';
import { normalizeLibraryPath } from '../library/paths';
import { handle, obj, oneOf, str } from './ipc';
import type { SessionManager } from './session';
import { PLUGIN_ID } from '../plugins/manager';

export function scopeArg(v: unknown): SearchScope {
  const o = obj(v, 'scope');
  const kind = oneOf(o.kind, 'scope.kind', ['vault', 'domain', 'all'] as const);
  if (kind === 'vault') return { kind, vaultPath: str(o.vaultPath, 'scope.vaultPath', 1024) };
  if (kind === 'domain') return { kind, domain: oneOf<Domain>(o.domain, 'scope.domain', DOMAINS) };
  return { kind: 'all' };
}

/** Renames `from` to `to`; with `updateLinks`, rewrites the notes that link into it. */
export async function renameWithLinks(
  sessions: SessionManager,
  index: IndexClient,
  fromInput: unknown,
  toInput: unknown,
  updateLinks: boolean,
): Promise<RenameResult> {
  const s = sessions.require();
  const from = normalizeLibraryPath(fromInput);
  const to = normalizeLibraryPath(toInput);
  const plan = updateLinks ? await index.planRename(from, to).catch(() => []) : [];
  const r = await s.fs.rename(from, to);
  const updated: string[] = [];
  const failed: RenameResult['failed'] = [];
  // Each rewrite is atomic; a failure is reported, not rolled back (SPECS 5).
  for (const item of plan) {
    try {
      await s.fs.write(item.newPath, item.text, item.hash);
      updated.push(item.newPath);
    } catch (err) {
      failed.push({ path: item.newPath, message: toVxError(err).message });
    }
  }
  return { path: r.path, updated, failed };
}

export function registerIndexHandlers(deps: { sessions: SessionManager; index: IndexClient }): void {
  const { sessions, index } = deps;
  const need = () => {
    sessions.require();
    return index;
  };
  handle('index', 'search', (_e, q, scope) => need().call('search', str(q, 'query', 2000), scopeArg(scope)));
  handle('index', 'backlinks', (_e, p) => need().call('backlinks', str(p, 'path', 1024)));
  handle('index', 'resolve', (_e, link, from) =>
    need().call('resolve', str(link, 'link', 1024), str(from, 'fromPath', 1024)),
  );
  handle('index', 'outline', (_e, p) => need().call('outline', str(p, 'path', 1024)));
  handle('index', 'notesIn', (_e, scope) => need().call('notesIn', scopeArg(scope)));
  handle('index', 'status', () => index.current);
  handle('index', 'rebuild', () => need().call('rebuild'));
  handle('index', 'ambiguous', () => need().call('ambiguous'));
  handle('index', 'aliases', () => need().call('aliases'));
  // Plugin extractors (SPECS 12.11.2). The spec is plain data; the worker validates it.
  const pluginId = (v: unknown) => {
    const id = str(v, 'pluginId', 64);
    if (!PLUGIN_ID.test(id)) fail('INVALID_ARGUMENT', 'Invalid plugin id.');
    return id;
  };
  handle('index', 'registerExtractor', async (_e, id, spec) => {
    obj(spec, 'spec');
    if (JSON.stringify(spec).length > 8192) fail('INVALID_ARGUMENT', 'The extractor spec is too large.');
    try {
      return await need().call('registerExtractor', pluginId(id), spec);
    } catch (err) {
      fail('INVALID_ARGUMENT', err instanceof Error ? err.message : String(err));
    }
  });
  handle('index', 'unregisterExtractor', (_e, id, ex) =>
    need().call('unregisterExtractor', pluginId(id), str(ex, 'id', 64)),
  );
  handle('index', 'queryRecords', (_e, id, q) => {
    const o = obj(q, 'query');
    return need().call('queryRecords', pluginId(id), {
      ...o,
      ...(o.scope !== undefined ? { scope: scopeArg(o.scope) } : {}),
    });
  });
  handle('index', 'linkImpact', async (_e, paths) => {
    if (!Array.isArray(paths) || paths.length > 1000) fail('INVALID_ARGUMENT', 'paths must be a list.');
    await need().flush();
    return need().call(
      'linkImpact',
      paths.map((p) => normalizeLibraryPath(p)),
    );
  });
}
