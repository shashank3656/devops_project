export type PageFilterChip = {
  key: string;
  label: string;
  value: string;
};

export default function PageFilters({
  search,
  onSearchChange,
  searchPlaceholder = 'Search this list',
  status,
  statusOptions,
  onStatusChange,
  chips = [],
  onRemoveChip,
  onClear,
}: {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  status?: string;
  statusOptions?: Array<{ value: string; label: string }>;
  onStatusChange?: (value: string) => void;
  chips?: PageFilterChip[];
  onRemoveChip?: (key: string) => void;
  onClear?: () => void;
}) {
  const active = chips.filter((chip) => chip.value);
  const hasFields = Boolean(onSearchChange || (onStatusChange && statusOptions));
  if (!active.length && !hasFields) return null;
  return (
    <div className="ig-page-filters">
      {active.length > 0 ? (
        <div className="ig-page-filters__chips" aria-label="Active filters">
          {active.map((chip) => (
            <span key={chip.key} className="ig-page-filters__chip">
              <span className="ig-page-filters__chip-label">{chip.label}</span>
              <strong>{chip.value}</strong>
              {onRemoveChip ? (
                <button type="button" className="ig-page-filters__chip-remove" onClick={() => onRemoveChip(chip.key)} aria-label={`Remove ${chip.label} filter`}>
                  ×
                </button>
              ) : null}
            </span>
          ))}
          {onClear ? (
            <button type="button" className="ig-page-filters__clear" onClick={onClear}>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}
      {hasFields ? (
        <div className="ig-page-filters__row">
          {onSearchChange ? (
            <label className="ig-page-filters__field">
              <span>Search</span>
              <input
                className="input"
                type="search"
                value={search || ''}
                placeholder={searchPlaceholder}
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </label>
          ) : null}
          {onStatusChange && statusOptions ? (
            <label className="ig-page-filters__field">
              <span>Status</span>
              <select className="input" value={status || ''} onChange={(event) => onStatusChange(event.target.value)}>
                {statusOptions.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
