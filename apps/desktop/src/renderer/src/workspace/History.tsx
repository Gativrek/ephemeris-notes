/**
 * The Git timeline (SPECS 4.12): a note's versions on the desk, beside the note. The list of
 * versions on the left; the selected one's changes on the right, against the note as it is
 * now or against the version before it. Restoring writes a version as an ordinary,
 * undoable edit; git is only read.
 */
import { countChanges, diffLines, rows, splitLines, type Row, type WordPart } from '@ephemeris-notes/diff';
import type { GitHistory, GitHistoryEntry } from '@shared/bridge';
import { useEffect, useMemo, useState } from 'react';
import { Confirm } from '../components/Palette';
import { errorMessage, unwrap, vx } from '../lib/vx';
import { workspaceStrings as s } from '../strings/workspace';
import { getRecord, openDoc, replaceOpenDoc, saveDoc } from './docs';
import { useWorkspace } from './store';
import { displayName } from './tree';

export const HISTORY_PREFIX = 'history:';
export const isHistoryId = (id: string | null | undefined): boolean => !!id && id.startsWith(HISTORY_PREFIX);
export const historyId = (path: string) => `${HISTORY_PREFIX}${path}`;
export const historyNote = (id: string) => id.slice(HISTORY_PREFIX.length);
export const historyTitle = (id: string) =>
  s.history.title(displayName(historyNote(id).slice(historyNote(id).lastIndexOf('/') + 1)));

/** Opens a note's history on the desk (Show Note History). */
export function openHistory(path: string): void {
  useWorkspace.getState().openItem(historyId(path));
}

const MAX_LINES = 20_000;
const UNCOMMITTED = 'uncommitted';

function when(at: number, now = Date.now()): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return s.history.ago.now;
  if (min < 60) return s.history.ago.minutes(min);
  if (min < 24 * 60) return s.history.ago.hours(Math.floor(min / 60));
  if (min < 7 * 24 * 60) return s.history.ago.days(Math.floor(min / (24 * 60)));
  return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
const exactly = (at: number) =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The note's text now: the open editor's (saved or not), else the file's; null when it is gone. */
async function currentText(path: string): Promise<string | null> {
  const rec = getRecord(path);
  if (rec) return rec.state.doc.toString();
  return unwrap(vx().fs.read(path)).then(
    (f) => f.text,
    () => null,
  );
}

export function HistoryPane({ id }: { id: string }) {
  const path = historyNote(id);
  const [history, setHistory] = useState<GitHistory | { error: string } | null>(null);
  const [now, setNow] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'now' | 'commit'>('now');
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const [generation, setGeneration] = useState(0);

  // The history and the note's text, read again after a restore.
  useEffect(() => {
    let live = true;
    void (async () => {
      const [h, text] = await Promise.all([
        unwrap(vx().library.gitHistory(path)).catch((err: unknown) => ({ error: errorMessage(err) })),
        currentText(path),
      ]);
      if (!live) return;
      setHistory(h);
      setNow(text);
      if ('available' in h && h.available)
        setSelected((sel) => sel ?? (h.uncommitted ? UNCOMMITTED : (h.entries[0]?.commit ?? null)));
    })();
    return () => {
      live = false;
    };
  }, [path, generation]);

  const entries = useMemo(
    () => (history && 'available' in history && history.available ? history.entries : []),
    [history],
  );
  const index = entries.findIndex((e) => e.commit === selected);
  const entry = index === -1 ? null : entries[index]!;
  const parent = index === -1 ? null : (entries[index + 1] ?? null);

  // The versions the comparison needs, read once each.
  useEffect(() => {
    const need: GitHistoryEntry[] = [];
    if (selected === UNCOMMITTED && entries[0]) need.push(entries[0]);
    if (entry) need.push(entry);
    if (entry && mode === 'commit' && parent) need.push(parent);
    let live = true;
    for (const e of need) {
      if (texts[e.commit] !== undefined) continue;
      void unwrap(vx().library.gitVersion(e.commit, e.path)).then(
        (v) => live && setTexts((t) => ({ ...t, [e.commit]: v?.text ?? '' })),
        () => live && setTexts((t) => ({ ...t, [e.commit]: '' })),
      );
    }
    return () => {
      live = false;
    };
  }, [selected, mode, entry, parent, entries, texts]);

  // What is compared: [before, after, legend].
  const pair = useMemo((): [string, string, string] | null => {
    if (selected === UNCOMMITTED) {
      const last = entries[0] ? texts[entries[0].commit] : '';
      return last === undefined || now === null ? null : [last, now, s.history.legendUncommitted];
    }
    if (!entry) return null;
    const version = texts[entry.commit];
    if (version === undefined) return null;
    if (mode === 'now') return [now ?? '', version, s.history.legendNow];
    const before = parent ? texts[parent.commit] : '';
    return before === undefined ? null : [before, version, s.history.legendCommit];
  }, [selected, entry, parent, mode, texts, now, entries]);

  const restore = async () => {
    setConfirming(false);
    if (!entry) return;
    const text = texts[entry.commit];
    if (text === undefined) return;
    try {
      if (now === null) {
        await unwrap(vx().fs.create(path, text));
      } else {
        // Through the note's editor: one undoable edit, then the normal save.
        await openDoc(path);
        replaceOpenDoc(path, text, 'history.restore');
        await saveDoc(path);
      }
      useWorkspace.getState().openItem(path, { background: true });
      setMessage(s.history.restored(exactly(entry.at)));
      setGeneration((g) => g + 1);
    } catch (err) {
      setMessage(s.history.restoreFailed(errorMessage(err)));
    }
  };

  if (!history) return <div className="vx-history vx-history--message">{s.history.loading}</div>;
  if ('error' in history)
    return <div className="vx-history vx-history--message">{s.history.failed(history.error)}</div>;
  if (!history.available)
    return (
      <div className="vx-history vx-history--message" data-testid="history-unavailable">
        {history.reason === 'noGit' ? s.history.noGit : s.history.notRepository}
      </div>
    );

  return (
    <div className="vx-history" data-testid="history">
      <nav className="vx-history__list" aria-label={s.history.versions}>
        <div className="vx-history__list-title vx-caps">{s.history.versions}</div>
        {history.uncommitted && (
          <button
            type="button"
            className="vx-history__version"
            aria-pressed={selected === UNCOMMITTED}
            onClick={() => setSelected(UNCOMMITTED)}
            data-testid="history-version"
          >
            <span className="vx-history__when">{s.history.uncommitted}</span>
            <span className="vx-history__subject">{s.history.uncommittedHint}</span>
          </button>
        )}
        {entries.map((e) => (
          <button
            key={e.commit}
            type="button"
            className="vx-history__version"
            aria-pressed={selected === e.commit}
            title={`${exactly(e.at)} · ${e.author} · ${e.commit.slice(0, 10)}`}
            onClick={() => setSelected(e.commit)}
            data-testid="history-version"
          >
            <span className="vx-history__when">{when(e.at)}</span>
            <span className="vx-history__subject">{e.subject}</span>
            <span
              className="vx-history__counts"
              aria-label={`${e.added} ${s.history.added}, ${e.removed} ${s.history.removed}`}
            >
              {s.history.changes(e.added, e.removed)}
            </span>
          </button>
        ))}
        {!entries.length && !history.uncommitted && <p className="vx-history__empty">{s.history.none}</p>}
      </nav>
      <section className="vx-history__main" aria-label={entry ? exactly(entry.at) : s.history.uncommitted}>
        {now === null && <p className="vx-history__note">{s.history.gone}</p>}
        {entry && (
          <div className="vx-history__bar">
            <div className="vx-segmented vx-segmented--small" role="group" aria-label={s.history.compareNow}>
              {(['now', 'commit'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {m === 'now' ? s.history.compareNow : s.history.compareCommit}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="vx-btn vx-btn--small vx-btn--primary"
              disabled={texts[entry.commit] === undefined}
              onClick={() => setConfirming(true)}
            >
              {s.history.restore}
            </button>
          </div>
        )}
        {message && (
          <p className="vx-history__note" role="status">
            {message}
          </p>
        )}
        {pair && (
          <Changes
            before={pair[0]}
            after={pair[1]}
            legend={pair[2]}
            same={selected !== UNCOMMITTED && mode === 'now'}
          />
        )}
      </section>
      {confirming && entry && (
        <Confirm
          title={s.history.restoreTitle}
          body={s.history.restoreBody(exactly(entry.at))}
          confirm={s.history.restore}
          cancel={s.confirm.cancel}
          onClose={() => setConfirming(false)}
          onConfirm={() => void restore()}
        />
      )}
    </div>
  );
}

function Changes({
  before,
  after,
  legend,
  same,
}: {
  before: string;
  after: string;
  legend: string;
  same: boolean;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const result = useMemo(() => {
    if (splitLines(before).length > MAX_LINES || splitLines(after).length > MAX_LINES) return null;
    const ops = diffLines(before, after);
    return { rows: rows(ops), ...countChanges(ops) };
  }, [before, after]);
  if (!result) return <p className="vx-history__note">{s.history.tooLong}</p>;
  if (!result.added && !result.removed)
    return <p className="vx-history__note">{same ? s.history.same : s.history.noChange}</p>;
  // A folded run opens in place when clicked.
  const old = splitLines(before);
  const shown: Array<{ key: string; row: Row; fold?: number }> = [];
  for (const [k, r] of result.rows.entries()) {
    if (r.kind === 'fold' && open.has(k))
      for (let j = 0; j < r.count; j++)
        shown.push({
          key: `${k}.${j}`,
          row: {
            kind: 'equal',
            text: old[r.oldLine - 1 + j] ?? '',
            oldLine: r.oldLine + j,
            newLine: r.newLine + j,
          },
        });
    else shown.push({ key: String(k), row: r, fold: k });
  }
  return (
    <div className="vx-history__changes">
      <p className="vx-history__legend">{legend}</p>
      <div className="vx-history__diff" data-testid="history-diff">
        {shown.map(({ key, row, fold }) =>
          row.kind === 'fold' ? (
            <button
              key={key}
              type="button"
              className="vx-history__fold"
              onClick={() => setOpen((o) => new Set(o).add(fold!))}
            >
              {s.history.folded(row.count)}
            </button>
          ) : (
            <Line key={key} row={row} />
          ),
        )}
      </div>
    </div>
  );
}

function Line({ row }: { row: Exclude<Row, { kind: 'fold' }> }) {
  const sign = row.kind === 'insert' ? '+' : row.kind === 'delete' ? '−' : ' ';
  const words = row.kind === 'equal' ? undefined : row.words;
  return (
    <div className={`vx-history__line is-${row.kind}`} data-kind={row.kind}>
      <span className="vx-history__num">{row.kind === 'insert' ? '' : row.oldLine}</span>
      <span className="vx-history__num">{row.kind === 'delete' ? '' : row.newLine}</span>
      <span
        className="vx-history__sign"
        aria-label={
          row.kind === 'insert' ? s.history.added : row.kind === 'delete' ? s.history.removed : undefined
        }
      >
        {sign}
      </span>
      <span className="vx-history__text">{words ? <Words parts={words} /> : row.text || ' '}</span>
    </div>
  );
}

function Words({ parts }: { parts: WordPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.changed ? (
          <mark key={i} className="vx-history__word">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
