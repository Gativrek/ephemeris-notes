/**
 * Settings sections General, Editor, Appearance, Plugins and About (SPECS 11.1).
 * Per-machine values go through `useSettings`; plugin values through the plugin host.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SettingField } from '@vaults/plugin-api';
import { editorKeyBindings } from '../../editor/setup';
import { useCatalog } from '../../lib/catalog';
import {
  CORE_SHORTCUTS,
  HOTKEYS_KEY,
  checkBinding,
  displayKey,
  eventKey,
  isMacPlatform,
  normalizeKey,
  recording,
} from '../../lib/hotkeys';
import { useSettings } from '../../lib/settings';
import { errorMessage } from '../../lib/vx';
import { installPlugin, setPluginEnabled, setPluginSetting } from '../../plugins/host';
import { usePlugins, type PluginRuntime, type SettingsEntry } from '../../plugins/store';
import { settingsStrings as s } from '../../strings/settings';
import { workspaceStrings as ws } from '../../strings/workspace';

export function Item({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <section className="vx-settings__group">
      <div className="vx-settings__item">
        <div>
          <div className="vx-settings__label">{label}</div>
          {hint && <p className="vx-settings__hint">{hint}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

function useSetting<T>(key: string): [T, (v: T) => void] {
  const value = useSettings((st) => st.get<T>(key));
  return [value, (v: T) => void useSettings.getState().set(key, v)];
}

function NumberInput({
  value,
  min,
  max,
  step = 1,
  label,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (!Number.isFinite(n)) return setText(String(value));
    const c = Math.min(max, Math.max(min, Math.round(n / step) * step));
    setText(String(c));
    if (c !== value) onCommit(c);
  };
  return (
    <input
      className="vx-input--small"
      type="number"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={text}
      style={{ width: 96 }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

const DATE_LANGUAGES: Array<[string, string]> = [
  ['en-US', 'English (United States)'],
  ['en-GB', 'English (United Kingdom)'],
  ['pt-BR', 'Português (Brasil)'],
  ['pt-PT', 'Português (Portugal)'],
  ['es-ES', 'Español'],
  ['fr-FR', 'Français'],
  ['de-DE', 'Deutsch'],
  ['it-IT', 'Italiano'],
  ['ja-JP', '日本語'],
];

export function GeneralSection() {
  const [reopen, setReopen] = useSetting<boolean>('general.reopenLastVault');
  const [lang, setLang] = useSetting<string>('general.dateLanguage');
  return (
    <div className="vx-settings__page" data-testid="settings-general">
      <h2 className="vx-settings__h">{s.sections.general}</h2>
      <Item label={s.general.reopen} hint={s.general.reopenHint}>
        <input
          type="checkbox"
          className="vx-switch"
          aria-label={s.general.reopen}
          checked={!!reopen}
          onChange={(e) => setReopen(e.target.checked)}
        />
      </Item>
      <Item label={s.general.dateLanguage} hint={s.general.dateLanguageHint}>
        <select
          className="vx-select"
          aria-label={s.general.dateLanguage}
          value={lang}
          onChange={(e) => setLang(e.target.value)}
        >
          {DATE_LANGUAGES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Item>
    </div>
  );
}

export function EditorSection() {
  const [size, setSize] = useSetting<number>('editor.fontSize');
  const [width, setWidth] = useSetting<number>('editor.lineWidth');
  const [delay, setDelay] = useSetting<number>('editor.autosaveMs');
  const [spell, setSpell] = useSetting<boolean>('editor.spellcheck');
  return (
    <div className="vx-settings__page" data-testid="settings-editor">
      <h2 className="vx-settings__h">{s.sections.editor}</h2>
      <Item label={s.editor.fontSize} hint={s.editor.fontSizeHint}>
        <NumberInput label={s.editor.fontSize} value={size} min={12} max={28} onCommit={setSize} />
      </Item>
      <Item label={s.editor.lineWidth} hint={s.editor.lineWidthHint}>
        <NumberInput
          label={s.editor.lineWidth}
          value={width}
          min={480}
          max={1200}
          step={10}
          onCommit={setWidth}
        />
      </Item>
      <Item label={s.editor.autosave} hint={s.editor.autosaveHint}>
        <NumberInput
          label={s.editor.autosave}
          value={delay}
          min={200}
          max={10000}
          step={100}
          onCommit={setDelay}
        />
      </Item>
      <Item label={s.editor.spellcheck} hint={s.editor.spellcheckHint}>
        <input
          type="checkbox"
          className="vx-switch"
          aria-label={s.editor.spellcheck}
          checked={spell !== false}
          onChange={(e) => setSpell(e.target.checked)}
        />
      </Item>
    </div>
  );
}

export function AppearanceSection() {
  const [theme, setTheme] = useSetting<string>('appearance.theme');
  const [outline, setOutline] = useSetting<string>('appearance.outlineStyle');
  return (
    <div className="vx-settings__page" data-testid="settings-appearance">
      <h2 className="vx-settings__h">{s.sections.appearance}</h2>
      <Item label={s.appearance.theme} hint={s.appearance.themeHint}>
        <div className="vx-segmented vx-segmented--small" role="group" aria-label={s.appearance.theme}>
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={theme === t}
              onClick={() => setTheme(t)}
              style={{ padding: '0 14px' }}
            >
              {s.appearance.themes[t]}
            </button>
          ))}
        </div>
      </Item>
      <Item label={s.appearance.outline} hint={s.appearance.outlineHint}>
        <select
          className="vx-select"
          aria-label={s.appearance.outline}
          value={outline}
          onChange={(e) => setOutline(e.target.value)}
        >
          {Object.entries(ws.outline.styles).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Item>
    </div>
  );
}

// ---- Keyboard -----------------------------------------------------------------------

export function KeyboardSection() {
  const commands = usePlugins((st) => st.commands);
  const plugins = usePlugins((st) => st.plugins);
  const bindings = useSettings((st) => st.get<Record<string, string>>(HOTKEYS_KEY)) ?? {};
  const [recordFor, setRecordFor] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const mac = isMacPlatform();
  const titleOf = (id: string) =>
    id === 'core:palette' ? s.keyboard.palette : (commands.find((c) => c.id === id)?.title ?? id);

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
      // Everything the key could collide with: core shortcuts, editor keys, other hotkeys.
      const taken = new Map<string, string>();
      for (const b of editorKeyBindings())
        for (const k of [b.key, mac ? b.mac : b.win].filter((x): x is string => !!x))
          taken.set(normalizeKey(k, mac), s.keyboard.editor);
      for (const [id, k] of Object.entries(CORE_SHORTCUTS)) taken.set(k, titleOf(id));
      for (const [id, k] of Object.entries(bindings)) if (id !== recordFor) taken.set(k, titleOf(id));
      const check = checkBinding(key, taken);
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
      void useSettings.getState().set(HOTKEYS_KEY, { ...bindings, [recordFor]: key });
      setMessage({ text: s.keyboard.saved(displayKey(key, mac), titleOf(recordFor)), error: false });
      setRecordFor(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      recording.active = false;
      window.removeEventListener('keydown', onKey, true);
    };
    // Re-arm per command; bindings and titles are read fresh on each key.
  }, [recordFor, bindings, commands]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = (id: string) => {
    const { [id]: _gone, ...rest } = bindings;
    void useSettings.getState().set(HOTKEYS_KEY, rest);
  };
  const sorted = [...commands].sort(
    (a, b) => Number(a.owner !== 'core') - Number(b.owner !== 'core') || a.title.localeCompare(b.title),
  );
  return (
    <div className="vx-settings__page" data-testid="settings-keyboard">
      <h2 className="vx-settings__h">{s.sections.keyboard}</h2>
      <p className="vx-settings__hint">{s.keyboard.hint}</p>
      {message && (
        <p
          className={message.error ? 'vx-dialog__error' : 'vx-settings__hint'}
          role={message.error ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
      <div className="vx-settings__list vx-settings__list--tall">
        {sorted.map((c) => {
          const builtIn = CORE_SHORTCUTS[c.id];
          const custom = bindings[c.id];
          const owner =
            c.owner === 'core'
              ? null
              : (plugins.find((p) => p.info.manifest.id === c.owner)?.info.manifest.name ?? c.owner);
          return (
            <div key={c.id} className="vx-row vx-keyboard__row" data-testid={`hotkey-${c.id}`}>
              <span className="vx-row__name">{c.title}</span>
              {owner && <span className="vx-row__meta">{owner}</span>}
              <span className="vx-keyboard__keys">
                {recordFor === c.id ? (
                  <span className="vx-chip vx-keyboard__recording">{s.keyboard.press}</span>
                ) : builtIn ? (
                  <span className="vx-chip" title={s.keyboard.builtIn}>
                    {displayKey(builtIn, mac)}
                  </span>
                ) : custom ? (
                  <span className="vx-chip">{displayKey(custom, mac)}</span>
                ) : null}
              </span>
              {!builtIn && recordFor !== c.id && (
                <button
                  type="button"
                  className="vx-btn vx-btn--small"
                  onClick={() => {
                    setMessage(null);
                    setRecordFor(c.id);
                  }}
                >
                  {custom ? s.keyboard.change : s.keyboard.set}
                </button>
              )}
              {!builtIn && custom && recordFor !== c.id && (
                <button type="button" className="vx-btn vx-btn--small" onClick={() => remove(c.id)}>
                  {s.keyboard.remove}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Plugins ------------------------------------------------------------------------

function FieldControl({ owner, field }: { owner: string; field: SettingField }) {
  const stored = usePlugins((st) => st.values[owner]?.[field.key]);
  const value = stored === undefined ? field.default : stored;
  const files = useCatalog((st) => st.paths);
  const set = (v: unknown) => void setPluginSetting(owner, field.key, v);
  const label = field.label;
  switch (field.type) {
    case 'toggle':
      return (
        <input
          type="checkbox"
          className="vx-switch"
          aria-label={label}
          checked={!!value}
          onChange={(e) => set(e.target.checked)}
        />
      );
    case 'number':
      return (
        <NumberInput
          label={label}
          value={Number(value)}
          min={field.min ?? -1e9}
          max={field.max ?? 1e9}
          {...(field.step ? { step: field.step } : {})}
          onCommit={set}
        />
      );
    case 'select':
      return (
        <select
          className="vx-select"
          aria-label={label}
          value={String(value)}
          onChange={(e) => set(e.target.value)}
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'text':
    case 'file': {
      const listId = field.type === 'file' ? `vx-files-${owner}-${field.key}` : undefined;
      const exts =
        field.type === 'file' ? (field.extensions ?? []).map((e) => e.replace(/^\./, '').toLowerCase()) : [];
      return (
        <>
          <TextInput
            label={label}
            value={String(value ?? '')}
            onCommit={set}
            {...(listId ? { list: listId } : {})}
          />
          {listId && (
            <datalist id={listId}>
              {files
                .filter((p) => !exts.length || exts.includes(p.slice(p.lastIndexOf('.') + 1).toLowerCase()))
                .slice(0, 500)
                .map((p) => (
                  <option key={p} value={p} />
                ))}
            </datalist>
          )}
        </>
      );
    }
  }
}

function TextInput({
  label,
  value,
  onCommit,
  list,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  list?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text !== value && onCommit(text);
  return (
    <input
      className="vx-input--small"
      aria-label={label}
      value={text}
      list={list}
      style={{ width: 220 }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

function Pane({ entry }: { entry: SettingsEntry }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !entry.pane) return;
    let cleanup: void | (() => void);
    try {
      cleanup = entry.pane(el);
    } catch (err) {
      console.error(`[plugin ${entry.owner}] pane failed`, err);
      setFailed(errorMessage(err));
    }
    return () => {
      try {
        if (typeof cleanup === 'function') cleanup();
      } catch {
        // A plugin's cleanup failing must not break Settings.
      }
      el.replaceChildren();
    };
  }, [entry]);
  return (
    <>
      <div ref={ref} className="vx-plugin-pane" data-plugin={entry.owner} />
      {failed && (
        <p className="vx-dialog__error" role="alert">
          {s.plugins.paneFailed} {failed}
        </p>
      )}
    </>
  );
}

function PluginCard({ p }: { p: PluginRuntime }) {
  const m = p.info.manifest;
  const allSettings = usePlugins((st) => st.settings);
  const registered = allSettings.filter((x) => x.owner === m.id);
  const [busy, setBusy] = useState(false);
  // Shown at once; the plugin loads or unloads behind it.
  const [pending, setPending] = useState<boolean | null>(null);
  const toggle = async (on: boolean) => {
    setBusy(true);
    setPending(on);
    try {
      await setPluginEnabled(m.id, on);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };
  return (
    <section className="vx-settings__group" data-testid={`plugin-${m.id}`}>
      <div className="vx-settings__item">
        <div>
          <div className="vx-settings__label">
            {m.name} <span className="vx-settings__hint">{m.version}</span>
          </div>
          {m.description && <p className="vx-settings__hint">{m.description}</p>}
          <p className="vx-settings__hint">
            {s.plugins.states[p.state]}
            {m.author ? ` · ${s.plugins.by(m.author)}` : ''}
          </p>
          {p.error && (p.state === 'failed' || p.state === 'incompatible') && (
            <p className="vx-dialog__error" role="alert">
              {p.error}
            </p>
          )}
        </div>
        <input
          type="checkbox"
          className="vx-switch"
          aria-label={s.plugins.enable(m.name)}
          checked={pending ?? p.info.enabled}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
      </div>
      {p.state === 'loaded' &&
        registered.map((entry) => (
          <div key={entry.key} className="vx-settings__plugin">
            {entry.fields.map((f) => (
              <div key={f.key} className="vx-settings__item">
                <div>
                  <div className="vx-settings__label">{f.label}</div>
                  {'hint' in f && f.hint && <p className="vx-settings__hint">{f.hint}</p>}
                </div>
                <FieldControl owner={m.id} field={f} />
              </div>
            ))}
            {entry.pane && <Pane entry={entry} />}
          </div>
        ))}
    </section>
  );
}

export function PluginsSection() {
  const plugins = usePlugins((st) => st.plugins);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const install = async () => {
    setError(null);
    setMessage(null);
    try {
      const info = await installPlugin();
      if (info) setMessage(s.plugins.installed(info.manifest.name));
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <div className="vx-settings__page" data-testid="settings-plugins">
      <h2 className="vx-settings__h">{s.sections.plugins}</h2>
      <Item label={s.sections.plugins} hint={s.plugins.trust}>
        <button type="button" className="vx-btn vx-btn--small" onClick={() => void install()}>
          {s.plugins.install}
        </button>
      </Item>
      {message && (
        <p className="vx-settings__hint" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="vx-dialog__error" role="alert">
          {error}
        </p>
      )}
      {plugins.length === 0 && <p className="vx-settings__hint">{s.plugins.none}</p>}
      {plugins.map((p) => (
        <PluginCard key={p.info.manifest.id} p={p} />
      ))}
    </div>
  );
}

export function AboutSection() {
  return (
    <div className="vx-settings__page" data-testid="settings-about">
      <h2 className="vx-settings__h">{s.sections.about}</h2>
      <Item label={ws.appName} hint={s.about.tagline}>
        <span className="vx-settings__hint">{s.about.version(__APP_VERSION__)}</span>
      </Item>
      <Item label={s.about.license} hint={s.about.data} />
    </div>
  );
}
