/**
 * Settings > Keyboard (SPECS 11.3): every shortcut, app and editor, built in or set by
 * the user, can be changed, removed or reset. A key another command has is offered as a
 * swap; the editor's fixed keys and the clipboard keys are refused.
 */
import { useEffect, useState } from 'react';
import { editorKeyBindings } from '../../editor/setup';
import {
  checkBinding,
  displayKey,
  eventKey,
  HOTKEYS_KEY,
  isMacPlatform,
  normalizeKey,
  recording,
} from '../../lib/hotkeys';
import {
  assignKey,
  defaultsOf,
  isOverridden,
  keyOwners,
  keysOf,
  removeKeys,
  resetKeys,
  RESERVED,
  SHORTCUTS,
  type Overrides,
} from '../../lib/keymap';
import { useSettings } from '../../lib/settings';
import { usePlugins } from '../../plugins/store';
import { settingsStrings as s } from '../../strings/settings';

interface Row {
  id: string;
  title: string;
  group: string;
  owner: string | null;
}

type Message = { text: string; error: boolean } | { swap: { key: string; from: string; to: string } };

export function KeyboardSection() {
  const commands = usePlugins((st) => st.commands);
  const plugins = usePlugins((st) => st.plugins);
  const overrides = useSettings((st) => st.get<Overrides>(HOTKEYS_KEY)) ?? {};
  const [recordFor, setRecordFor] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const mac = isMacPlatform();

  // Built-in shortcuts in their order, then the other app commands, then plugin commands.
  const builtIn = new Set(SHORTCUTS.map((x) => x.id));
  const titleOf = (id: string) =>
    s.keyboard.titles[id as keyof typeof s.keyboard.titles] ?? commands.find((c) => c.id === id)?.title ?? id;
  const pluginName = (owner: string) =>
    plugins.find((p) => p.info.manifest.id === owner)?.info.manifest.name ?? owner;
  const rows: Row[] = [
    ...SHORTCUTS.map((x) => ({
      id: x.id,
      title: titleOf(x.id),
      group: x.scope === 'editor' ? s.keyboard.groups.editor : s.keyboard.groups.app,
      owner: null,
    })),
    ...commands
      .filter((c) => c.owner === 'core' && !builtIn.has(c.id))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((c) => ({ id: c.id, title: c.title, group: s.keyboard.groups.app, owner: null })),
    ...commands
      .filter((c) => c.owner !== 'core')
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((c) => ({
        id: c.id,
        title: c.title,
        group: s.keyboard.groups.plugins,
        owner: pluginName(c.owner),
      })),
  ];
  const save = (next: Overrides) => void useSettings.getState().set(HOTKEYS_KEY, next);

  useEffect(() => {
    if (!recordFor) return;
    recording.active = true;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecordFor(null);
        return;
      }
      const key = eventKey(e, mac);
      if (!key) return;
      // The editor's fixed keys and the clipboard keys can never be taken.
      const fixed = new Set(RESERVED);
      for (const b of editorKeyBindings(overrides))
        for (const k of [b.key, mac ? b.mac : b.win].filter((x): x is string => !!x))
          fixed.add(normalizeKey(k, mac));
      const check = checkBinding(key, new Map([...fixed].map((k) => [k, s.keyboard.editor])));
      if (!check.ok) {
        setMessage({
          text:
            check.reason === 'modifier'
              ? s.keyboard.needsModifier
              : s.keyboard.taken(displayKey(key, mac), check.by ?? ''),
          error: true,
        });
        return;
      }
      setRecordFor(null);
      const from = keyOwners(overrides).get(key);
      if (from === recordFor && keysOf(recordFor, overrides).length === 1) {
        setMessage(null);
        return;
      }
      if (from && from !== recordFor) {
        setMessage({ swap: { key, from, to: recordFor } });
        return;
      }
      save(assignKey(overrides, recordFor, key));
      setMessage({ text: s.keyboard.saved(displayKey(key, mac), titleOf(recordFor)), error: false });
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      recording.active = false;
      window.removeEventListener('keydown', onKey, true);
    };
    // Re-arm per command; overrides and titles are read fresh on each key.
  }, [recordFor, overrides, commands]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <div className="vx-settings__page" data-testid="settings-keyboard">
      <h2 className="vx-settings__h">{s.sections.keyboard}</h2>
      <p className="vx-settings__hint">{s.keyboard.hint}</p>
      {message && 'swap' in message ? (
        <div className="vx-keyboard__swap" role="alert">
          <p className="vx-settings__hint">
            {s.keyboard.swap(
              displayKey(message.swap.key, mac),
              titleOf(message.swap.from),
              titleOf(message.swap.to),
            )}
          </p>
          <button
            type="button"
            className="vx-btn vx-btn--small vx-btn--primary"
            onClick={() => {
              const { key, to } = message.swap;
              save(assignKey(overrides, to, key));
              setMessage({ text: s.keyboard.saved(displayKey(key, mac), titleOf(to)), error: false });
            }}
          >
            {s.keyboard.useHere}
          </button>
          <button type="button" className="vx-btn vx-btn--small" onClick={() => setMessage(null)}>
            {s.keyboard.keep}
          </button>
        </div>
      ) : message ? (
        <p
          className={message.error ? 'vx-dialog__error' : 'vx-settings__hint'}
          role={message.error ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      ) : null}
      {groups.map((g) => (
        <section key={g} className="vx-settings__group">
          <h3 className="vx-settings__label">{g}</h3>
          <div className="vx-settings__list vx-settings__list--tall">
            {rows
              .filter((r) => r.group === g)
              .map((r) => {
                const keys = keysOf(r.id, overrides);
                const changed = builtIn.has(r.id) && isOverridden(r.id, overrides);
                return (
                  <div key={r.id} className="vx-row vx-keyboard__row" data-testid={`hotkey-${r.id}`}>
                    <span className="vx-row__name">{r.title}</span>
                    {r.owner && <span className="vx-row__meta">{r.owner}</span>}
                    {changed && (
                      <span
                        className="vx-row__meta"
                        title={s.keyboard.defaultWas(
                          defaultsOf(r.id)
                            .map((k) => displayKey(k, mac))
                            .join(', ') || '—',
                        )}
                      >
                        {s.keyboard.changed}
                      </span>
                    )}
                    <span className="vx-keyboard__keys">
                      {recordFor === r.id ? (
                        <span className="vx-chip vx-keyboard__recording">{s.keyboard.press}</span>
                      ) : (
                        keys.map((k) => (
                          <span key={k} className="vx-chip">
                            {displayKey(k, mac)}
                          </span>
                        ))
                      )}
                    </span>
                    {recordFor !== r.id && (
                      <>
                        <button
                          type="button"
                          className="vx-btn vx-btn--small"
                          onClick={() => {
                            setMessage(null);
                            setRecordFor(r.id);
                          }}
                        >
                          {keys.length ? s.keyboard.change : s.keyboard.set}
                        </button>
                        {keys.length > 0 && (
                          <button
                            type="button"
                            className="vx-btn vx-btn--small"
                            onClick={() => {
                              setMessage(null);
                              save(removeKeys(overrides, r.id));
                            }}
                          >
                            {s.keyboard.remove}
                          </button>
                        )}
                        {changed && (
                          <button
                            type="button"
                            className="vx-btn vx-btn--small"
                            onClick={() => {
                              setMessage(null);
                              save(resetKeys(overrides, r.id));
                            }}
                          >
                            {s.keyboard.reset}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
