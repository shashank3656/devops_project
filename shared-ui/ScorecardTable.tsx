import Link from 'next/link';
import DataTable, { type DataTableColumn } from './DataTable';

export interface ScorecardCheckRow {
  key: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface ScorecardDoraRow {
  key: string;
  label: string;
  value: number;
  unit: string;
  band: string;
}

export interface ScorecardRow {
  service: string;
  environment?: string;
  team?: string;
  project_name?: string;
  score: number;
  open_incidents: number;
  last_change?: string;
  last_change_id?: number;
  slo_burned?: boolean;
  drift?: { drifted?: boolean; detail?: string };
  checks?: ScorecardCheckRow[];
  dora?: ScorecardDoraRow[];
}

function rowKey(item: ScorecardRow): string {
  return `${item.service}-${item.environment || ''}`;
}

function buildUserColumns(): DataTableColumn<ScorecardRow>[] {
  return [
    {
      id: 'service',
      header: 'Service',
      cell: (item) => (
        <>
          <strong>{item.service}</strong>
          <div className="portal-surface__subtitle">
            {(item.checks || []).filter((check) => !check.passed).map((check) => check.label).join(' · ') || 'All checks passed'}
          </div>
        </>
      ),
    },
    { id: 'score', header: 'Score', cell: (item) => String(item.score) },
    { id: 'incidents', header: 'Incidents', cell: (item) => String(item.open_incidents) },
    {
      id: 'dora',
      header: 'DORA',
      cell: (item) =>
        (item.dora || [])
          .filter((metric) => metric.key === 'change_failure_rate')
          .map((metric) => (
            <span key={metric.key}>
              {metric.value}
              {metric.unit === 'percent' ? '%' : ` ${metric.unit}`} ({metric.band})
            </span>
          )),
    },
    {
      id: 'last_change',
      header: 'Last change',
      cell: (item) => (
        <>
          {item.last_change_id ? <Link href={`/changes/${item.last_change_id}`}>{item.last_change}</Link> : '—'}
          {item.drift?.drifted ? (
            <div className="portal-surface__subtitle">{item.drift.detail || 'Live image drifted from last CHG'}</div>
          ) : null}
        </>
      ),
    },
  ];
}

function buildDevopsColumns(): DataTableColumn<ScorecardRow>[] {
  return [
    {
      id: 'service',
      header: 'Service',
      cell: (item) => (
        <>
          <strong>{item.service}</strong>
          <div className="portal-surface__subtitle">{item.team || item.project_name || item.environment || '—'}</div>
        </>
      ),
    },
    { id: 'score', header: 'Score', cell: (item) => String(item.score) },
    {
      id: 'dora',
      header: 'DORA',
      cell: (item) =>
        (item.dora || [])
          .filter((metric) => metric.key === 'change_failure_rate' || metric.key === 'deploy_frequency')
          .map((metric) => (
            <div key={metric.key}>
              {metric.label}: {metric.value} {metric.unit} ({metric.band})
            </div>
          )),
    },
    {
      id: 'checks',
      header: 'Checks',
      cell: (item) =>
        (item.checks || []).map((check) => (
          <div key={check.key}>
            {check.passed ? 'pass' : 'fail'} · {check.label}
          </div>
        )),
    },
    {
      id: 'last_change',
      header: 'Last change',
      cell: (item) => (
        <>
          {item.last_change_id ? <Link href={`/changes/${item.last_change_id}`}>{item.last_change}</Link> : '—'}
          {item.slo_burned ? <div className="portal-surface__subtitle">SLO burning</div> : null}
          {item.drift?.drifted ? (
            <div className="portal-surface__subtitle">{item.drift.detail || 'Live image drifted from last CHG'}</div>
          ) : null}
        </>
      ),
    },
  ];
}

function buildAdminColumns(): DataTableColumn<ScorecardRow>[] {
  return [
    {
      id: 'service',
      header: 'Service',
      cell: (item) => (
        <>
          <strong>{item.service}</strong>
          <div className="portal-surface__subtitle">{item.team || item.environment || '—'}</div>
        </>
      ),
    },
    { id: 'score', header: 'Score', cell: (item) => String(item.score) },
    { id: 'incidents', header: 'Incidents', cell: (item) => String(item.open_incidents) },
    {
      id: 'dora',
      header: 'DORA',
      cell: (item) =>
        (item.dora || [])
          .filter((metric) => metric.key === 'change_failure_rate')
          .map((metric) => (
            <span key={metric.key}>
              {metric.value}% ({metric.band})
            </span>
          )),
    },
    {
      id: 'last_change',
      header: 'Last change',
      cell: (item) => (
        <>
          {item.last_change || 'no CHG'}
          {item.slo_burned ? ' · SLO burning' : ''}
          {item.drift?.drifted ? (
            <div className="portal-surface__subtitle">{item.drift.detail || 'Live image drifted from last CHG'}</div>
          ) : null}
        </>
      ),
    },
  ];
}

export default function ScorecardTable({
  variant,
  rows,
  loading,
  empty,
}: {
  variant: 'user' | 'devops' | 'admin';
  rows: ScorecardRow[];
  loading?: boolean;
  empty?: React.ReactNode;
}) {
  const columns =
    variant === 'devops' ? buildDevopsColumns() : variant === 'admin' ? buildAdminColumns() : buildUserColumns();
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => rowKey(row)}
      label="Service scorecards"
      loading={loading}
      empty={empty}
    />
  );
}
