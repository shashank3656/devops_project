import Link from 'next/link';
import DataTable, { type DataTableColumn } from './DataTable';

export interface ScorecardCheckRow {
  key: string;
  label: string;
  passed: boolean;
  state?: 'pass' | 'fail' | 'unknown' | string;
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
  service_id?: number;
  service: string;
  environment?: string;
  team?: string;
  project_name?: string;
  score: number;
  score_state?: 'known' | 'unknown' | string;
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

function checkState(check: ScorecardCheckRow): 'pass' | 'fail' | 'unknown' {
  if (check.state === 'pass' || check.state === 'fail' || check.state === 'unknown') return check.state;
  return check.passed ? 'pass' : 'fail';
}

function scoreText(item: ScorecardRow): string {
  return item.score_state === 'known' ? String(item.score) : 'Unknown';
}

function failedLabels(item: ScorecardRow): string {
  const checks = item.checks || [];
  const failed = checks.filter((check) => checkState(check) === 'fail').map((check) => check.label);
  const unknown = checks.filter((check) => checkState(check) === 'unknown').map((check) => check.label);
  if (failed.length && unknown.length) return `${failed.join(' · ')} · Unknown: ${unknown.join(' · ')}`;
  if (failed.length) return failed.join(' · ');
  if (unknown.length) return `Unknown: ${unknown.join(' · ')}`;
  return 'Known checks passed';
}

function doraText(metric: ScorecardDoraRow): string {
  if (metric.band === 'none' || metric.band === '') return 'Unknown';
  const unit = metric.unit === 'percent' ? '%' : ` ${metric.unit}`;
  return `${metric.value}${unit} (${metric.band})`;
}

function serviceHref(item: ScorecardRow): string {
  return item.service_id ? `/services/${item.service_id}` : `/services?q=${encodeURIComponent(item.service)}`;
}

function gapActions(item: ScorecardRow): { href: string; label: string }[] {
  const seen = new Set<string>();
  const out: { href: string; label: string }[] = [];
  const add = (href: string, label: string) => {
    if (seen.has(href)) return;
    seen.add(href);
    out.push({ href, label });
  };
  for (const check of item.checks || []) {
    if (checkState(check) === 'pass') continue;
    if (check.key === 'owner') add(serviceHref(item), 'Assign owner');
    if (check.key === 'runbook') add(`/runbooks/new?service=${encodeURIComponent(item.service)}`, 'Add runbook');
    if (check.key === 'incidents') add(`/incidents?q=${encodeURIComponent(item.service)}`, 'Open incidents');
    if (check.key === 'slo') add(`/slos?q=${encodeURIComponent(item.service)}`, 'Review SLO');
    if (check.key === 'change') add('/changes/new', 'Create change');
  }
  if (item.slo_burned) add(`/slos?q=${encodeURIComponent(item.service)}`, 'Review SLO');
  if (item.open_incidents > 0) add(`/incidents?q=${encodeURIComponent(item.service)}`, 'Open incidents');
  return out.slice(0, 3);
}

function GapLinks({ item }: { item: ScorecardRow }) {
  const gaps = gapActions(item);
  if (!gaps.length) return <span className="ig-cell-meta">No gaps</span>;
  return (
    <div className="ig-cell-stack">
      {gaps.map((gap) => (
        <Link key={`${gap.href}-${gap.label}`} className="ig-cell-link" href={gap.href}>
          {gap.label}
        </Link>
      ))}
    </div>
  );
}

function buildUserColumns(): DataTableColumn<ScorecardRow>[] {
  return [
    {
      id: 'service',
      header: 'Service',
      cell: (item) => (
        <>
          <strong>{item.service}</strong>
          <div className="portal-surface__subtitle">{failedLabels(item)}</div>
        </>
      ),
    },
    { id: 'score', header: 'Score', cell: (item) => scoreText(item) },
    { id: 'incidents', header: 'Incidents', cell: (item) => String(item.open_incidents) },
    {
      id: 'dora',
      header: 'DORA',
      cell: (item) =>
        (item.dora || [])
          .filter((metric) => metric.key === 'change_failure_rate')
          .map((metric) => (
            <span key={metric.key}>{doraText(metric)}</span>
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
    { id: 'gaps', header: 'Fix gaps', cell: (item) => <GapLinks item={item} /> },
  ];
}

function buildDevopsColumns(): DataTableColumn<ScorecardRow>[] {
  return [
    {
      id: 'service',
      header: 'Service',
      cell: (item) => (
        <>
          <Link className="ig-cell-link" href={serviceHref(item)}>
            <strong>{item.service}</strong>
          </Link>
          <div className="portal-surface__subtitle">{item.team || item.project_name || item.environment || '—'}</div>
        </>
      ),
    },
    { id: 'score', header: 'Score', cell: (item) => scoreText(item) },
    {
      id: 'dora',
      header: 'DORA',
      cell: (item) =>
        (item.dora || [])
          .filter((metric) => metric.key === 'change_failure_rate' || metric.key === 'deploy_frequency')
          .map((metric) => (
            <div key={metric.key}>
              {metric.label}: {metric.band === 'none' || metric.band === '' ? 'Unknown' : `${metric.value} ${metric.unit} (${metric.band})`}
            </div>
          )),
    },
    {
      id: 'checks',
      header: 'Checks',
      cell: (item) =>
        (item.checks || []).map((check) => (
          <div key={check.key}>
            {checkState(check)} · {check.label}
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
    { id: 'gaps', header: 'Fix gaps', cell: (item) => <GapLinks item={item} /> },
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
    { id: 'score', header: 'Score', cell: (item) => scoreText(item) },
    { id: 'incidents', header: 'Incidents', cell: (item) => String(item.open_incidents) },
    {
      id: 'dora',
      header: 'DORA',
      cell: (item) =>
        (item.dora || [])
          .filter((metric) => metric.key === 'change_failure_rate')
          .map((metric) => (
            <span key={metric.key}>{doraText(metric)}</span>
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
    { id: 'gaps', header: 'Fix gaps', cell: (item) => <GapLinks item={item} /> },
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
