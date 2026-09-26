import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  DataTable,
  PageHeader,
  WORKSPACE_SCOPE_EVENT,
  portalFetch,
  queryString,
  readWorkspaceScope,
  type DataTableColumn,
} from '@infragate/ui';

interface OperatorEvent {
  id: number;
  actor_username?: string;
  team_slug?: string;
  project_id?: number;
  project_name?: string;
  project_code?: string;
  environment?: string;
  resource_type: string;
  resource_id: string;
  action: string;
  result: string;
  summary?: string;
  created_at: string;
}

const DEVOPS_TOKEN_KEY = 'devops_token';

function resultChip(result: string) {
  const tone =
    result === 'success' ? 'ok' : result === 'blocked' ? 'medium' : result === 'failed' ? 'danger' : 'neutral';
  return <span className={`ig-chip ig-chip--${tone}`}>{result || 'unknown'}</span>;
}

function resourceHref(row: OperatorEvent): string | null {
  if (row.resource_type === 'pr_request' && row.resource_id) {
    return `/tickets?request_id=${encodeURIComponent(row.resource_id)}`;
  }
  if (row.resource_type === 'cloud_account' && row.resource_id) {
    return `/cloud-accounts/${encodeURIComponent(row.resource_id)}`;
  }
  return null;
}

export default function OperatorActivityPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [rows, setRows] = useState<OperatorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scopeTick, setScopeTick] = useState(0);
  const scope = readWorkspaceScope();
  const projectFilter = queryString(router.query, 'project_id') || scope.projectId;
  const environmentFilter = queryString(router.query, 'environment') || scope.environment;

  useEffect(() => {
    const onScope = () => setScopeTick((value) => value + 1);
    window.addEventListener(WORKSPACE_SCOPE_EVENT, onScope);
    return () => window.removeEventListener(WORKSPACE_SCOPE_EVENT, onScope);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: '100' });
    if (projectFilter) params.set('project_id', projectFilter);
    if (environmentFilter) params.set('environment', environmentFilter);
    portalFetch(`${apiUrl}/api/devops/operator-activity?${params}`, { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          router.replace('/login');
          return;
        }
        if (!res.ok) throw new Error(data?.error || 'Failed to load activity');
        setRows(Array.isArray(data.events) ? data.events : []);
      })
      .catch((err) => {
        setRows([]);
        setError(err instanceof Error ? err.message : 'Failed to load activity');
      })
      .finally(() => setLoading(false));
  }, [apiUrl, router, projectFilter, environmentFilter, scopeTick]);

  const columns: DataTableColumn<OperatorEvent>[] = useMemo(
    () => [
      {
        id: 'when',
        header: 'When',
        cell: (row: OperatorEvent) => new Date(row.created_at).toLocaleString(),
      },
      {
        id: 'actor',
        header: 'Actor',
        cell: (row: OperatorEvent) => row.actor_username || '—',
      },
      {
        id: 'action',
        header: 'Action',
        cell: (row: OperatorEvent) => <code className="ig-mono">{row.action}</code>,
      },
      { id: 'result', header: 'Result', cell: (row: OperatorEvent) => resultChip(row.result) },
      {
        id: 'scope',
        header: 'Scope',
        cell: (row: OperatorEvent) => {
          const parts = [
            row.project_name ? (row.project_code ? `${row.project_name} (${row.project_code})` : row.project_name) : '',
            row.environment,
            row.team_slug,
          ].filter(Boolean);
          return parts.length ? parts.join(' · ') : '—';
        },
      },
      {
        id: 'resource',
        header: 'Resource',
        cell: (row: OperatorEvent) => {
          const label = `${row.resource_type}/${row.resource_id}`;
          const href = resourceHref(row);
          return href ? (
            <Link href={href} className="ig-link">
              {label}
            </Link>
          ) : (
            <span className="ig-mono">{label}</span>
          );
        },
      },
      {
        id: 'summary',
        header: 'Summary',
        cell: (row: OperatorEvent) => row.summary || '—',
      },
    ],
    [],
  );

  return (
    <DevOpsLayout>
      <Head>
        <title>Operator activity · SetuOps DevOps</title>
      </Head>
      <PageHeader
        eyebrow="ITSM"
        title="Operator activity"
        subtitle="Append-only trail of DevOps writes — approve, promote, rollback, K8s, cloud onboard, templates. Scoped by header project/environment when set."
      />
      {(projectFilter || environmentFilter) && (
        <p className="ig-page-lead">
          Filtered by scope
          {projectFilter ? (
            <>
              {' '}
              project <strong>{projectFilter}</strong>
            </>
          ) : null}
          {environmentFilter ? (
            <>
              {' '}
              env <strong>{environmentFilter}</strong>
            </>
          ) : null}
          . Clear scope in the header to see all accessible events.
        </p>
      )}
      {error ? <p className="ig-alert ig-alert--danger">{error}</p> : null}
      <DataTable<OperatorEvent>
        columns={columns}
        rows={rows}
        rowKey={(row) => String(row.id)}
        label="Operator activity"
        loading={loading}
        empty={<p className="ig-muted">No operator events for your current scope.</p>}
      />
    </DevOpsLayout>
  );
}
