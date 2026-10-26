import { useMemo, useState } from 'react';

export type CostSearchOption = {
  value: string;
  label: string;
};

export default function CostSearchSelect({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: CostSearchOption[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((row) => row.value === value);
  const filtered = useMemo(() => {
    const needle = (open ? query : '').trim().toLowerCase();
    const rows = needle
      ? options.filter((row) => row.label.toLowerCase().includes(needle) || row.value.toLowerCase().includes(needle))
      : options;
    return rows.slice(0, 40);
  }, [open, options, query]);

  const commitQuery = (next: string) => {
    const needle = next.trim().toLowerCase();
    if (!needle) {
      onChange('');
      return;
    }
    const match = options.find((row) => row.value.toLowerCase() === needle || row.label.toLowerCase() === needle);
    onChange(match ? match.value : value);
  };

  return (
    <label className="label cost-search">
      {label}
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        autoComplete="off"
        value={open ? query : (selected?.label || value)}
        placeholder={placeholder}
        onFocus={() => {
          setQuery(selected?.label || value);
          setOpen(true);
        }}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setOpen(true);
          if (!next.trim()) onChange('');
        }}
        onBlur={() => {
          window.setTimeout(() => {
            commitQuery(query);
            setOpen(false);
          }, 120);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitQuery(query);
            setOpen(false);
          }
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      {open ? (
        <ul id={`${id}-list`} className="cost-search__list" role="listbox">
          <li>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(''); setQuery(''); setOpen(false); }}>
              None
            </button>
          </li>
          {filtered.map((row) => (
            <li key={row.value}>
              <button
                type="button"
                aria-selected={row.value === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(row.value);
                  setQuery(row.label);
                  setOpen(false);
                }}
              >
                {row.label}
              </button>
            </li>
          ))}
          {!filtered.length ? <li className="cost-search__empty">No matches in accounts you can use.</li> : null}
        </ul>
      ) : null}
    </label>
  );
}
