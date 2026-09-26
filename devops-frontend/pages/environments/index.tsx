import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { DataTable, PageHeader, portalFetch, queryString, readWorkspaceScope, type DataTableColumn } from '@infragate/ui';

interface EnvironmentCatalogRow {
  project_id: number;
  project_name: string;
  project_code?: string;
  name: string;
  env_type: string;
  cloud_account_id?: number | null;
  cloud_account_label?: string;
  cloud_provider?: string;
  default_region?: string;
  default_cluster?: string;
  owners?: string[];
  frozen?: boolean;
  freeze_reason?: string;
}

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

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
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [isManager, setIsManager] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [editEnvType, setEditEnvType] = useState('');
  const [editRegion, setEditRegion] = useState('');
  const [editCluster, setEditCluster] = useState('');
  const [editOwners, setEditOwners] = useState('');
  const [editCloudAccountId, setEditCloudAccountId] = useState('');
  const projectFilter = queryString(router.query, 'project_id') || readWorkspaceScope().projectId;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DEVOPS_USER_KEY);
      const parsed = raw ? (JSON.parse(raw) as { devops_profile?: { is_manager?: boolean } }) : null;
      setIsManager(Boolean(parsed?.devops_profile?.is_manager));
    } catch {
      setIsManager(false);
    }
  }, []);

  const loadCatalog = useCallback(() => {
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
  }, [apiUrl, projectFilter, router]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

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

  const rowKey = (row: EnvironmentCatalogRow) => `${row.project_id}-${row.name}`;

  const startEdit = (row: EnvironmentCatalogRow) => {
    setEditingKey(rowKey(row));
    setEditEnvType(row.env_type || '');
    setEditRegion(row.default_region || '');
    setEditCluster(row.default_cluster || '');
    setEditOwners((row.owners || []).join(', '));
    setEditCloudAccountId(row.cloud_account_id ? String(row.cloud_account_id) : '');
    setNotice('');
    setError('');
  };

  const cancelEdit = () => {
    setEditingKey('');
  };

  const saveEdit = async (row: EnvironmentCatalogRow) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    const owners = editOwners
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const cloudParsed = Number.parseInt(editCloudAccountId, 10);
    const body: Record<string, unknown> = {
      project_id: row.project_id,
      environment: row.name,
      env_type: editEnvType.trim(),
      default_region: editRegion.trim(),
      default_cluster_name: editCluster.trim(),
      owners,
    };
    if (Number.isFinite(cloudParsed) && cloudParsed > 0) {
      body.cloud_account_id = cloudParsed;
    } else if (editCloudAccountId.trim() === '0') {
      body.clear_cloud_account = true;
    }
    try {
      const res = await portalFetch(`${apiUrl}/api/devops/environment-catalog`, {
        token,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to update environment metadata');
      setNotice(`Updated catalog metadata for ${row.name} (${row.project_name}).`);
      setEditingKey('');
      loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update environment metadata');
    } finally {
      setSaving(false);
    }
  };

  const columns: DataTableColumn<EnvironmentCatalogRow>[] = [
    {
      id: 'project',
      header: 'Project',
      cell: (row: EnvironmentCatalogRow) => (
        <Link href={`/projects/${row.project_id}`} className="ig-cell-link">
          {row.project_name}
          {row.project_code ? ` (${row.project_code})` : ''}
        </Link>
      ),
    },
    { id: 'name', header: 'Environment', cell: (row: EnvironmentCatalogRow) => <strong>{row.name}</strong> },
    { id: 'env_type', header: 'Type', cell: (row: EnvironmentCatalogRow) => row.env_type || '—' },
    {
      id: 'cloud',
      header: 'Cloud account',
      cell: (row: EnvironmentCatalogRow) =>
        row.cloud_account_label ? (
          <span>
            {row.cloud_provider ? `${row.cloud_provider.toUpperCase()} · ` : ''}
            {row.cloud_account_label}
          </span>
        ) : (
          '—'
        ),
    },
    {
      id: 'cluster',
      header: 'Default cluster',
      cell: (row: EnvironmentCatalogRow) => row.default_cluster || '—',
    },
    { id: 'region', header: 'Region', cell: (row: EnvironmentCatalogRow) => row.default_region || '—' },
    {
      id: 'owners',
      header: 'Owners',
      cell: (row: EnvironmentCatalogRow) => (row.owners?.length ? row.owners.join(', ') : '—'),
    },
    { id: 'freeze', header: 'Freeze', cell: freezeCell },
  ];

  if (isManager) {
    columns.push({
      id: 'edit',
      header: '',
      cell: (row: EnvironmentCatalogRow) => (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(row)}>
          Edit metadata
        </button>
      ),
    });
  }

  const editingRow = editingKey ? visible.find((row) => rowKey(row) === editingKey) || null : null;

  return (
    <DevOpsLayout>
      <Head>
        <title>Environment catalog · SetuOps DevOps</title>
      </Head>
      <PageHeader
        eyebrow="Projects"
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
      {notice ? <p className="ig-alert ig-alert--success">{notice}</p> : null}
      {editingRow ? (
        <section className="portal-surface" style={{ marginBottom: 16 }}>
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Manager edit</span>
              <h2 className="portal-surface__title">
                {editingRow.name} · {editingRow.project_name}
              </h2>
              <p className="portal-surface__subtitle">
                Override catalog metadata. Cloud account and cluster links still respect onboarded NF-01 / NF-02 records.
              </p>
            </div>
          </div>
          <div className="portal-form-grid">
            <label className="label">
              Type
              <select className="input" value={editEnvType} onChange={(e) => setEditEnvType(e.target.value)}>
                <option value="">Infer from name</option>
                <option value="dev">dev</option>
                <option value="uat">uat</option>
                <option value="prod">prod</option>
                <option value="preview">preview</option>
                <option value="other">other</option>
              </select>
            </label>
            <label className="label">
              Default region
              <input className="input" value={editRegion} onChange={(e) => setEditRegion(e.target.value)} />
            </label>
            <label className="label">
              Default cluster override
              <input className="input" value={editCluster} onChange={(e) => setEditCluster(e.target.value)} />
            </label>
            <label className="label">
              Cloud account id (NF-01)
              <input
                className="input"
                value={editCloudAccountId}
                onChange={(e) => setEditCloudAccountId(e.target.value)}
                placeholder="Optional id · enter 0 to clear explicit link"
              />
            </label>
            <label className="label" style={{ gridColumn: '1 / -1' }}>
              Owners (comma-separated)
              <input className="input" value={editOwners} onChange={(e) => setEditOwners(e.target.value)} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveEdit(editingRow)}>
              {saving ? 'Saving…' : 'Save metadata'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={cancelEdit}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}
      <DataTable<EnvironmentCatalogRow>
        columns={columns}
        rows={visible}
        rowKey={rowKey}
        label="Environment catalog"
        loading={loading}
        empty={<p className="ig-muted">No environments match your access.</p>}
      />
    </DevOpsLayout>
  );
}
