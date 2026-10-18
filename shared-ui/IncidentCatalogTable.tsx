import DataTable, { type DataTableColumn } from './DataTable';
import CopyButton from './CopyButton';

export interface IncidentCatalogRow {
  id: number;
  incident_number?: string;
  summary?: string;
  source?: string;
  severity?: string;
  status?: string;
  project_name?: string;
  project_code?: string;
  service?: string;
  request_service?: string;
  environment?: string;
  request_env?: string;
  suspected_change_number?: string;
  owner_username?: string;
  updated_at?: string;
}

export function incidentReference(incident: Pick<IncidentCatalogRow, 'id' | 'incident_number'>): string {
  return incident.incident_number || `INC${String(incident.id).padStart(7, '0')}`;
}

function buildUserColumns(): DataTableColumn<IncidentCatalogRow>[] {
  return [
    {
      id: 'incident',
      header: 'Incident',
      cell: (incident) => (
        <div>
          <strong>{incidentReference(incident)}</strong>
          <CopyButton value={incidentReference(incident)} label="incident number" />
          <div className="incidents-page__meta">
            {[incident.service || incident.request_service || 'service', incident.environment || incident.request_env || '']
              .filter(Boolean)
              .join(' · ')}
          </div>
          <div className="incidents-page__notes">{incident.summary || 'No summary yet'}</div>
        </div>
      ),
    },
    { id: 'source', header: 'Source', cell: (i) => i.source || 'ticket' },
    { id: 'severity', header: 'Severity', cell: (i) => i.severity || '—' },
    { id: 'status', header: 'Status', cell: (i) => i.status || '—' },
    {
      id: 'project',
      header: 'Project',
      cell: (i) => (i.project_name ? `${i.project_name} (${i.project_code})` : 'No project'),
    },
    { id: 'change', header: 'Change', cell: (i) => i.suspected_change_number || '—' },
    { id: 'updated', header: 'Updated', cell: (i) => i.updated_at || '—' },
  ];
}

function buildAdminColumns(): DataTableColumn<IncidentCatalogRow>[] {
  return [
    {
      id: 'incident',
      header: 'Incident',
      cell: (item) => (
        <>
          <strong>{incidentReference(item)}</strong>
          <CopyButton value={incidentReference(item)} label="incident number" />
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.summary || 'No summary'}</div>
        </>
      ),
    },
    { id: 'source', header: 'Source', cell: (i) => i.source || 'ticket' },
    { id: 'severity', header: 'Severity', cell: (i) => i.severity || '—' },
    { id: 'status', header: 'Status', cell: (i) => i.status || '—' },
    { id: 'service', header: 'Service', cell: (i) => i.service || i.request_service || '—' },
    { id: 'change', header: 'Change', cell: (i) => i.suspected_change_number || '—' },
    { id: 'owner', header: 'Owner', cell: (i) => i.owner_username || 'Unassigned' },
  ];
}

export default function IncidentCatalogTable({
  variant,
  rows,
  loading,
  empty,
  onOpen,
}: {
  variant: 'user' | 'admin';
  rows: IncidentCatalogRow[];
  loading?: boolean;
  empty?: React.ReactNode;
  onOpen: (row: IncidentCatalogRow) => void;
}) {
  const columns = variant === 'admin' ? buildAdminColumns() : buildUserColumns();
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      label="Incident catalog"
      loading={loading}
      empty={empty}
      onRowOpen={onOpen}
    />
  );
}
