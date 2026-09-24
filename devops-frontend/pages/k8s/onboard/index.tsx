import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import K8sWorkspaceShell from '../../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../../context/ApiUrlContext';
import {
  buildK8sHref,
  fetchK8sConnections,
  formatDateTime,
  K8sOnboardingData,
  readQueryString,
} from '../../../lib/k8sWorkspace';

function matchesConnectionSearch(item: K8sOnboardingData['connections'][number], query: string) {
  if (!query) return true;
  const haystack = [
    item.cluster_name,
    item.cluster_endpoint,
    item.project_name,
    item.project_code,
    item.cloud,
    item.environment,
    item.auth_mode,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

export default function DevOpsK8sOnboardCatalogPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [data, setData] = useState<K8sOnboardingData>({ projects: [], connections: [], auth_modes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const [environment, setEnvironment] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    setProjectId(readQueryString(router.query.project_id));
    setEnvironment(readQueryString(router.query.environment));
  }, [router.isReady, router.query.environment, router.query.project_id]);

  useEffect(() => {
    if (!router.isReady) return;
    let active = true;
    setLoading(true);
    setError('');

    fetchK8sConnections(apiUrl)
      .then((payload) => {
        if (!active) return;
        setData(payload);
      })
      .catch((err) => {
        if (!active) return;
        setData({ projects: [], connections: [], auth_modes: [] });
        setError(err instanceof Error ? err.message : 'Failed to load cluster connections');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [apiUrl, refreshKey, router.isReady]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.connections.filter((item) => {
      if (projectId && String(item.project_id) !== projectId) return false;
      if (environment && item.environment !== environment) return false;
      return matchesConnectionSearch(item, query);
    });
  }, [data.connections, environment, projectId, search]);

  const environmentOptions = useMemo(
    () => Array.from(new Set(data.connections.map((item) => item.environment).filter(Boolean))).sort(),
    [data.connections],
  );
  const configuredCount = data.connections.filter((item) => item.has_auth_credential).length;
  const formHref = buildK8sHref('/k8s/onboard/new', {
    project_id: projectId,
    environment,
  });

  return (
    <>
      <Head>
        <title>K8s connections - DevOps</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Cluster connections"
          subtitle="Registered Kubernetes access mappings. Open a row to work the cluster, or onboard a new one."
          queryState={{ project_id: projectId, environment }}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((value) => value + 1)}>
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <Link href={formHref} className="btn btn-primary">
                Onboard cluster
              </Link>
            </>
          }
        >
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Connection inventory</span>
                <h2 className="portal-surface__title">Onboarded cluster access</h2>
                <p className="portal-surface__subtitle">
                  Same pattern as the cluster list: browse what is already connected, then use Onboard when you need a new mapping.
                </p>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Connections</span>
                <strong className="k8s-summary-card__value">{visible.length}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Configured</span>
                <strong className="k8s-summary-card__value">{configuredCount}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Missing credential</span>
                <strong className="k8s-summary-card__value">{data.connections.length - configuredCount}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Projects</span>
                <strong className="k8s-summary-card__value">{data.projects.length}</strong>
              </div>
            </div>

            <div className="k8s-filterbar">
              <label className="k8s-filterbar__field k8s-filterbar__field--search">
                <span className="k8s-filterbar__label">Search</span>
                <input
                  className="input k8s-filterbar__input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search cluster, endpoint, or project"
                />
              </label>
              <label className="k8s-filterbar__field">
                <span className="k8s-filterbar__label">Project</span>
                <select className="input k8s-filterbar__input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">All projects</option>
                  {data.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} ({project.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="k8s-filterbar__field">
                <span className="k8s-filterbar__label">Environment</span>
                <select
                  className="input k8s-filterbar__input"
                  value={environment}
                  onChange={(event) => setEnvironment(event.target.value)}
                >
                  <option value="">All environments</option>
                  {environmentOptions.map((item) => (
                    <option key={item} value={item}>
                      {item.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <div className="k8s-filterbar__actions">
                <span className="portal-pill">{visible.length} visible</span>
              </div>
            </div>

            {error ? (
              <div className="portal-table-state portal-table-state--error">
                <div className="portal-table-state__icon" aria-hidden>
                  !
                </div>
                <h3 className="portal-table-state__title">We could not load cluster connections</h3>
                <p className="portal-table-state__copy">{error}</p>
                <div className="portal-table-state__actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((value) => value + 1)}>
                    Try again
                  </button>
                </div>
              </div>
            ) : loading ? (
              <div className="portal-empty">
                <p>Loading registered clusters...</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="portal-table-state portal-table-state--empty">
                <div className="portal-table-state__icon" aria-hidden>
                  ⋯
                </div>
                <h3 className="portal-table-state__title">
                  {data.connections.length === 0 ? 'No cluster connections yet' : 'No connections match the current filters'}
                </h3>
                <p className="portal-table-state__copy">
                  {data.connections.length === 0
                    ? 'Onboard a cluster to map a project to Kubernetes access. The form opens on its own page.'
                    : 'Clear the current filters or onboard another cluster.'}
                </p>
                <div className="portal-table-state__actions">
                  {data.connections.length > 0 ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setSearch('');
                        setProjectId('');
                        setEnvironment('');
                      }}
                    >
                      Clear filters
                    </button>
                  ) : null}
                  <Link href={formHref} className="btn btn-primary">
                    Onboard cluster
                  </Link>
                </div>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="templates-table k8s-data-table">
                  <thead>
                    <tr>
                      <th>K8s cluster</th>
                      <th>Project</th>
                      <th>Cloud</th>
                      <th>Environment</th>
                      <th>Auth mode</th>
                      <th>Credential</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((connection) => (
                      <tr key={connection.id}>
                        <td>
                          <Link
                            href={buildK8sHref('/k8s/workloads', {
                              project_id: connection.project_id,
                              cluster_name: connection.cluster_name,
                              environment: connection.environment,
                            })}
                            className="k8s-link-cell"
                          >
                            <span className="k8s-link-cell__title">{connection.cluster_name}</span>
                            <span className="k8s-link-cell__meta">{connection.cluster_endpoint}</span>
                          </Link>
                        </td>
                        <td>
                          <div className="k8s-link-cell__title">{connection.project_name}</div>
                          <div className="k8s-link-cell__meta">{connection.project_code}</div>
                        </td>
                        <td>
                          <span className="k8s-data-pill">{connection.cloud.toUpperCase()}</span>
                        </td>
                        <td>
                          <span className="portal-pill k8s-data-pill k8s-data-pill--env">{connection.environment.toUpperCase()}</span>
                        </td>
                        <td>{connection.auth_mode}</td>
                        <td>
                          <span className={`ig-chip ig-chip--${connection.has_auth_credential ? 'low' : 'medium'}`}>
                            {connection.has_auth_credential ? 'Configured' : 'Missing'}
                          </span>
                        </td>
                        <td>{formatDateTime(connection.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
