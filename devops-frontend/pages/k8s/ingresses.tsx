import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import K8sWorkspaceShell from '../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../context/ApiUrlContext';
import { buildK8sHref, fetchK8sIngresses, K8sIngressesData, readQueryString } from '../../lib/k8sWorkspace';

function ingressTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'healthy' || normalized === 'ready') return 'k8s-data-pill k8s-data-pill--healthy';
  if (normalized === 'expiring' || normalized === 'warning') return 'k8s-data-pill k8s-data-pill--expiring';
  if (normalized === 'critical' || normalized === 'blocked') return 'k8s-data-pill k8s-data-pill--critical';
  return 'k8s-data-pill';
}

export default function DevOpsK8sIngressesPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [overview, setOverview] = useState<K8sIngressesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectId, setProjectId] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [environment, setEnvironment] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    setProjectId(readQueryString(router.query.project_id));
    setClusterName(readQueryString(router.query.cluster_name));
    setNamespace(readQueryString(router.query.namespace));
    setEnvironment(readQueryString(router.query.environment));
  }, [
    router.isReady,
    router.query.cluster_name,
    router.query.environment,
    router.query.namespace,
    router.query.project_id,
  ]);

  useEffect(() => {
    if (!router.isReady) return;
    let active = true;
    setLoading(true);
    setError('');

    fetchK8sIngresses(apiUrl, {
      project_id: projectId || undefined,
      cluster_name: clusterName || undefined,
      namespace: namespace || undefined,
      environment: environment || undefined,
    })
      .then((data) => {
        if (!active) return;
        setOverview(data);
      })
      .catch((err) => {
        if (!active) return;
        setOverview(null);
        setError(err instanceof Error ? err.message : 'Failed to load ingress routes');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [apiUrl, clusterName, environment, namespace, projectId, refreshKey, router.isReady]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = overview?.items || [];
    if (!query) return rows;
    return rows.filter((item) =>
      [item.name, item.namespace, item.cluster_name, item.host, item.paths, item.exposure, item.tls_secret, item.status]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [overview?.items, search]);

  const summary = useMemo(
    () => ({
      routes: visibleRows.length,
      ready: visibleRows.filter((item) => item.status.toLowerCase() === 'ready').length,
      expiring: visibleRows.filter((item) => item.certificate_status.toLowerCase() === 'expiring').length,
      clusters: new Set(visibleRows.map((item) => item.cluster_name)).size,
    }),
    [visibleRows],
  );

  return (
    <>
      <Head>
        <title>Ingress - DevOps</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Ingress"
          subtitle="Review service entrypoints, TLS attachment, and route exposure in the same cluster-first pattern as the rest of the K8s workspace."
          queryState={{ project_id: projectId, cluster_name: clusterName, namespace, environment }}
          actions={
            <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((value) => value + 1)}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          }
        >
          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Traffic entry</span>
                <h2 className="portal-surface__title">Ingress routes and TLS coverage</h2>
                <p className="portal-surface__subtitle">
                  Use this view to confirm what is exposed, which TLS secret is attached, and which routes need certificate attention.
                </p>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Routes</span>
                <strong className="k8s-summary-card__value">{summary.routes}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Ready</span>
                <strong className="k8s-summary-card__value">{summary.ready}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Expiring certs</span>
                <strong className="k8s-summary-card__value">{summary.expiring}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Clusters</span>
                <strong className="k8s-summary-card__value">{summary.clusters}</strong>
              </div>
            </div>

            <div className="k8s-filterbar k8s-filterbar--resources">
              <label className="k8s-filterbar__field k8s-filterbar__field--search">
                <span className="k8s-filterbar__label">Search</span>
                <input
                  className="input k8s-filterbar__input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search ingress, host, path, or TLS secret"
                />
              </label>

              <label className="k8s-filterbar__field">
                <span className="k8s-filterbar__label">K8s cluster</span>
                <select
                  className="input k8s-filterbar__input"
                  value={clusterName}
                  onChange={(event) => {
                    setClusterName(event.target.value);
                    setNamespace('');
                  }}
                >
                  <option value="">All clusters</option>
                  {(overview?.clusters || []).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="k8s-filterbar__field">
                <span className="k8s-filterbar__label">Namespace</span>
                <select className="input k8s-filterbar__input" value={namespace} onChange={(event) => setNamespace(event.target.value)}>
                  <option value="">All namespaces</option>
                  {(overview?.namespaces || []).map((item) => (
                    <option key={item} value={item}>
                      {item}
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
                  {(overview?.environments || []).map((item) => (
                    <option key={item} value={item}>
                      {item.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>

              <div className="k8s-filterbar__actions">
                <span className="portal-pill">{visibleRows.length} visible</span>
                {(search || clusterName || namespace || environment) ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setSearch('');
                      setClusterName('');
                      setNamespace('');
                      setEnvironment('');
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>

            <div className="table-scroll">
              <table className="templates-table k8s-data-table">
                <thead>
                  <tr>
                    <th>Ingress</th>
                    <th>Namespace</th>
                    <th>Host</th>
                    <th>Paths</th>
                    <th>TLS Secret</th>
                    <th>Certificate</th>
                    <th>Exposure</th>
                    <th>Status</th>
                    <th>Cluster</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((item) => (
                    <tr key={`${item.cluster_name}-${item.namespace}-${item.name}`}>
                      <td>
                        <Link
                          className="k8s-link-cell"
                          href={buildK8sHref(`/k8s/ingresses/${encodeURIComponent(item.name)}`, {
                            project_id: projectId || undefined,
                            cluster_name: item.cluster_name,
                            namespace: item.namespace,
                            environment: environment || undefined,
                            ingress_name: item.name,
                          })}
                        >
                          <div className="k8s-link-cell__title">{item.name}</div>
                          <div className="k8s-link-cell__meta">{item.host || 'No hostname recorded'} · Open route detail</div>
                        </Link>
                      </td>
                      <td>{item.namespace}</td>
                      <td>{item.host || '—'}</td>
                      <td>{item.paths || '—'}</td>
                      <td>{item.tls_secret || '—'}</td>
                      <td>
                        <span className={ingressTone(item.certificate_status || item.status)}>
                          {item.certificate_status || 'unknown'}
                        </span>
                      </td>
                      <td>{item.exposure || 'internal'}</td>
                      <td>{item.status || 'unknown'}</td>
                      <td>{item.cluster_name}</td>
                    </tr>
                  ))}
                  {!loading && visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <div className="portal-empty">
                          <p>No ingress routes match the current filters.</p>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
