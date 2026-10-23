/**
 * The single search field in the title bar (SPECS 6.2) with its results dropdown:
 * Up and Down move, Enter opens, Ctrl/Cmd+Enter opens without closing, Escape closes.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { IndexStatus, SearchHit, SearchScope, VaultInfo } from '@shared/bridge';
import { Icon } from '../components/Icon';
import { unwrap, vx } from '../lib/vx';
import { useApp } from '../store/app';
import { domainStrings } from '../strings/domains';
import { workspaceStrings as s } from '../strings/workspace';
import { openPath } from './actions';

export type ScopeKind = 'vault' | 'domain' | 'all';

export interface SearchHandle {
  focus(): void;
}

function Snippet({ parts }: { parts: SearchHit['snippets'][number] }) {
  return (
    <div className="vx-result__snippet">
      {parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </div>
  );
}

export function useIndexStatus(): IndexStatus {
  const [st, setSt] = useState<IndexStatus>({ state: 'idle', done: 0, total: 0 });
  useEffect(() => {
    void unwrap(vx().index.status()).then(setSt, () => undefined);
    return vx().index.onStatus(setSt);
  }, []);
  return st;
}

export const SearchBox = forwardRef<SearchHandle, { vault: VaultInfo; scope: ScopeKind }>(function SearchBox(
  { vault, scope },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [index, setIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const status = useIndexStatus();
  const vaults = useApp((st) => st.vaults);
  const listRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelBlur = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = null;
  };

  useImperativeHandle(ref, () => ({
    focus() {
      inputRef.current?.focus();
      inputRef.current?.select();
      if (query) setOpen(true);
    },
  }));

  const scopeArg: SearchScope =
    scope === 'vault'
      ? { kind: 'vault', vaultPath: vault.path }
      : scope === 'domain'
        ? { kind: 'domain', domain: vault.domain }
        : { kind: 'all' };

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      void unwrap(vx().index.search(query, scopeArg)).then(
        (h) => {
          if (!live) return;
          setHits(h);
          setIndex(0);
          setSearching(false);
        },
        () => live && setSearching(false),
      );
    }, 90);
    const off = vx().index.onChanged(() => {
      void unwrap(vx().index.search(query, scopeArg)).then(
        (h) => live && setHits(h),
        () => undefined,
      );
    });
    return () => {
      live = false;
      clearTimeout(t);
      off();
    };
    // scopeArg is derived from scope and vault.
  }, [query, scope, vault.path, vault.domain]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const choose = (hit: SearchHit, keepOpen: boolean) => {
    openPath(hit.path, keepOpen ? { background: true } : undefined);
    if (!keepOpen) {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const vaultName = (p: string | null) =>
    p ? (vaults.find((v) => v.path === p)?.name ?? p.split('/')[1] ?? p) : null;

  return (
    <div className="vx-search-wrap">
      <label className="vx-search">
        <Icon name="search" size={15} strokeWidth={1.8} />
        <input
          ref={inputRef}
          type="search"
          placeholder={s.search.placeholder(
            scope === 'vault'
              ? vault.name
              : scope === 'domain'
                ? domainStrings[vault.domain].name
                : 'All Vaults',
          )}
          aria-label={s.search.label}
          data-testid="search-input"
          role="combobox"
          aria-expanded={open && !!query}
          aria-controls="vx-results"
          value={query}
          onChange={(e) => {
            cancelBlur();
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            cancelBlur();
            if (query) setOpen(true);
          }}
          onBlur={() => {
            cancelBlur();
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(hits.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const h = hits[index];
              if (h) choose(h, e.ctrlKey || e.metaKey);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              if (query) setQuery('');
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
        />
        <span className="vx-search__key" aria-hidden="true">
          {s.search.key}
        </span>
      </label>
      {open && query.trim() && (
        <div
          className="vx-results"
          role="listbox"
          id="vx-results"
          data-testid="search-results"
          onMouseDown={(e) => e.preventDefault()}
        >
          {status.state === 'indexing' && (
            <div className="vx-results__status" data-testid="search-indexing">
              {s.search.indexing(status.done, status.total)}
            </div>
          )}
          <div className="vx-results__list" ref={listRef}>
            {hits.length === 0 && !searching && <div className="vx-results__empty">{s.search.none}</div>}
            {hits.map((h, i) => {
              const d = h.domain ? domainStrings[h.domain] : null;
              return (
                <div
                  key={h.path}
                  className="vx-result"
                  role="option"
                  aria-selected={i === index}
                  data-testid="search-result"
                  onMouseMove={() => setIndex(i)}
                  onClick={(e) => choose(h, e.ctrlKey || e.metaKey)}
                >
                  <div className="vx-result__head">
                    {h.kind === 'file' ? (
                      /\.pdf$/i.test(h.path) ? (
                        <span className="vx-pdf">PDF</span>
                      ) : (
                        <span className="vx-ext">{h.path.split('.').pop()?.slice(0, 4)}</span>
                      )
                    ) : (
                      <Icon name="note" className="vx-row__doc" />
                    )}
                    <span className="vx-result__title">{h.title}</span>
                    <span
                      className="vx-result__where"
                      style={d ? { ['--domain' as string]: d.color } : undefined}
                    >
                      {d && <span className="vx-diamond" aria-hidden="true" />}
                      {vaultName(h.vault) ?? (d ? d.name : s.search.outside)}
                    </span>
                  </div>
                  {h.snippets.slice(0, 2).map((sn, j) => (
                    <Snippet key={j} parts={sn} />
                  ))}
                </div>
              );
            })}
          </div>
          <div className="vx-results__foot" aria-hidden="true">
            <span>↑ ↓ {s.search.move}</span>
            <span>Enter {s.search.open}</span>
            <span>Ctrl Enter {s.search.openKeep}</span>
            <span>Esc {s.search.close}</span>
          </div>
        </div>
      )}
    </div>
  );
});
