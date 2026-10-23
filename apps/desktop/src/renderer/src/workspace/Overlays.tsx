import { useEffect, useMemo, useState } from 'react';
import { Confirm, Palette } from '../components/Palette';
import { Icon } from '../components/Icon';
import { useCatalog } from '../lib/catalog';
import { errorMessage, unwrap, vx } from '../lib/vx';
import { usePlugins } from '../plugins/store';
import { workspaceStrings as s } from '../strings/workspace';
import {
  baseName,
  createNoteIn,
  currentVault,
  notice,
  openPath,
  performRename,
  report,
  trashPath,
} from './actions';
import { currentEditor } from './EditorPane';
import { MoveToPicker } from './Inbox';
import { useWorkspace } from './store';
import { displayName } from './tree';

function TemplatePicker({ folder }: { folder: string }) {
  const [templates, setTemplates] = useState<string[] | null>(null);
  const close = () => useWorkspace.setState({ overlay: null });
  useEffect(() => {
    const v = currentVault();
    if (!v) return;
    void unwrap(vx().notes.templates(v.path)).then(setTemplates, (e) => {
      report(e);
      setTemplates([]);
    });
  }, []);
  if (!templates) return null;
  return (
    <Palette
      title={s.picker.templates}
      placeholder={s.picker.filter}
      testId="template-picker"
      empty={s.picker.templatesEmpty}
      items={templates.map((t) => ({
        id: t,
        label: displayName(baseName(t)),
        icon: <Icon name="note" className="vx-row__doc" />,
      }))}
      onClose={close}
      onChoose={(it) => {
        close();
        void createNoteIn(
          folder,
          displayName(baseName(it.id)) === 'Daily' ? s.untitled : s.untitled,
          it.id,
        ).then((p) => p && useWorkspace.setState({ renaming: p }));
      }}
    />
  );
}

/** Inserts `[[link]]` at the cursor; a selection becomes the alias. */
function insertLink(link: string): void {
  const view = currentEditor();
  if (!view || view.state.readOnly) return;
  const sel = view.state.selection.main;
  const text = view.state
    .sliceDoc(sel.from, sel.to)
    .replace(/[\n\]|]/g, ' ')
    .trim();
  const insert = text ? `[[${link}|${text}]]` : `[[${link}]]`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: sel.from + insert.length },
    userEvent: 'input.link',
  });
  view.focus();
}

function CommandPalette() {
  const commands = usePlugins((st) => st.commands);
  const plugins = usePlugins((st) => st.plugins);
  const close = () => useWorkspace.setState({ overlay: null });
  const items = useMemo(
    () =>
      commands.map((c) => ({
        id: c.id,
        label: c.title,
        ...(c.owner === 'core'
          ? {}
          : { detail: plugins.find((p) => p.info.manifest.id === c.owner)?.info.manifest.name ?? c.owner }),
      })),
    [commands, plugins],
  );
  return (
    <Palette
      title={s.commands.title}
      placeholder={s.commands.placeholder}
      testId="command-palette"
      empty={s.commands.empty}
      items={items}
      onClose={close}
      onChoose={(it) => {
        close();
        const cmd = usePlugins.getState().commands.find((c) => c.id === it.id);
        if (!cmd) return;
        // Plugin commands are wrapped (SPECS 12.8): a throw becomes a status message.
        void (async () => {
          try {
            await cmd.run();
          } catch (err) {
            console.error(`[${cmd.owner}] command ${cmd.id} failed`, err);
            notice(s.commands.failed(cmd.title, errorMessage(err)));
          }
        })();
      }}
    />
  );
}

function QuickOpen({ insert = false }: { insert?: boolean }) {
  const paths = useCatalog((st) => st.paths);
  const links = useCatalog((st) => st.links);
  const vault = currentVault();
  const close = () => useWorkspace.setState({ overlay: null });
  const items = useMemo(
    () =>
      paths
        .filter((p) => /\.(md|pdf)$/i.test(p))
        .sort((a, b) => {
          // Notes of the open Vault first.
          const va = vault && a.startsWith(`${vault.path}/`) ? 0 : 1;
          const vb = vault && b.startsWith(`${vault.path}/`) ? 0 : 1;
          return va - vb || a.localeCompare(b);
        })
        .map((p) => ({
          id: p,
          label: links.shortestLink(p),
          detail: p.slice(0, p.lastIndexOf('/')),
          icon: /\.pdf$/i.test(p) ? (
            <span className="vx-pdf">PDF</span>
          ) : (
            <Icon name="note" className="vx-row__doc" />
          ),
        })),
    [paths, links, vault],
  );
  return (
    <Palette
      title={insert ? s.commands.core.insertLink : s.picker.quickOpen}
      placeholder={s.picker.filter}
      testId={insert ? 'insert-link' : 'quick-open'}
      empty={s.picker.quickOpenEmpty}
      items={items}
      onClose={close}
      onChoose={(it) => {
        close();
        if (insert) insertLink(links.shortestLink(it.id));
        else openPath(it.id);
      }}
    />
  );
}

export function Overlays() {
  const overlay = useWorkspace((st) => st.overlay);
  const close = () => useWorkspace.setState({ overlay: null });
  if (!overlay) return null;
  switch (overlay.kind) {
    case 'templates':
      return <TemplatePicker folder={overlay.folder} />;
    case 'quickOpen':
      return <QuickOpen />;
    case 'insertLink':
      return <QuickOpen insert />;
    case 'commands':
      return <CommandPalette />;
    case 'moveTo':
      return <MoveToPicker path={overlay.path} />;
    case 'confirmTrash':
      return (
        <Confirm
          title={s.confirm.trashTitle}
          body={s.confirm.trashBody(displayName(baseName(overlay.path)))}
          confirm={s.confirm.trash}
          cancel={s.confirm.cancel}
          danger
          onClose={close}
          onConfirm={() => {
            close();
            void trashPath(overlay.path);
          }}
        />
      );
    case 'renameLinks': {
      const total = overlay.notes.reduce((n, x) => n + x.links, 0);
      return (
        <div className="vx-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div
            className="vx-palette"
            role="alertdialog"
            aria-label={s.rename.title(total, overlay.notes.length)}
            style={{ width: 560 }}
            data-testid="rename-links"
          >
            <div className="vx-palette__title vx-caps">{s.rename.title(total, overlay.notes.length)}</div>
            <div className="vx-palette__body">{s.rename.body(displayName(baseName(overlay.from)))}</div>
            <div className="vx-palette__list" style={{ maxHeight: 220 }}>
              {overlay.notes.map((n) => (
                <div key={n.path} className="vx-row">
                  <Icon name="note" className="vx-row__doc" />
                  <span className="vx-row__name">{displayName(baseName(n.path))}</span>
                  <span className="vx-row__meta">{n.links}</span>
                </div>
              ))}
            </div>
            <div className="vx-palette__foot">
              <button type="button" className="vx-btn vx-btn--small" onClick={close}>
                {s.rename.cancel}
              </button>
              <button
                type="button"
                className="vx-btn vx-btn--small"
                onClick={() => {
                  close();
                  void performRename(overlay.from, overlay.to, false);
                }}
              >
                {s.rename.skip}
              </button>
              <button
                type="button"
                className="vx-btn vx-btn--small vx-btn--primary"
                autoFocus
                onClick={() => {
                  close();
                  void performRename(overlay.from, overlay.to, true);
                }}
              >
                {s.rename.update}
              </button>
            </div>
          </div>
        </div>
      );
    }
    case 'createMissing': {
      const v = currentVault();
      const where = v ? overlay.folder.slice(v.path.length + 1) || v.name : overlay.folder;
      const name = overlay.target.includes('/')
        ? overlay.target.slice(overlay.target.lastIndexOf('/') + 1)
        : overlay.target;
      return (
        <Confirm
          title={s.confirm.createTitle}
          body={s.confirm.createBody(name, where)}
          confirm={s.confirm.create}
          cancel={s.confirm.cancel}
          onClose={close}
          onConfirm={() => {
            close();
            void createNoteIn(overlay.folder, name);
          }}
        />
      );
    }
    default:
      return null;
  }
}
