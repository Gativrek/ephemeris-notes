import { useEffect, useMemo, useState } from 'react';
import { Confirm, Palette } from '../components/Palette';
import { Icon } from '../components/Icon';
import { useCatalog } from '../lib/catalog';
import { unwrap, vx } from '../lib/vx';
import { workspaceStrings as s } from '../strings/workspace';
import { baseName, createNoteIn, currentVault, openPath, report, trashPath } from './actions';
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

function QuickOpen() {
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
      title={s.picker.quickOpen}
      placeholder={s.picker.filter}
      testId="quick-open"
      empty={s.picker.quickOpenEmpty}
      items={items}
      onClose={close}
      onChoose={(it) => {
        close();
        openPath(it.id);
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
