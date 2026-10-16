type FilterOption = { value: string; label: string };

type AccessFiltersProps = {
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  kind: string;
  onKind: (value: string) => void;
  kindLabel: string;
  kindOptions: FilterOption[];
  extra: string;
  onExtra: (value: string) => void;
  extraLabel: string;
  extraOptions: FilterOption[];
};

export default function AccessFilters({
  query,
  onQuery,
  placeholder,
  kind,
  onKind,
  kindLabel,
  kindOptions,
  extra,
  onExtra,
  extraLabel,
  extraOptions,
}: AccessFiltersProps) {
  const active = query.trim() !== '' || kind !== 'all' || extra !== 'all';
  return (
    <form className="access-filters" onSubmit={(event) => event.preventDefault()}>
      <label>
        Search
        <input className="input" type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder={placeholder} />
      </label>
      <label>
        {kindLabel}
        <select className="input" value={kind} onChange={(event) => onKind(event.target.value)}>
          {kindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label>
        {extraLabel}
        <select className="input" value={extra} onChange={(event) => onExtra(event.target.value)}>
          {extraOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {active ? (
        <button type="button" className="btn btn-secondary" onClick={() => { onQuery(''); onKind('all'); onExtra('all'); }}>
          Clear
        </button>
      ) : <span />}
    </form>
  );
}
