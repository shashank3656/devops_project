import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

export type RowKey = string | number;

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  width?: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  className?: string;
}

export interface DataTableSort {
  key: string;
  direction: 'asc' | 'desc';
}

const INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"]';

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  label,
  loading = false,
  skeletonRows = 8,
  empty,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  isRowSelectable,
  activeKey,
  onRowOpen,
  sort,
  onSortChange,
  rowClassName,
  rowVersion,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => RowKey;
  label: string;
  loading?: boolean;
  skeletonRows?: number;
  empty?: ReactNode;
  selectable?: boolean;
  selectedKeys?: Set<RowKey>;
  onSelectionChange?: (next: Set<RowKey>) => void;
  isRowSelectable?: (row: T) => boolean;
  activeKey?: RowKey | null;
  onRowOpen?: (row: T) => void;
  sort?: DataTableSort;
  onSortChange?: (key: string) => void;
  rowClassName?: (row: T) => string | undefined;
  /** Rows whose version changes between renders briefly get `is-changed`, which pulses their status chip once. */
  rowVersion?: (row: T) => string;
}) {
  const [focusIndex, setFocusIndex] = useState(0);
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [changedKeys, setChangedKeys] = useState<Set<RowKey>>(new Set());
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const headerCheckbox = useRef<HTMLInputElement>(null);
  const versions = useRef<Map<RowKey, string> | null>(null);
  const changedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(changedTimer.current), []);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const paged = rows.length > pageSize;
  const visibleRows = paged ? rows.slice(safePage * pageSize, safePage * pageSize + pageSize) : rows;

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    setPage(0);
    setFocusIndex(0);
  }, [label]);

  useEffect(() => {
    if (!rowVersion || loading) return;
    const previous = versions.current;
    const next = new Map<RowKey, string>();
    const changed = new Set<RowKey>();
    rows.forEach((row) => {
      const key = rowKey(row);
      const version = rowVersion(row);
      next.set(key, version);
      const before = previous?.get(key);
      if (before !== undefined && before !== version) changed.add(key);
    });
    versions.current = next;
    if (changed.size === 0) return;
    setChangedKeys(changed);
    window.clearTimeout(changedTimer.current);
    changedTimer.current = window.setTimeout(() => setChangedKeys(new Set()), 1400);
  }, [rows, rowKey, rowVersion, loading]);

  const selected = selectedKeys || new Set<RowKey>();
  const selectableRows = rows.filter((row) => !isRowSelectable || isRowSelectable(row));
  const selectedVisible = selectableRows.filter((row) => selected.has(rowKey(row))).length;
  const allSelected = selectableRows.length > 0 && selectedVisible === selectableRows.length;
  const someSelected = selectedVisible > 0 && !allSelected;

  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = someSelected;
  }, [someSelected]);

  useEffect(() => {
    if (focusIndex >= rows.length) setFocusIndex(Math.max(0, rows.length - 1));
  }, [rows.length, focusIndex]);

  useEffect(() => {
    if (activeKey === null || activeKey === undefined) return;
    const index = rows.findIndex((row) => rowKey(row) === activeKey);
    if (index >= 0) setFocusIndex(index);
  }, [activeKey, rows, rowKey]);

  const toggleRow = (row: T) => {
    if (!onSelectionChange || (isRowSelectable && !isRowSelectable(row))) return;
    const key = rowKey(row);
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  };

  const toggleAll = () => {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    if (allSelected) selectableRows.forEach((row) => next.delete(rowKey(row)));
    else selectableRows.forEach((row) => next.add(rowKey(row)));
    onSelectionChange(next);
  };

  const moveFocus = (index: number, open = false) => {
    if (visibleRows.length === 0) return;
    const clamped = Math.min(visibleRows.length - 1, Math.max(0, index));
    setFocusIndex(clamped);
    rowRefs.current[clamped]?.focus();
    if (open && onRowOpen) onRowOpen(visibleRows[clamped]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    if ((event.target as HTMLElement).closest('input, select, textarea')) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const followActive = activeKey !== null && activeKey !== undefined;
    switch (event.key) {
      case 'ArrowDown':
      case 'j':
        event.preventDefault();
        moveFocus(focusIndex + 1, followActive);
        break;
      case 'ArrowUp':
      case 'k':
        event.preventDefault();
        moveFocus(focusIndex - 1, followActive);
        break;
      case 'Home':
        event.preventDefault();
        moveFocus(0, followActive);
        break;
      case 'End':
        event.preventDefault();
        moveFocus(visibleRows.length - 1, followActive);
        break;
      case 'Enter':
      case 'o':
        if ((event.target as HTMLElement).closest('a, button')) return;
        event.preventDefault();
        if (visibleRows[focusIndex] && onRowOpen) onRowOpen(visibleRows[focusIndex]);
        break;
      case 'x':
      case ' ':
        if (!selectable) return;
        if ((event.target as HTMLElement).closest('a, button')) return;
        event.preventDefault();
        if (visibleRows[focusIndex]) toggleRow(visibleRows[focusIndex]);
        break;
      default:
        break;
    }
  };

  const handleRowClick = (event: MouseEvent<HTMLTableRowElement>, row: T, index: number) => {
    const target = event.target as HTMLElement;
    if (target.closest(INTERACTIVE)) return;
    if (selectable && target.closest('.ig-table__select')) {
      toggleRow(row);
      return;
    }
    setFocusIndex(index);
    if (selectable && (event.shiftKey || event.metaKey || event.ctrlKey)) {
      toggleRow(row);
      return;
    }
    onRowOpen?.(row);
  };

  const colSpan = columns.length + (selectable ? 1 : 0);

  return (
    <div className="ig-table-wrap">
      <table className="ig-table" aria-label={label} aria-busy={loading || undefined}>
        <thead>
          <tr>
            {selectable ? (
              <th className="ig-table__select" scope="col">
                <input
                  ref={headerCheckbox}
                  type="checkbox"
                  aria-label={allSelected ? 'Clear selection' : 'Select all rows'}
                  checked={allSelected}
                  disabled={selectableRows.length === 0 || loading}
                  onChange={toggleAll}
                />
              </th>
            ) : null}
            {columns.map((column) => {
              const sorted = sort && sort.key === column.id ? sort.direction : null;
              return (
                <th
                  key={column.id}
                  scope="col"
                  style={{ width: column.width, textAlign: column.align }}
                  className={column.className}
                  aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {column.sortable && onSortChange ? (
                    <button type="button" className="ig-table__sort" onClick={() => onSortChange(column.id)}>
                      {column.header}
                      <span className={`ig-table__sort-icon${sorted ? ' is-active' : ''}`} aria-hidden>
                        {sorted === 'asc' ? '↑' : '↓'}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody onKeyDown={handleKeyDown}>
          {loading && rows.length === 0
            ? Array.from({ length: skeletonRows }).map((_, index) => (
                <tr key={`skeleton-${index}`} className="ig-table__row ig-table__row--skeleton">
                  {selectable ? (
                    <td className="ig-table__select">
                      <span className="ig-skeleton" style={{ width: 14, height: 14 }} />
                    </td>
                  ) : null}
                  {columns.map((column, colIndex) => (
                    <td key={column.id}>
                      <span className="ig-skeleton ig-skeleton--line" style={{ width: `${45 + ((index + colIndex) % 4) * 12}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            : null}
          {!loading && rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="ig-table__empty">
                {empty || 'Nothing to show.'}
              </td>
            </tr>
          ) : null}
          {visibleRows.map((row, index) => {
            const key = rowKey(row);
            const isSelected = selected.has(key);
            const isActive = activeKey !== undefined && activeKey !== null && activeKey === key;
            const canSelect = !isRowSelectable || isRowSelectable(row);
            const extra = rowClassName?.(row);
            return (
              <tr
                key={key}
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                tabIndex={index === focusIndex ? 0 : -1}
                className={`ig-table__row${isSelected ? ' is-selected' : ''}${isActive ? ' is-active' : ''}${
                  loading ? ' is-stale' : ''
                }${changedKeys.has(key) ? ' is-changed' : ''}${extra ? ` ${extra}` : ''}`}
                aria-selected={selectable ? isSelected : undefined}
                aria-current={isActive ? 'true' : undefined}
                onClick={(event) => handleRowClick(event, row, index)}
                onFocus={() => setFocusIndex(index)}
              >
                {selectable ? (
                  <td className="ig-table__select" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      tabIndex={-1}
                      aria-label={`Select row ${key}`}
                      checked={isSelected}
                      disabled={!canSelect}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        event.stopPropagation();
                        toggleRow(row);
                      }}
                    />
                  </td>
                ) : null}
                {columns.map((column) => (
                  <td key={column.id} style={{ textAlign: column.align }} className={column.className}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {paged ? (
        <div className="ig-table-pager">
          <span>
            Showing {safePage * pageSize + 1}–{Math.min(rows.length, safePage * pageSize + visibleRows.length)} of {rows.length}
          </span>
          <div className="ig-table-pager__actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={safePage === 0} title={safePage === 0 ? 'You are on the first page' : 'Previous page'} onClick={() => { setPage(safePage - 1); setFocusIndex(0); }}>
              Previous
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={safePage >= pageCount - 1} title={safePage >= pageCount - 1 ? 'You are on the last page' : 'Next page'} onClick={() => { setPage(safePage + 1); setFocusIndex(0); }}>
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
