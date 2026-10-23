/**
 * The picker / command palette surface (SPECS 11.3): a filter field over a list of
 * rows, Up and Down to move, Enter to choose, Escape to close. Workspace surfaces, no
 * ornament (design rule: ornament belongs to the chooser).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  icon?: ReactNode;
}

/** Subsequence fuzzy match; lower is better, null when it does not match. */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return direct === 0 ? 0 : 1 + direct / 100;
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    gaps += found - ti;
    ti = found + 1;
  }
  return 10 + gaps;
}

export function Palette({
  title,
  placeholder,
  items,
  empty,
  onChoose,
  onClose,
  footer,
  initialQuery = '',
  testId,
}: {
  title?: string;
  placeholder: string;
  items: PaletteItem[];
  empty: string;
  onChoose: (item: PaletteItem, query: string) => void;
  onClose: () => void;
  footer?: ReactNode;
  initialQuery?: string;
  testId?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const scored = items
      .map((it) => ({ it, score: fuzzyScore(query, `${it.label} ${it.detail ?? ''}`) }))
      .filter((x): x is { it: PaletteItem; score: number } => x.score !== null);
    scored.sort((a, b) => a.score - b.score || a.it.label.localeCompare(b.it.label));
    return scored.slice(0, 200).map((x) => x.it);
  }, [items, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  return (
    <div
      className="vx-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="vx-palette" role="dialog" aria-label={title ?? placeholder} data-testid={testId}>
        {title && <div className="vx-palette__title vx-caps">{title}</div>}
        <input
          ref={inputRef}
          className="vx-palette__input"
          placeholder={placeholder}
          aria-label={placeholder}
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="vx-palette-list"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(shown.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const it = shown[index];
              if (it) onChoose(it, query);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        />
        <div className="vx-palette__list" role="listbox" id="vx-palette-list" ref={listRef}>
          {shown.length === 0 && <div className="vx-palette__empty">{empty}</div>}
          {shown.map((it, i) => (
            <div
              key={it.id}
              className="vx-row"
              role="option"
              aria-selected={i === index}
              onMouseMove={() => setIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onChoose(it, query);
              }}
            >
              {it.icon}
              <span className="vx-row__name">{it.label}</span>
              {it.detail && <span className="vx-row__meta">{it.detail}</span>}
            </div>
          ))}
        </div>
        {footer}
      </div>
    </div>
  );
}

/** A small in-app confirmation on the same surface (destructive actions confirm in the app). */
export function Confirm({
  title,
  body,
  confirm,
  cancel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirm: string;
  cancel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="vx-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="vx-palette"
        role="alertdialog"
        aria-label={title}
        style={{ width: 480 }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="vx-palette__title vx-caps">{title}</div>
        <div className="vx-palette__body">{body}</div>
        <div className="vx-palette__foot">
          <button type="button" className="vx-btn vx-btn--small" onClick={onClose}>
            {cancel}
          </button>
          <button
            ref={ref}
            type="button"
            className={`vx-btn vx-btn--small ${danger ? 'vx-btn--danger' : 'vx-btn--primary'}`}
            onClick={onConfirm}
          >
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Asks for a name (New Section, Rename Section): the palette surface with one field.
 * `validate` answers at once; `onSubmit` resolves with an error to show, or null when done.
 */
export function NameDialog({
  title,
  label,
  initial = '',
  confirm,
  cancel,
  validate,
  onSubmit,
  onClose,
  testId,
}: {
  title: string;
  label: string;
  initial?: string;
  confirm: string;
  cancel: string;
  validate: (name: string) => string | null;
  onSubmit: (name: string) => Promise<string | null>;
  onClose: () => void;
  testId?: string;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const submit = async () => {
    const trimmed = name.trim();
    const problem = validate(trimmed);
    if (problem) return setError(problem);
    setBusy(true);
    const failed = await onSubmit(trimmed).catch((err: unknown) =>
      err instanceof Error ? err.message : String(err),
    );
    setBusy(false);
    if (failed) setError(failed);
  };
  return (
    <div className="vx-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="vx-palette vx-name-dialog"
        role="dialog"
        aria-label={title}
        data-testid={testId}
        style={{ width: 480 }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="vx-palette__title vx-caps">{title}</div>
        <div className="vx-palette__body">
          <input
            ref={inputRef}
            className="vx-input vx-input--ui vx-name-dialog__input"
            aria-label={label}
            placeholder={label}
            value={name}
            maxLength={120}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
          {error && (
            <p className="vx-dialog__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="vx-palette__foot">
          <button type="button" className="vx-btn vx-btn--small" onClick={onClose}>
            {cancel}
          </button>
          <button type="submit" className="vx-btn vx-btn--small vx-btn--primary" disabled={busy}>
            {confirm}
          </button>
        </div>
      </form>
    </div>
  );
}
