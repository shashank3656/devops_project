import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHits([]);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !token || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      fetch(`${apiUrl.replace(/\/+$/, '')}/api/search?q=${encodeURIComponent(query.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setHits(Array.isArray(data?.hits) ? data.hits : []))
        .catch(() => setHits([]));
    }, 160);
    return () => window.clearTimeout(handle);
  }, [apiUrl, open, query, token]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const commandHits = commands
      .filter((command) => !needle || command.label.toLowerCase().includes(needle) || (command.hint || '').toLowerCase().includes(needle))
      .map((command) => ({
        id: `cmd-${command.id}`,
        kind: 'command',
        title: command.label,
        subtitle: command.hint || 'Command',
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

  return (
    <div className="ig-palette" role="dialog" aria-label="Command palette" onClick={() => setOpen(false)}>
      <div className="ig-palette__panel" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          className="ig-palette__input"
          value={query}
          placeholder="Search requests, PRs, projects, or jump to a page"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
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
        <div className="ig-palette__results">
          {results.length === 0 ? (
            <div className="ig-empty" style={{ padding: '18px 20px' }}>Type to search. Cmd/Ctrl+K closes this.</div>
          ) : (
            results.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`ig-palette__item ${index === active ? 'is-active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(item.href)}
              >
                <span>
                  <strong>{item.title}</strong>
                  {item.subtitle ? <div className="ig-muted">{item.subtitle}</div> : null}
                </span>
                <span className="ig-muted">{item.kind}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
