import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useApp } from '../store/app';
import { BANNER_WINDOW, PlacedImage, useHeaderImage } from './VaultLook';
import type { FileEntry, VaultInfo } from '@shared/bridge';
import { Icon, type IconName } from '../components/Icon';
import { useCatalog } from '../lib/catalog';
import { unwrap, vx } from '../lib/vx';
import { domainStrings } from '../strings/domains';
import { workspaceStrings as s } from '../strings/workspace';
import {
  askDeleteSection,
  baseName,
  createNoteIn,
  moveToUnfiled,
  newUnfiledNote,
  newFolder,
  openPath,
  parentOf,
  renamePath,
  report,
} from './actions';
import { useDocs } from './docs';
import { useWorkspace } from './store';
import {
  buildSections,
  buildTree,
  dailyParts,
  displayName,
  sectionIcon,
  visibleTiles,
  type Listing,
  type Section,
  type TreeNode,
} from './tree';

const DRAG_TYPE = 'application/x-vx-path';

async function listRecursive(root: string, includeFolders: boolean, maxEntries = 5000): Promise<Listing> {
  const listing: Listing = new Map();
  let count = 0;
  const visit = async (dir: string, depth: number) => {
    if (count > maxEntries || depth > 12) return;
    let entries: FileEntry[];
    try {
      entries = await unwrap(vx().fs.list(dir));
    } catch {
      entries = [];
    }
    count += entries.length;
    listing.set(dir, entries);
    if (!includeFolders) return;
    await Promise.all(entries.filter((e) => e.kind === 'folder').map((e) => visit(e.path, depth + 1)));
  };
  await visit(root, 0);
  return listing;
}

function VaultHeader({ vault }: { vault: VaultInfo }) {
  const d = domainStrings[vault.domain];
  const image = useHeaderImage(vault);
  const onContext = async (e: MouseEvent) => {
    e.preventDefault();
    const choice = await unwrap(
      vx().window.contextMenu([
        { id: 'banner', label: s.banner.menuChange },
        { id: 'remove', label: s.banner.menuRemove, enabled: !!vault.banner },
      ]),
    ).catch(() => null);
    if (choice === 'banner') useWorkspace.setState({ overlay: { kind: 'banner' } });
    if (choice === 'remove')
      void unwrap(vx().vaults.setBanner(vault.path, null)).then(
        (info) =>
          useApp.setState((st) => ({ vaults: st.vaults.map((v) => (v.path === info.path ? info : v)) })),
        report,
      );
  };
  return (
    <header
      className="vx-vault-head"
      style={{ ['--domain' as string]: d.color }}
      data-testid="vault-header"
      onContextMenu={(e) => void onContext(e)}
    >
      <span
        className={`vx-vault-head__cover${image ? '' : ' vx-cover-contour'}`}
        data-banner={image?.banner ? 'true' : undefined}
      >
        {image && <PlacedImage url={image.url} focus={image.focus} zoom={image.zoom} win={BANNER_WINDOW} />}
      </span>
      <span className="vx-vault-head__frost" />
      <span className="vx-vault-head__text">
        <span className="vx-vault-head__name vx-gold">{vault.name}</span>
        <span className="vx-vault-head__meta">
          <span className="vx-diamond" aria-hidden="true" />
          {d.name} · {s.sidebar.notes(vault.noteCount)}
        </span>
      </span>
    </header>
  );
}

/** Right-click on a section tile: New, Rename and Delete Section. Unfiled is the Vault
 * root, so it can be neither renamed nor deleted; the daily folder is named in the Vault's
 * settings, so it is not renamed here. */
async function sectionMenu(t: Section): Promise<void> {
  const choice = await unwrap(
    vx().window.contextMenu([
      { id: 'new', label: s.section.menuNew },
      { id: 'unfiled', label: s.section.menuNewUnfiled },
      { id: 'rename', label: s.section.menuRename, enabled: t.kind === 'section', separatorBefore: true },
      { id: 'icon', label: s.section.menuIcon, enabled: t.kind !== 'unfiled' },
      { id: 'reveal', label: s.menu.reveal },
      { id: 'delete', label: s.section.menuDelete, enabled: t.kind !== 'unfiled', separatorBefore: true },
    ]),
  ).catch(() => null);
  if (choice === 'new') useWorkspace.setState({ overlay: { kind: 'sectionName', from: null } });
  else if (choice === 'unfiled') void newUnfiledNote();
  else if (choice === 'rename') useWorkspace.setState({ overlay: { kind: 'sectionName', from: t.path } });
  else if (choice === 'icon')
    useWorkspace.setState({ overlay: { kind: 'sectionIcon', name: t.name, section: t.kind } });
  else if (choice === 'reveal') void vx().shell.revealInFolder(t.path);
  else if (choice === 'delete') askDeleteSection(t.path);
}

function Tiles({
  sections,
  selected,
  domainColor,
  icons,
}: {
  sections: Section[];
  selected: string | null;
  domainColor: string;
  icons: Record<string, string>;
}) {
  const more = useWorkspace((st) => st.moreTiles);
  const { tiles, more: showMore } = visibleTiles(sections, more);
  const ws = useWorkspace.getState;
  const onDrop = (e: DragEvent, target: string) => {
    const from = e.dataTransfer.getData(DRAG_TYPE);
    e.preventDefault();
    if (from && parentOf(from) !== target) void renamePath(from, `${target}/${baseName(from)}`);
  };
  return (
    <div
      className="vx-tiles"
      style={{ ['--domain' as string]: domainColor }}
      role="group"
      aria-label={s.sidebar.sections}
    >
      {tiles.map((t) => (
        <button
          key={t.path}
          type="button"
          className={`vx-tile${t.kind === 'daily' ? ' vx-tile--daily' : ''}`}
          aria-pressed={selected === t.path}
          title={t.name}
          data-testid="section-tile"
          onClick={() => ws().setSection(t.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            void sectionMenu(t);
          }}
          onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
          onDrop={(e) => onDrop(e, t.path)}
        >
          <span className="vx-tile__top">
            <Icon name={sectionIcon(t.name, t.kind, icons[t.name]) as IconName} />
            <span className="vx-tile__count">{t.noteCount}</span>
          </span>
          <span className="vx-tile__name">{t.name}</span>
        </button>
      ))}
      {(showMore || more) && sections.length > 6 && (
        <button
          type="button"
          className="vx-tile vx-tile--more"
          onClick={() => useWorkspace.setState({ moreTiles: !more })}
          aria-expanded={more}
        >
          <span className="vx-tile__top">
            <Icon name={more ? 'chevron-down' : 'plus'} />
            <span className="vx-tile__count">{more ? '' : sections.length - 5}</span>
          </span>
          <span className="vx-tile__name">{more ? s.sidebar.fewer : s.sidebar.more}</span>
        </button>
      )}
    </div>
  );
}

function RenameInput({ path, onDone }: { path: string; onDone: () => void }) {
  const isNote = /\.md$/i.test(path);
  const [value, setValue] = useState(isNote ? displayName(baseName(path)) : baseName(path));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = async () => {
    const name = value.trim();
    onDone();
    if (!name) return;
    const finalName = isNote ? `${name}.md` : name;
    await renamePath(path, `${parentOf(path)}/${finalName}`);
  };
  return (
    <input
      ref={ref}
      className="vx-row__input"
      value={value}
      aria-label="New name"
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') void commit();
        if (e.key === 'Escape') onDone();
      }}
      onBlur={() => void commit()}
    />
  );
}

function Row({
  node,
  active,
  vault,
  onContext,
}: {
  node: TreeNode;
  active: string | null;
  vault: VaultInfo;
  onContext: (n: TreeNode) => void;
}) {
  const expanded = useWorkspace((st) => st.expanded[node.path] ?? node.depth === 0);
  const renaming = useWorkspace((st) => st.renaming === node.path);
  const dirty = useDocs((st) => st.meta[node.path]?.dirty ?? false);
  const [drop, setDrop] = useState(false);
  const ws = useWorkspace.getState;
  const isFolder = node.kind === 'folder';
  const today = new Date().toISOString().slice(0, 10);

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, node.path);
    e.dataTransfer.setData('text/plain', node.path);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = (e: DragEvent) => {
    setDrop(false);
    const from = e.dataTransfer.getData(DRAG_TYPE);
    if (!from || !isFolder) return;
    e.preventDefault();
    if (from === node.path || node.path.startsWith(`${from}/`) || parentOf(from) === node.path) return;
    void renamePath(from, `${node.path}/${baseName(from)}`);
  };

  const activate = () => {
    if (renaming) return;
    if (isFolder) ws().setExpanded(node.path, !expanded);
    else openPath(node.path);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    } else if (e.key === 'F2') {
      e.preventDefault();
      useWorkspace.setState({ renaming: node.path });
    } else if (e.key === 'ArrowRight' && isFolder && !expanded) ws().setExpanded(node.path, true);
    else if (e.key === 'ArrowLeft' && isFolder && expanded) ws().setExpanded(node.path, false);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rows = [...document.querySelectorAll<HTMLElement>('.vx-tree [role="treeitem"]')];
      const i = rows.indexOf(e.currentTarget as HTMLElement);
      rows[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
  };

  const daily = node.kind === 'daily' ? dailyParts(node.name) : null;
  const cls = [
    'vx-row',
    isFolder ? 'vx-row--folder' : '',
    node.kind === 'pdf' ? 'vx-row--pdf' : '',
    drop ? 'is-drop' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <>
      <div
        className={cls}
        role="treeitem"
        tabIndex={0}
        aria-level={node.depth + 1}
        aria-expanded={isFolder ? expanded : undefined}
        aria-current={!isFolder && active === node.path ? 'page' : undefined}
        title={node.path.slice(vault.path.length + 1)}
        data-path={node.path}
        draggable={!renaming}
        onDragStart={onDragStart}
        onDragOver={(e) => {
          if (isFolder && e.dataTransfer.types.includes(DRAG_TYPE)) {
            e.preventDefault();
            setDrop(true);
          }
        }}
        onDragLeave={() => setDrop(false)}
        onDrop={onDrop}
        onClick={activate}
        onKeyDown={onKey}
        onAuxClick={(e) => e.button === 1 && !isFolder && openPath(node.path, { background: true })}
        onContextMenu={(e) => {
          e.preventDefault();
          onContext(node);
        }}
      >
        {isFolder && <Icon name={expanded ? 'chevron-down' : 'chevron-right'} className="vx-row__chev" />}
        {isFolder && (
          <svg className="vx-icon vx-row__folder" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
        )}
        {node.kind === 'note' && <Icon name="note" className="vx-row__doc" />}
        {node.kind === 'pdf' && <span className="vx-pdf">PDF</span>}
        {node.kind === 'attachment' && (
          <span className="vx-ext">{node.name.split('.').pop()?.slice(0, 4)}</span>
        )}
        {daily && (
          <span className={`vx-date${daily.iso === today ? ' is-today' : ''}`} aria-hidden="true">
            <span className="vx-date__day">{daily.day}</span>
          </span>
        )}
        {renaming ? (
          <RenameInput path={node.path} onDone={() => useWorkspace.setState({ renaming: null })} />
        ) : (
          <span className="vx-row__name">
            {daily
              ? daily.weekday
              : node.kind === 'pdf'
                ? displayName(node.name).replace(/\.pdf$/i, '')
                : displayName(node.name)}
          </span>
        )}
        {dirty && (
          <span className="vx-row__meta" aria-label="Edited">
            •
          </span>
        )}
        {isFolder && <span className="vx-row__meta">{node.count}</span>}
        {daily && daily.iso === today && <span className="vx-row__meta">{s.sidebar.today}</span>}
        {node.meta && <span className="vx-row__meta">{node.meta}</span>}
      </div>
      {isFolder && expanded && node.children.length > 0 && (
        <div className="vx-row-group" role="group">
          {node.children.map((c) => (
            <Row key={c.path} node={c} active={active} vault={vault} onContext={onContext} />
          ))}
        </div>
      )}
    </>
  );
}

export function Sidebar({ vault }: { vault: VaultInfo }) {
  const files = useCatalog((st) => st.paths);
  const catalogVersion = useCatalog((st) => st.version);
  const section = useWorkspace((st) => st.section);
  const active = useWorkspace((st) => st.desk.active);
  const sectionsVersion = useWorkspace((st) => st.sectionsVersion);
  const [top, setTop] = useState<{ names: string[]; version: number }>({ names: [], version: -1 });
  const [listing, setListing] = useState<Listing>(new Map());
  const d = domainStrings[vault.domain];

  // Top-level folders (sections), including empty ones.
  useEffect(() => {
    let live = true;
    void unwrap(vx().fs.list(vault.path)).then(
      (entries) =>
        live &&
        setTop({
          names: entries.filter((e) => e.kind === 'folder').map((e) => e.name),
          version: sectionsVersion,
        }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [vault.path, catalogVersion, sectionsVersion]);

  const sections = useMemo(() => buildSections(vault, top.names, files), [vault, top, files]);
  const current = sections.find((x) => x.path === section) ?? sections[0] ?? null;

  // A selection that is not a section falls back to the first one, but only once the list
  // reflects the latest section change (a new section is selected before it is listed).
  useEffect(() => {
    if (top.version !== sectionsVersion) return;
    if (current && current.path !== section) useWorkspace.getState().setSection(current.path);
  }, [current, section, top.version, sectionsVersion]);

  // The tree of the selected section.
  useEffect(() => {
    if (!current) {
      setListing(new Map());
      return;
    }
    let live = true;
    void listRecursive(current.path, current.kind !== 'unfiled').then((l) => live && setListing(l));
    return () => {
      live = false;
    };
  }, [current?.path, current?.kind, catalogVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const tree = useMemo(
    () =>
      current
        ? buildTree(current.path, listing, {
            dailyFolder: `${vault.path}/${vault.settings.daily}`,
            rootFilesOnly: current.kind === 'unfiled',
          })
        : [],
    [current, listing, vault],
  );
  const pdfCount = useMemo(
    () => (current ? files.filter((f) => f.startsWith(`${current.path}/`) && /\.pdf$/i.test(f)).length : 0),
    [files, current],
  );

  const onContext = useCallback(async (node: TreeNode) => {
    const isFolder = node.kind === 'folder';
    const pinned = useWorkspace.getState().desk.pinned.includes(node.path);
    const items = [
      ...(isFolder
        ? [
            { id: 'newNote', label: s.menu.newNote },
            { id: 'template', label: s.menu.newNoteFromTemplate },
            { id: 'newFolder', label: s.menu.newFolder },
          ]
        : [
            { id: pinned ? 'unpin' : 'pin', label: pinned ? s.menu.unpin : s.menu.pin },
            // Only from inside a section: notes at the root are already Unfiled.
            ...(parentOf(node.path) !== useWorkspace.getState().vaultPath
              ? [{ id: 'unfiled', label: s.menu.moveToUnfiled }]
              : []),
          ]),
      { id: 'rename', label: s.menu.rename, separatorBefore: true },
      { id: 'moveTo', label: s.menu.moveTo },
      { id: 'reveal', label: s.menu.reveal },
      { id: 'trash', label: s.menu.delete, separatorBefore: true },
    ];
    const choice = await unwrap(vx().window.contextMenu(items)).catch(() => null);
    const ws = useWorkspace.getState();
    switch (choice) {
      case 'newNote':
        void createNoteIn(node.path, s.untitled).then((p) => p && useWorkspace.setState({ renaming: p }));
        break;
      case 'template':
        useWorkspace.setState({ overlay: { kind: 'templates', folder: node.path } });
        break;
      case 'newFolder':
        void newFolder(node.path);
        break;
      case 'pin':
        ws.openItem(node.path);
        ws.pin(node.path);
        break;
      case 'unpin':
        ws.unpin(node.path);
        break;
      case 'rename':
        useWorkspace.setState({ renaming: node.path });
        break;
      case 'unfiled':
        void moveToUnfiled(node.path);
        break;
      case 'moveTo':
        useWorkspace.setState({ overlay: { kind: 'moveTo', path: node.path } });
        break;
      case 'reveal':
        void vx().shell.revealInFolder(node.path);
        break;
      case 'trash':
        useWorkspace.setState({ overlay: { kind: 'confirmTrash', path: node.path } });
        break;
      default:
        break;
    }
  }, []);

  return (
    <aside
      className="vx-side"
      aria-label="Sidebar"
      data-testid="sidebar"
      style={{ ['--domain' as string]: d.color, ['--domain-soft' as string]: d.soft }}
    >
      <VaultHeader vault={vault} />
      <div className="vx-side__scroll">
        <div className="vx-side__label">
          <span className="vx-caps">{s.sidebar.sections}</span>
          <button
            type="button"
            className="vx-icon-btn vx-icon-btn--small"
            aria-label={s.sidebar.newSection}
            title={s.sidebar.newSection}
            data-testid="new-section"
            onClick={() => useWorkspace.setState({ overlay: { kind: 'sectionName', from: null } })}
          >
            <Icon name="plus" />
          </button>
        </div>
        {sections.length === 0 ? (
          <p className="vx-dialog__hint">{s.sidebar.noSections}</p>
        ) : (
          <Tiles
            sections={sections}
            selected={current?.path ?? null}
            domainColor={d.color}
            icons={vault.sectionIcons}
          />
        )}
        {current && (
          <>
            <div className="vx-tree-head">
              <span className="vx-tree-head__title">{current.name}</span>
              <span className="vx-row__meta">
                {pdfCount > 0 ? s.sidebar.pdfs(pdfCount) : s.sidebar.notes(current.noteCount)}
              </span>
              <button
                type="button"
                className="vx-icon-btn"
                aria-label={s.sidebar.newNote}
                title={s.sidebar.newNote}
                onClick={() =>
                  void createNoteIn(current.path, s.untitled).then(
                    (p) => p && useWorkspace.setState({ renaming: p }),
                  )
                }
              >
                <Icon name="note-new" />
              </button>
              {current.kind !== 'unfiled' && (
                <button
                  type="button"
                  className="vx-icon-btn"
                  aria-label={s.sidebar.newFolder}
                  title={s.sidebar.newFolder}
                  onClick={() => void newFolder(current.path)}
                >
                  <Icon name="folder" />
                </button>
              )}
            </div>
            <div className="vx-tree" role="tree" aria-label={s.sidebar.tree} data-testid="tree">
              {tree.length === 0 && <p className="vx-dialog__hint">{s.sidebar.emptySection}</p>}
              {tree.map((n) => (
                <Row
                  key={n.path}
                  node={n}
                  active={active}
                  vault={vault}
                  onContext={(x) => void onContext(x).catch(report)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

export { DRAG_TYPE };
