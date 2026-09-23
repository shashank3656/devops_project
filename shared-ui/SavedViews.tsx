import { useEffect, useState } from 'react';

export interface SavedView<T> {
  name: string;
  filters: T;
}

const MAX_VIEWS = 12;

function sameFilters<T extends object>(a: T, b: T) {
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])) as Array<keyof T>;
  return keys.every((key) => String(a[key] ?? '') === String(b[key] ?? ''));
}

function readViews<T>(storageKey: string): SavedView<T>[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
    return Array.isArray(parsed) ? parsed.filter((view) => view && typeof view.name === 'string' && view.filters) : [];
  } catch {
    return [];
  }
}

/**
 * One-click filter presets. Views live in localStorage under `storageKey`, so they are per browser.
 * `presets` are built in and cannot be deleted.
 */
export default function SavedViews<T extends object>({
  storageKey,
  current,
  onApply,
  presets = [],
  canSave = true,
}: {
  storageKey: string;
  current: T;
  onApply: (filters: T) => void;
  presets?: SavedView<T>[];
  /** False when the current filters are the defaults, so there is nothing worth saving. */
  canSave?: boolean;
}) {
  const [views, setViews] = useState<SavedView<T>[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    setViews(readViews<T>(storageKey));
  }, [storageKey]);

  const persist = (next: SavedView<T>[]) => {
    setViews(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Storage full or disabled: views still work for this session.
    }
  };

  const save = () => {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    const rest = views.filter((view) => view.name.toLowerCase() !== trimmed.toLowerCase());
    persist([...rest, { name: trimmed, filters: { ...current } }].slice(-MAX_VIEWS));
    setName('');
    setNaming(false);
  };

  const all = [...presets.map((view) => ({ ...view, builtIn: true })), ...views.map((view) => ({ ...view, builtIn: false }))];
  const matchesExisting = all.some((view) => sameFilters(view.filters, current));

  return (
    <div className="ig-views" role="group" aria-label="Saved views">
      <span className="ig-views__label">Views</span>
      {all.map((view) => {
        const active = sameFilters(view.filters, current);
        return (
          <span key={`${view.builtIn ? 'preset' : 'saved'}:${view.name}`} className={`ig-views__chip${active ? ' is-active' : ''}`}>
            <button type="button" className="ig-views__apply" aria-pressed={active} onClick={() => onApply({ ...view.filters })}>
              {view.name}
            </button>
            {!view.builtIn ? (
              <button
                type="button"
                className="ig-views__remove"
                aria-label={`Delete view ${view.name}`}
                onClick={() => persist(views.filter((saved) => saved.name !== view.name))}
              >
                ×
              </button>
            ) : null}
          </span>
        );
      })}
      {naming ? (
        <form
          className="ig-views__form"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <input
            className="input ig-views__input"
            aria-label="View name"
            placeholder="Name this view"
            value={name}
            maxLength={40}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setNaming(false);
              }
            }}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>
            Save
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNaming(false)}>
            Cancel
          </button>
        </form>
      ) : canSave && !matchesExisting ? (
        <button type="button" className="ig-views__save" onClick={() => setNaming(true)}>
          + Save current filters
        </button>
      ) : null}
    </div>
  );
}
