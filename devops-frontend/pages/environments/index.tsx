import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { DataTable, PageHeader, portalFetch, queryString, readWorkspaceScope, type DataTableColumn } from '@infragate/ui';

interface EnvironmentCatalogRow {
  project_id: number;
  project_name: string;
  project_code?: string;
  name: string;
  env_type: string;
  cloud_account_label?: string;
  cloud_provider?: string;
  default_region?: string;
  default_cluster?: string;
  owners?: string[];
  frozen?: boolean;
  freeze_reason?: string;
}

const DEVOPS_TOKEN_KEY = 'devops_token';

function freezeCell(row: EnvironmentCatalogRow) {
  if (!row.frozen) {
    return <span className="ig-chip ig-chip--ok">Clear</span>;
  }
  return (
    <span className="ig-chip ig-chip--danger" title={row.freeze_reason || 'Deployment freeze'}>
      Frozen
    </span>
  );
}

export default function EnvironmentsCatalogPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [rows, setRows] = useState<EnvironmentCatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const projectFilter = queryString(router.query, 'project_id') || readWorkspaceScope().projectId;

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (projectFilter) params.set('project_id', projectFilter);
    const suffix = params.toString() ? `?${params}` : '';
    portalFetch(`${apiUrl}/api/devops/environment-catalog${suffix}`, { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          router.replace('/login');
          return;
        }
        if (!res.ok) throw new Error(data?.error || 'Failed to load environment catalog');
        setRows(Array.isArray(data.environments) ? data.environments : []);
      })
      .catch((err) => {
        setRows([]);
        setError(err instanceof Error ? err.message : 'Failed to load environment catalog');
      })
      .finally(() => setLoading(false));
  }, [apiUrl, router, projectFilter]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const haystack = [
        row.project_name,
        row.project_code,
        row.name,
        row.env_type,
        row.cloud_account_label,
        row.default_cluster,
        row.default_region,
        ...(row.owners || []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query]);

  const columns: DataTableColumn<EnvironmentCatalogRow>[] = [
    {
      key: 'project',
      header: 'Project',
      render: (row) => (
        <Link href={`/projects/${row.project_id}`} className="ig-link">
          {row.project_code ? `${row.project_name} (${row.project_code})` : row.project_name}
        </Link>
      ),
    },
    { key: 'name', header: 'Environment', render: (row) => <strong>{row.name}</strong> },
    { key: 'env_type', header: 'Type', render: (row) => row.env_type || '—' },
    {
      key: 'cloud',
      header: 'Cloud account',
      render: (row) =>
        row.cloud_account_label ? (
          <span>
            {row.cloud_account_label}
            {row.cloud_provider ? ` · ${row.cloud_provider.toUpperCase()}` : ''}
          </span>
        ) : (
          <span className="ig-muted">Not linked</span>
        ),
    },
    {
      key: 'cluster',
      header: 'Cluster',
      render: (row) =>
        row.default_cluster ? (
          <Link href={`/k8s/workspace?cluster_name=${encodeURIComponent(row.default_cluster)}`} className="ig-link">
            {row.default_cluster}
          </Link>
        ) : (
          <span className="ig-muted">—</span>
        ),
    },
    { key: 'region', header: 'Region', render: (row) => row.default_region || '—' },
    { key: 'owners', header: 'Owners', render: (row) => (row.owners?.length ? row.owners.join(', ') : '—') },
    { key: 'freeze', header: 'Freeze', render: freezeCell },
  ];

  return (
    <DevOpsLayout>
      <Head>
        <title>Environment catalog · SetuOps DevOps</title>
      </Head>
      <PageHeader
        title="Environment catalog"
        subtitle="Project environments with cloud account, cluster, and freeze state (NF-03)."
        actions={
          projectFilter ? (
            <Link href="/environments" className="ig-btn ig-btn--secondary">
              Show all projects
            </Link>
          ) : null
        }
      />
      {projectFilter ? (
        <p className="ig-page-lead">
          Filtered to project ID <strong>{projectFilter}</strong>. Change scope in the header or{' '}
          <Link href="/environments" className="ig-link">
            clear the filter
          </Link>
          .
        </p>
      ) : null}
      <div className="ig-filter-bar" style={{ marginBottom: 16 }}>
        <input
          type="search"
          className="ig-input"
          placeholder="Search project, environment, account, cluster…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search environments"
        />
      </div>
      {error ? <p className="ig-alert ig-alert--danger">{error}</p> : null}
      <DataTable columns={columns} rows={visible} loading={loading} emptyMessage="No environments match your access." />
    </DevOpsLayout>
  );
}
