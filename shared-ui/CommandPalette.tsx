import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { buildPortalApiUrl, portalFetch } from './apiRuntime';
import { OPEN_PALETTE_EVENT } from './theme';
import type { PaletteCommand, SearchHit } from './types';

interface CommandPaletteProps {
  apiUrl: string;
  token: string | null;
  commands: PaletteCommand[];
}

export default function CommandPalette({ apiUrl, token, commands }: CommandPaletteProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const inField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (event.key === 'Escape') {
        setOpen(false);
      }
      if (inField && !open) return;
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      return;
    }
    setQuery('');
    setHits([]);
    setActive(0);
    setSearchState('idle');
    returnFocusRef.current?.focus?.();
    returnFocusRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open || !token || query.trim().length < 2) {
      setHits([]);
      setSearchState('idle');
      return;
    }
    let cancelled = false;
    setSearchState('loading');
    const handle = window.setTimeout(() => {
      portalFetch(buildPortalApiUrl(apiUrl, `/api/search?q=${encodeURIComponent(query.trim())}`), {
        token,
      })
        .then((res) => {
          if (!res.ok) throw new Error('search failed');
          return res.json();
        })
        .then((data) => {
          if (cancelled) return;
          setHits(Array.isArray(data?.hits) ? data.hits : []);
          setSearchState('done');
        })
        .catch(() => {
          if (cancelled) return;
          setHits([]);
          setSearchState('error');
        });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [apiUrl, open, query, token]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const commandHits = commands
      .filter((command) => !needle || command.label.toLowerCase().includes(needle) || (command.hint || '').toLowerCase().includes(needle))
      .map((command) => ({
        id: `cmd-${command.id}`,
        kind: 'page',
        title: command.label,
        subtitle: command.hint || '',
        href: command.href,
      }));
    return [...commandHits, ...hits].slice(0, 20);
  }, [commands, hits, query]);

  useEffect(() => {
    setActive(0);
  }, [results.length, query]);

  if (!open) return null;

  const go = (href: string) => {
    setOpen(false);
    void router.push(href);
  };

  const trimmed = query.trim();
  const activeId = results[active] ? `ig-palette-option-${active}` : undefined;
  let statusText = '';
  if (!token && trimmed.length >= 2) statusText = 'Sign in again to search records. Page shortcuts still work.';
  else if (searchState === 'loading') statusText = 'Searching records…';
  else if (searchState === 'error') statusText = 'Record search is unavailable right now. Page shortcuts still work.';
  else if (trimmed.length === 1) statusText = 'Type at least 2 characters to search records.';

  return (
    <div className="ig-palette" role="dialog" aria-modal="true" aria-label="Search" onClick={() => setOpen(false)}>
      <div className="ig-palette__panel" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          className="ig-palette__input"
          value={query}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="ig-palette-results"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label="Search records or jump to a page"
          placeholder="Search requests, PRs, projects, or jump to a page"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Tab') {
              event.preventDefault();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((value) => Math.min(value + 1, Math.max(results.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((value) => Math.max(value - 1, 0));
            } else if (event.key === 'Enter' && results[active]) {
              event.preventDefault();
              go(results[active].href);
            }
          }}
        />
        <p className={`ig-palette__status${searchState === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite">
          {statusText}
        </p>
        <div className="ig-palette__results" id="ig-palette-results" role="listbox" aria-label="Results">
          {results.length === 0 ? (
            <div className="ig-empty ig-palette__empty">
              {trimmed.length < 2
                ? 'Type to search records, or a page name to jump there. Esc closes.'
                : searchState === 'loading'
                ? 'Searching…'
                : `No matches for "${trimmed}". Try a ticket number, service name, or repo.`}
            </div>
          ) : (
            results.map((item, index) => (
              <button
                key={item.id}
                id={`ig-palette-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                className={`ig-palette__item ${index === active ? 'is-active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(item.href)}
              >
                <span>
                  <strong>{item.title}</strong>
                  {item.subtitle ? <div className="ig-muted">{item.subtitle}</div> : null}
                </span>
                <span className="ig-muted">{item.kind === 'page' ? item.href : item.kind}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
