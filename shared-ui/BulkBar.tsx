import type { ReactNode } from 'react';

export default function BulkBar({
  count,
  noun = 'item',
  onClear,
  children,
}: {
  count: number;
  noun?: string;
  onClear: () => void;
  children?: ReactNode;
}) {
  if (count <= 0) return null;
  return (
    <div className="ig-bulkbar" role="toolbar" aria-label="Bulk actions">
      <span className="ig-bulkbar__count">
        <strong>{count}</strong> {noun}
        {count === 1 ? '' : 's'} selected
      </span>
      <div className="ig-bulkbar__actions">{children}</div>
      <button type="button" className="ig-bulkbar__clear" onClick={onClear} aria-label="Clear selection">
        ✕
      </button>
    </div>
  );
}
