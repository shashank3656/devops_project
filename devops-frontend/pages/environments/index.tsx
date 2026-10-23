import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  cloudAccountDetailHref,
  inventoryListHref,
} from '../../lib/cloudCatalogLinks';
import { portalFetch, queryString } from '@infragate/ui';
import { isMonitoredEnvironment } from '../../lib/sreMonitoring';

interface EnvironmentCatalogRow {
  project_id: number;
  project_name: string;
  project_code?: string;
  name: string;
  env_type: string;
  cloud_account_id?: number | null;
  cloud_account_label?: string;
  cloud_account_external_id?: string;
  cloud_provider?: string;
  default_region?: string;
  default_cluster?: string;
  owners?: string[];
  frozen?: boolean;
  freeze_reason?: string;
}

interface ProjectFolder {
  id: number;
  name: string;
  code: string;
  environments: EnvironmentCatalogRow[];
}

function known(value: string | undefined): string {
  const text = (value || '').trim();
  return text || 'Unknown';
}

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

function freezeCell(row: EnvironmentCatalogRow) {
  if (typeof row.frozen !== 'boolean') {
    return <span className="ig-chip">Unknown</span>;
  }
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
  const [projects, setProjects] = useState<Array<{ id: number; name: string; code: string; environments: string[] }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [environmentFilter, setEnvironmentFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [isManager, setIsManager] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [editEnvType, setEditEnvType] = useState('');
  const [editRegion, setEditRegion] = useState('');
  const [editCluster, setEditCluster] = useState('');
  const [editOwners, setEditOwners] = useState('');
  const [editCloudAccountId, setEditCloudAccountId] = useState('');
  const projectFilter = router.isReady ? queryString(router.query, 'project_id') : '';
  const envHighlight = queryString(router.query, 'env');

  useEffect(() => {
    if (envHighlight) setEnvironmentFilter(envHighlight);
  }, [envHighlight]);

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
    Promise.all([
      portalFetch(`${apiUrl}/api/devops/environment-catalog`, { token }),
      portalFetch(`${apiUrl}/api/devops/projects`, { token }),
    ])
      .then(async ([catalogRes, projectsRes]) => {
        if (catalogRes.status === 401 || projectsRes.status === 401) {
          router.replace('/login');
          return;
        }
        const data = await catalogRes.json().catch(() => ({}));
        const projectData = await projectsRes.json().catch(() => ({}));
        if (!catalogRes.ok) throw new Error(data?.error || 'Failed to load environment catalog');
        setRows(Array.isArray(data.environments) ? data.environments : []);
        const list = Array.isArray(projectData?.projects) ? projectData.projects : [];
        setProjects(
          list
            .map((item: { id?: number; name?: string; code?: string; environments?: string[] }) => ({
              id: typeof item.id === 'number' ? item.id : 0,
              name: String(item.name || ''),
              code: String(item.code || ''),
              environments: Array.isArray(item.environments) ? item.environments.map((value) => String(value)) : [],
            }))
            .filter((item: { id: number }) => item.id > 0),
        );
      })
      .catch((err) => {
        setRows([]);
        setError(err instanceof Error ? err.message : 'Failed to load environment catalog');
      })
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

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

  const folders = useMemo(() => {
    const byId = new Map<number, ProjectFolder>();
    projects.forEach((project) => {
      const names = project.environments.map((item) => item.trim()).filter(Boolean);
      byId.set(project.id, {
        id: project.id,
        name: known(project.name || project.code),
        code: project.code.trim(),
        environments: names.map((name) => ({
          project_id: project.id,
          project_name: known(project.name || project.code),
          project_code: project.code,
          name,
          env_type: '',
        })),
      });
    });
    rows.forEach((row) => {
      const id = row.project_id > 0 ? row.project_id : 0;
      if (!id) return;
      const folder = byId.get(id) || {
        id,
        name: known(row.project_name || row.project_code),
        code: (row.project_code || '').trim(),
        environments: [],
      };
      const index = folder.environments.findIndex((item) => item.name.toLowerCase() === row.name.toLowerCase());
      if (index >= 0) folder.environments[index] = row;
      else folder.environments.push(row);
      byId.set(id, folder);
    });
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [projects, rows]);

  const needle = query.trim().toLowerCase();
  const environmentOptions = useMemo(() => {
    const source = projectFilter ? folders.filter((folder) => String(folder.id) === projectFilter) : folders;
    const names = new Set<string>();
    source.forEach((folder) => folder.environments.forEach((row) => {
      const name = row.name.trim();
      if (name) names.add(name);
    }));
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [folders, projectFilter]);
  const typeOptions = useMemo(() => {
    const names = new Set<string>(['dev', 'uat', 'prod', 'preview', 'other']);
    folders.forEach((folder) => folder.environments.forEach((row) => {
      const type = row.env_type.trim().toLowerCase();
      if (type) names.add(type);
    }));
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [folders]);

  const matchesFilters = (row: EnvironmentCatalogRow) => {
    if (environmentFilter && row.name.toLowerCase() !== environmentFilter.toLowerCase()) return false;
    if (typeFilter && row.env_type.trim().toLowerCase() !== typeFilter.toLowerCase()) return false;
    if (!needle) return true;
    const haystack = [row.name, row.env_type, row.cloud_account_label, row.default_cluster, row.default_region, ...(row.owners || [])]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  };
  const visibleFolders = folders.filter((folder) => {
    const nameHit = Boolean(needle) && `${folder.name} ${folder.code}`.toLowerCase().includes(needle);
    if (!needle && !environmentFilter && !typeFilter) return true;
    if (nameHit && !environmentFilter && !typeFilter) return true;
    return folder.environments.some((row) => matchesFilters(row));
  });
  const currentFolder = folders.find((folder) => projectFilter && String(folder.id) === projectFilter) || null;
  const visibleEnvironments = (currentFolder?.environments || []).filter((row) => matchesFilters(row));
  const filtering = Boolean(needle || projectFilter || environmentFilter || typeFilter);

  const openProject = (projectId: string) => {
    setEnvironmentFilter('');
    void router.push(projectId ? `/environments?project_id=${projectId}` : '/environments');
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    if (!needle) return;
    if (!projectFilter) {
      const first = visibleFolders[0];
      if (first) void router.push(`/environments?project_id=${first.id}`);
      return;
    }
    const first = visibleEnvironments[0];
    if (first) {
      void router.push(isMonitoredEnvironment(first.name)
        ? `/services?project_id=${first.project_id}`
        : `/environments?project_id=${first.project_id}`);
    }
  };

  const clearFilters = () => {
    setQuery('');
    setEnvironmentFilter('');
    setTypeFilter('');
    void router.push('/environments');
  };

  const editingRow = editingKey ? visibleEnvironments.find((row) => rowKey(row) === editingKey) || null : null;

  return (
    <DevOpsLayout>
      <Head>
        <title>Environment catalog · OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Projects</span>
            <h1 className="portal-page__title">{currentFolder ? currentFolder.name : 'Environments'}</h1>
            <p className="portal-page__subtitle">
              Open a project to see its environments, then open an environment to see its services.
            </p>
          </div>
        </div>
        <section className="portal-surface">
          {projectFilter ? (
            <nav className="svc-crumb" aria-label="Location">
              <Link href="/environments">Projects</Link>
              <span aria-hidden="true">/</span>
              <span>{currentFolder?.name || 'Unknown'}</span>
            </nav>
          ) : null}
          <form onSubmit={search}>
            <div className="svc-filters">
              <label>
                Search
                <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Project, environment, or region" />
              </label>
              <label>
                Project
                <select className="input" value={projectFilter} onChange={(event) => openProject(event.target.value)}>
                  <option value="">All projects</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.code ? `${folder.name} (${folder.code})` : folder.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Environment
                <select className="input" value={environmentFilter} onChange={(event) => setEnvironmentFilter(event.target.value)}>
                  <option value="">All environments</option>
                  {environmentOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                Type
                <select className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                  <option value="">All types</option>
                  {typeOptions.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>
              <div className="svc-filters__actions">
                <button type="submit" className="btn btn-primary">Search</button>
                {filtering ? (
                  <button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear</button>
                ) : null}
              </div>
            </div>
          </form>
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
          {loading ? <div className="empty-state">Loading environments...</div> : null}
          {!loading && !projectFilter && !visibleFolders.length ? <div className="empty-state">{filtering ? 'No projects match these filters.' : 'No projects are visible for this scope.'}</div> : null}
          {!loading && projectFilter && !currentFolder ? <div className="empty-state">No environments on this project.</div> : null}
          {!loading && !projectFilter && visibleFolders.length ? (
            <ul className="svc-tree">
              {visibleFolders.map((folder) => (
                <li key={folder.id}>
                  <Link className="svc-tree__folder" href={`/environments?project_id=${folder.id}`}>
                    <span>{folder.code ? `${folder.name} (${folder.code})` : folder.name}</span>
                    <small>{folder.environments.length} {folder.environments.length === 1 ? 'environment' : 'environments'}</small>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {!loading && currentFolder ? (
            visibleEnvironments.length ? (
              <ul className="svc-tree">
                {visibleEnvironments.map((row) => (
                  <li key={rowKey(row)} className="svc-tree__row">
                    <Link className="svc-tree__folder" href={isMonitoredEnvironment(row.name) ? `/services?project_id=${row.project_id}` : `/environments?project_id=${row.project_id}`}>
                      <span>
                        {known(row.name)}
                        <small className="svc-tree__meta">
                          {known(row.env_type)} · {row.cloud_account_label || 'Unknown cloud account'} · {row.default_cluster || 'Unknown cluster'} · {row.default_region || 'Unknown region'}
                        </small>
                      </span>
                      {freezeCell(row)}
                    </Link>
                    {row.cloud_account_id ? (
                      <Link href={cloudAccountDetailHref(row.cloud_account_id)} className="btn btn-secondary btn-sm">Account</Link>
                    ) : null}
                    {row.cloud_account_external_id ? (
                      <Link
                        href={inventoryListHref({
                          cloud: row.cloud_provider,
                          accountId: row.cloud_account_external_id,
                          projectId: String(row.project_id),
                          environment: row.name,
                        })}
                        className="btn btn-secondary btn-sm"
                      >
                        Inventory
                      </Link>
                    ) : null}
                    {isManager ? (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(row)}>
                        Edit metadata
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <div className="empty-state">{filtering ? 'No environments match these filters.' : 'No environments on this project.'}</div>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
