/**
 * Settings (SPECS 11.1): a full-screen panel over the workspace with the sections
 * General, Editor, Math, Appearance, Library, Plugins, Help and About.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { Domain } from '@shared/bridge';
import { Icon } from '../../components/Icon';
import { useCatalog } from '../../lib/catalog';
import { errorMessage, unwrap, vx } from '../../lib/vx';
import { useApp } from '../../store/app';
import { settingsStrings as s } from '../../strings/settings';
import { openPath } from '../../workspace/actions';
import { useIndexStatus } from '../../workspace/SearchBox';
import { HelpSection } from './HelpSection';
import { MathSection } from './MathSection';
import { AboutSection, AppearanceSection, EditorSection, GeneralSection, PluginsSection } from './sections';

export type SettingsSection = keyof typeof s.sections;

export const SECTION_ORDER: SettingsSection[] = [
  'general',
  'editor',
  'math',
  'appearance',
  'library',
  'plugins',
  'help',
  'about',
];

function Group({
  title,
  hint,
  children,
  action,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="vx-settings__group">
      <div className="vx-settings__item">
        <div>
          <div className="vx-settings__label">{title}</div>
          {hint && <p className="vx-settings__hint">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function LibrarySection() {
  const library = useApp((st) => st.library);
  const status = useIndexStatus();
  const paths = useCatalog((st) => st.paths);
  const [ambiguous, setAmbiguous] = useState<Array<{
    src: string;
    target: string;
    line: number;
    candidates: string[];
  }> | null>(null);
  const [nonVault, setNonVault] = useState<Array<{ path: string; domain: Domain }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNonVault = () => void unwrap(vx().vaults.nonVaultFolders()).then(setNonVault, () => undefined);
  useEffect(loadNonVault, []);

  const outside = [
    ...new Set(
      paths
        .filter((p) => p.includes('/') && !/^(Academic|Work|Personal|Inbox)\//.test(p))
        .map((p) => p.slice(0, p.indexOf('/'))),
    ),
  ].sort();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vx-settings__page" data-testid="settings-library">
      <h2 className="vx-settings__h">{s.sections.library}</h2>
      <Group title={s.library.location} hint={library?.root} />
      <Group
        title={s.library.index}
        hint={
          status.state === 'indexing' ? `Indexing… ${status.done} of ${status.total}` : s.library.indexHint
        }
        action={
          <button
            type="button"
            className="vx-btn vx-btn--small"
            disabled={busy}
            onClick={() => void run(async () => void (await unwrap(vx().index.rebuild())))}
          >
            {busy ? s.library.rebuilding : s.library.rebuild}
          </button>
        }
      />
      <Group
        title={s.library.ambiguous}
        hint={s.library.ambiguousHint}
        action={
          <button
            type="button"
            className="vx-btn vx-btn--small"
            onClick={() => void run(async () => setAmbiguous(await unwrap(vx().index.ambiguous())))}
          >
            {s.library.find}
          </button>
        }
      >
        {ambiguous && (
          <div className="vx-settings__list" data-testid="ambiguous-list">
            {ambiguous.length === 0 && <div className="vx-row">{s.library.noneAmbiguous}</div>}
            {ambiguous.map((a, i) => (
              <div
                key={i}
                className="vx-row"
                style={{ cursor: 'pointer' }}
                title={a.candidates.join('\n')}
                onClick={() => openPath(a.src, { line: a.line })}
              >
                <Icon name="note" className="vx-row__doc" />
                <span className="vx-row__name">
                  [[{a.target}]] in {a.src.replace(/\.md$/i, '')}
                </span>
                <span className="vx-row__meta">{s.library.candidates(a.candidates.length)}</span>
              </div>
            ))}
          </div>
        )}
      </Group>
      <Group title={s.library.nonVault} hint={s.library.nonVaultHint}>
        <div className="vx-settings__list">
          {nonVault.length === 0 && <div className="vx-row">{s.library.none}</div>}
          {nonVault.map((f) => (
            <div key={f.path} className="vx-row">
              <Icon name="folder" className="vx-row__doc" />
              <span className="vx-row__name">{f.path}</span>
              <button
                type="button"
                className="vx-btn vx-btn--small"
                onClick={() =>
                  void run(async () => {
                    await unwrap(vx().vaults.makeVault(f.path));
                    loadNonVault();
                  })
                }
              >
                {s.library.makeVault}
              </button>
            </div>
          ))}
        </div>
      </Group>
      <Group title={s.library.outside} hint={s.library.outsideHint}>
        <div className="vx-settings__list">
          {outside.length === 0 && <div className="vx-row">{s.library.none}</div>}
          {outside.map((f) => (
            <div key={f} className="vx-row">
              <Icon name="folder" className="vx-row__doc" />
              <span className="vx-row__name">{f}</span>
            </div>
          ))}
        </div>
      </Group>
      {error && (
        <p className="vx-dialog__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Settings({
  onClose,
  initial = 'general',
  helpPage = null,
}: {
  onClose: () => void;
  initial?: SettingsSection;
  helpPage?: string | null;
}) {
  const [section, setSection] = useState<SettingsSection>(initial);
  const [page, setPage] = useState<string | null>(helpPage);
  useEffect(() => setSection(initial), [initial]);
  useEffect(() => setPage(helpPage), [helpPage]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="vx-settings" role="dialog" aria-label={s.title} data-testid="settings">
      <nav className="vx-settings__nav" aria-label={s.title}>
        <h1 className="vx-settings__title">{s.title}</h1>
        {SECTION_ORDER.map((k) => (
          <div
            key={k}
            className="vx-row"
            role="link"
            tabIndex={0}
            aria-current={section === k ? 'page' : undefined}
            onClick={() => setSection(k)}
            onKeyDown={(e) => e.key === 'Enter' && setSection(k)}
          >
            <span className="vx-row__name">{s.sections[k]}</span>
          </div>
        ))}
      </nav>
      <div className="vx-settings__body" style={{ position: 'relative' }}>
        <button
          type="button"
          className="vx-icon-btn vx-settings__close"
          aria-label={s.close}
          title={s.close}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
        {section === 'general' && <GeneralSection />}
        {section === 'editor' && <EditorSection />}
        {section === 'math' && <MathSection />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'library' && <LibrarySection />}
        {section === 'plugins' && <PluginsSection />}
        {section === 'help' && <HelpSection page={page} onPage={setPage} />}
        {section === 'about' && <AboutSection />}
      </div>
    </div>
  );
}
