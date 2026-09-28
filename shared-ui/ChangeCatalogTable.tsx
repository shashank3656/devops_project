import type { ReactNode } from 'react';
import DataTable, { type DataTableColumn, type RowKey } from './DataTable';

export interface ChangeCatalogRow {
  id: number;
  change_number?: string;
  title?: string;
  summary?: string;
  sha?: string;
  repo?: string;
  pr_number?: number;
  service?: string;
  environment?: string;
  assignee_username?: string;
  priority?: string;
  risk_level?: string;
  change_type?: string;
  status?: string;
  cab_status?: string;
  linked_incidents?: number;
}

function changeNumber(row: ChangeCatalogRow): string {
  return row.change_number || `CHG${String(row.id).padStart(7, '0')}`;
}

export function buildChangeCatalogColumns(options?: { showRisk?: boolean }): DataTableColumn<ChangeCatalogRow>[] {
  const cols: DataTableColumn<ChangeCatalogRow>[] = [
    {
      id: 'change',
      header: 'Change',
      cell: (item) => (
        <>
          <strong>{changeNumber(item)}</strong>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.title || item.sha || '—'}</div>
          {item.summary ? (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 2 }}>
              {item.summary.length > 96 ? `${item.summary.slice(0, 96)}…` : item.summary}
            </div>
          ) : null}
        </>
      ),
    },
    {
      id: 'repo',
      header: 'Repo / PR',
      cell: (item) => (
        <>
          {item.repo || '—'}
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
            {item.pr_number ? `PR #${item.pr_number}` : 'No PR'} · {(item.sha || '').slice(0, 7) || '—'}
          </div>
        </>
      ),
    },
    { id: 'service', header: 'Service', cell: (item) => item.service || '—' },
    {
      id: 'env',
      header: 'Env',
      cell: (item) => (item.environment === 'unspecified' || !item.environment ? '—' : item.environment),
    },
    { id: 'assignee', header: 'Assigned to', cell: (item) => item.assignee_username || '—' },
    { id: 'priority', header: 'Priority', cell: (item) => item.priority || 'medium' },
  ];
  if (options?.showRisk) {
    cols.push({ id: 'risk', header: 'Risk', cell: (item) => item.risk_level || 'medium' });
  }
  cols.push(
    { id: 'type', header: 'Type', cell: (item) => item.change_type || '—' },
    {
      id: 'status',
      header: 'Status',
      cell: (item) => (
        <>
          {item.status || '—'}
          {item.cab_status ? (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>CAB {item.cab_status}</div>
          ) : null}
        </>
      ),
    },
    { id: 'incidents', header: 'Incidents', cell: (item) => String(item.linked_incidents ?? 0) },
  );
  return cols;
}

export default function ChangeCatalogTable({
  rows,
  loading,
  empty,
  showRisk,
  onOpen,
  selectable = false,
  selectedKeys,
  onSelectionChange,
}: {
  rows: ChangeCatalogRow[];
  loading?: boolean;
  empty?: ReactNode;
  showRisk?: boolean;
  onOpen: (row: ChangeCatalogRow) => void;
  selectable?: boolean;
  selectedKeys?: Set<RowKey>;
  onSelectionChange?: (next: Set<RowKey>) => void;
}) {
  const columns = buildChangeCatalogColumns({ showRisk });
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      label="Change catalog"
      loading={loading}
      empty={empty}
      onRowOpen={onOpen}
      selectable={selectable}
      selectedKeys={selectedKeys}
      onSelectionChange={onSelectionChange}
    />
  );
}
