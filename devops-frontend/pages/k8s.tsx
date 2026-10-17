import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import K8sWorkspaceShell from '../components/K8sWorkspaceShell';
import { useApiUrl } from '../context/ApiUrlContext';
import {
  buildK8sHref,
  fetchK8sClusters,
  formatDateTime,
  K8sClusterListItem,
  K8sClustersData,
  readQueryString,
} from '../lib/k8sWorkspace';

function cloudPillClass(cloud: string): string {
  const value = cloud.toLowerCase();
  if (value.includes('aws')) return 'k8s-data-pill is-aws';
  if (value.includes('azure')) return 'k8s-data-pill is-azure';
  if (value.includes('gcp') || value.includes('google')) return 'k8s-data-pill is-gcp';
  return 'k8s-data-pill';
}

function environmentPillClass(environment: string): string {
  const value = environment.toLowerCase();
  if (value.includes('prod')) return 'k8s-data-pill is-prod';
  if (value.includes('uat') || value.includes('stage')) return 'k8s-data-pill is-uat';
  if (value.includes('dev')) return 'k8s-data-pill is-dev';
  return 'k8s-data-pill';
}

function healthLabel(status: string): string {
  return status.trim() || 'Unknown';
}

function healthPillClass(status: string): string {
  const value = status.trim().toLowerCase();
  if (!value) return 'k8s-data-pill is-unknown';
  if (value.includes('unhealthy') || value.includes('down') || value.includes('fail') || value.includes('critical')) {
    return 'k8s-data-pill k8s-data-pill--critical';
  }
  if (value.includes('degrad') || value.includes('warn')) return 'k8s-data-pill k8s-data-pill--warning';
  if (value === 'healthy' || value === 'ok' || value === 'ready') return 'k8s-data-pill k8s-data-pill--healthy';
  return 'k8s-data-pill is-unknown';
}

function matchesClusterSearch(item: K8sClusterListItem, query: string) {
  if (!query) return true;
  const haystack = [
    item.cluster_name,
    item.cluster_endpoint,
    item.project_name,
    item.project_code,
    item.cloud,
    item.environment,
    item.auth_mode,
    item.node_pool,
    item.kubernetes_version,
    item.location,
    item.health_status,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

export default function DevOpsK8sClustersPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [catalog, setCatalog] = useState<K8sClustersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectId, setProjectId] = useState('');
  const [cloud, setCloud] = useState('');
  const [environment, setEnvironment] = useState('');
  const [search, setSearch] = useState('');

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

    fetchK8sClusters(apiUrl, {
      project_id: projectId || undefined,
      environment: environment || undefined,
    })
      .then((data) => {
        if (!active) return;
        setCatalog(data);
      })
      .catch((err) => {
        if (!active) return;
        setCatalog(null);
        setError(err instanceof Error ? err.message : 'Failed to load K8s clusters');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [apiUrl, environment, projectId, refreshKey, router.isReady]);

  const clusterCatalog = catalog?.items || [];
  const projectOptions = catalog?.projects || [];
  const cloudOptions = useMemo(
    () => Array.from(new Set(clusterCatalog.map((item) => item.cloud).filter(Boolean))).sort(),
    [clusterCatalog],
  );
  const environmentOptions = useMemo(
    () => Array.from(new Set(clusterCatalog.map((item) => item.environment).filter(Boolean))).sort(),
    [clusterCatalog],
  );
  const visibleClusters = useMemo(() => {
    const query = search.trim().toLowerCase();
    return clusterCatalog.filter((item) => {
      if (projectId && String(item.project_id) !== projectId) return false;
      if (cloud && item.cloud !== cloud) return false;
      if (environment && item.environment !== environment) return false;
      return matchesClusterSearch(item, query);
    });
  }, [cloud, clusterCatalog, environment, projectId, search]);

  const summary = useMemo(
    () => ({
      clusters: visibleClusters.length,
      namespaces: visibleClusters.reduce((sum, item) => sum + item.namespace_count, 0),
      workloads: visibleClusters.reduce((sum, item) => sum + item.workload_count, 0),
      services: visibleClusters.reduce((sum, item) => sum + item.service_count, 0),
      storage: visibleClusters.reduce((sum, item) => sum + item.storage_count, 0),
    }),
    [visibleClusters],
  );

  return (
    <>
      <Head>
        <title>K8s Clusters - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="K8s Clusters"
          subtitle="Browse onboarded Kubernetes clusters, filter the list quickly, and move straight into workloads, services, configmaps, or storage."
          queryState={{ project_id: projectId, environment }}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((value) => value + 1)}>
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              {catalog?.k8s_access === 'write' ? (
                <Link href={buildK8sHref('/k8s/onboard/new', { project_id: projectId, environment })} className="btn btn-primary">
                  Onboard cluster
                </Link>
              ) : null}
            </>
          }
        >
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Cluster inventory</span>
                <h2 className="portal-surface__title">Onboarded K8s clusters</h2>
                <p className="portal-surface__subtitle">
                  Select a cluster to open its workload view. Filters stay compact so the cluster table remains the main focus.
                </p>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card is-clusters">
                <span className="k8s-summary-card__label">Clusters</span>
                <strong className="k8s-summary-card__value">{summary.clusters}</strong>
              </div>
              <div className="k8s-summary-card is-namespaces">
                <span className="k8s-summary-card__label">Namespaces</span>
                <strong className="k8s-summary-card__value">{summary.namespaces}</strong>
              </div>
              <div className="k8s-summary-card is-workloads">
                <span className="k8s-summary-card__label">Workloads</span>
                <strong className="k8s-summary-card__value">{summary.workloads}</strong>
              </div>
              <div className="k8s-summary-card is-services">
                <span className="k8s-summary-card__label">Services</span>
                <strong className="k8s-summary-card__value">{summary.services}</strong>
              </div>
              <div className="k8s-summary-card is-storage">
                <span className="k8s-summary-card__label">Storage</span>
                <strong className="k8s-summary-card__value">{summary.storage}</strong>
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
                  {projectOptions.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} ({project.code})
                    </option>
                  ))}
                </select>
              </label>

              <label className="k8s-filterbar__field">
                <span className="k8s-filterbar__label">Cloud</span>
                <select className="input k8s-filterbar__input" value={cloud} onChange={(event) => setCloud(event.target.value)}>
                  <option value="">All clouds</option>
                  {cloudOptions.map((item) => (
                    <option key={item} value={item}>
                      {item.toUpperCase()}
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
                <span className="portal-pill">{visibleClusters.length} visible</span>
                {(search || projectId || cloud || environment) ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setSearch('');
                      setProjectId('');
                      setCloud('');
                      setEnvironment('');
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>

            {error ? (
              <div className="portal-table-state portal-table-state--error">
                <div className="portal-table-state__icon" aria-hidden>!</div>
                <h3 className="portal-table-state__title">We couldn’t load K8s clusters</h3>
                <p className="portal-table-state__copy">{error}</p>
                <div className="portal-table-state__actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((value) => value + 1)}>
                    Try again
                  </button>
                </div>
              </div>
            ) : visibleClusters.length === 0 ? (
              <div className="portal-table-state portal-table-state--empty">
                <div className="portal-table-state__icon" aria-hidden>⋯</div>
                <h3 className="portal-table-state__title">No K8s clusters match the current filters</h3>
                <p className="portal-table-state__copy">
                  Clear the current filters or onboard a new cluster to start building this workspace.
                </p>
                <div className="portal-table-state__actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setSearch('');
                      setProjectId('');
                      setCloud('');
                      setEnvironment('');
                    }}
                  >
                    Clear filters
                  </button>
                  {catalog?.k8s_access === 'write' ? (
                    <Link href={buildK8sHref('/k8s/onboard/new', { project_id: projectId, environment })} className="btn btn-primary">
                      Onboard cluster
                    </Link>
                  ) : null}
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
                      <th>Health</th>
                      <th>Version</th>
                      <th>Node pool</th>
                      <th>Nodes</th>
                      <th>Namespaces</th>
                      <th>Workloads</th>
                      <th>Services</th>
                      <th>ConfigMaps</th>
                      <th>Storage</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleClusters.map((cluster) => (
                      <tr key={`${cluster.project_id}-${cluster.cloud}-${cluster.cluster_name}-${cluster.environment}`}>
                        <td>
                          <Link
                            href={buildK8sHref('/k8s/workspace', {
                              project_id: cluster.project_id,
                              cluster_name: cluster.cluster_name,
                              environment: cluster.environment,
                            })}
                            className="k8s-link-cell"
                          >
                            <span className="k8s-link-cell__title">{cluster.cluster_name}</span>
                            <span className="k8s-link-cell__meta">
                              {cluster.cluster_endpoint || `${cluster.project_code}/${cluster.cloud}/${cluster.environment}`}
                            </span>
                          </Link>
                        </td>
                        <td>
                          <div className="k8s-link-cell">
                            <span className="k8s-link-cell__title">{cluster.project_name}</span>
                            <span className="k8s-link-cell__meta">{cluster.project_code}</span>
                          </div>
                        </td>
                        <td><span className={cloudPillClass(cluster.cloud)}>{cluster.cloud.toUpperCase()}</span></td>
                        <td><span className={environmentPillClass(cluster.environment)}>{cluster.environment.toUpperCase()}</span></td>
                        <td><span className={healthPillClass(cluster.health_status)}>{healthLabel(cluster.health_status)}</span></td>
                        <td>{cluster.kubernetes_version || 'Unknown'}</td>
                        <td>{cluster.node_pool || 'Unknown'}</td>
                        <td>{cluster.node_count == null ? 'Unknown' : cluster.node_count}</td>
                        <td>{cluster.namespace_count}</td>
                        <td>{cluster.workload_count}</td>
                        <td>{cluster.service_count}</td>
                        <td>{cluster.configmap_count}</td>
                        <td>{cluster.storage_count}</td>
                        <td>{formatDateTime(cluster.updated_at)}</td>
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
