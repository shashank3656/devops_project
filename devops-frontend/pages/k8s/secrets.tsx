import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import K8sWorkspaceShell from '../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../context/ApiUrlContext';
import { fetchK8sSecrets, K8sSecretsData, readQueryString } from '../../lib/k8sWorkspace';

function secretTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'healthy') return 'k8s-data-pill k8s-data-pill--healthy';
  if (normalized === 'expiring' || normalized === 'warning') return 'k8s-data-pill k8s-data-pill--expiring';
  if (normalized === 'critical') return 'k8s-data-pill k8s-data-pill--critical';
  return 'k8s-data-pill';
}

export default function DevOpsK8sSecretsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [overview, setOverview] = useState<K8sSecretsData | null>(null);
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

    fetchK8sSecrets(apiUrl, {
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
        setError(err instanceof Error ? err.message : 'Failed to load secrets');
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
      [item.name, item.namespace, item.cluster_name, item.type, item.managed_by, item.bound_to, item.expires_at]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [overview?.items, search]);

  const summary = useMemo(
    () => ({
      secrets: visibleRows.length,
      tls: visibleRows.filter((item) => item.type === 'kubernetes.io/tls').length,
      expiring: visibleRows.filter((item) => item.certificate_status.toLowerCase() === 'expiring').length,
      namespaces: new Set(visibleRows.map((item) => item.namespace)).size,
    }),
    [visibleRows],
  );

  return (
    <>
      <Head>
        <title>Secrets - DevOps</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Secrets"
          subtitle="Track opaque and TLS-backed secrets by cluster and namespace so certificate-backed objects are visible alongside the normal secret inventory."
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
                <span className="portal-surface__eyebrow">Secret inventory</span>
                <h2 className="portal-surface__title">Runtime secrets and TLS bindings</h2>
                <p className="portal-surface__subtitle">
                  Review what each secret is bound to, which ones are managed by cert automation, and which TLS-backed entries need attention.
                </p>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Visible secrets</span>
                <strong className="k8s-summary-card__value">{summary.secrets}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">TLS secrets</span>
                <strong className="k8s-summary-card__value">{summary.tls}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Expiring certs</span>
                <strong className="k8s-summary-card__value">{summary.expiring}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Namespaces</span>
                <strong className="k8s-summary-card__value">{summary.namespaces}</strong>
              </div>
            </div>

            <div className="k8s-filterbar k8s-filterbar--resources">
              <label className="k8s-filterbar__field k8s-filterbar__field--search">
                <span className="k8s-filterbar__label">Search</span>
                <input
                  className="input k8s-filterbar__input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search secret, namespace, manager, or binding"
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
                    <th>Secret</th>
                    <th>Namespace</th>
                    <th>Type</th>
                    <th>Managed by</th>
                    <th>Keys</th>
                    <th>Bound to</th>
                    <th>Certificate</th>
                    <th>Expires</th>
                    <th>Cluster</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((item) => (
                    <tr key={`${item.cluster_name}-${item.namespace}-${item.name}`}>
                      <td>
                        <div className="k8s-link-cell__title">{item.name}</div>
                        <div className="k8s-link-cell__meta">{item.type || 'Opaque secret'}</div>
                      </td>
                      <td>{item.namespace}</td>
                      <td>{item.type || '—'}</td>
                      <td>{item.managed_by || 'manual'}</td>
                      <td>{item.key_count}</td>
                      <td>{item.bound_to || '—'}</td>
                      <td>
                        <span className={secretTone(item.certificate_status)}>
                          {item.certificate_status || 'n/a'}
                        </span>
                      </td>
                      <td>{item.expires_at ? new Date(item.expires_at).toLocaleDateString() : '—'}</td>
                      <td>{item.cluster_name}</td>
                    </tr>
                  ))}
                  {!loading && visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <div className="portal-empty">
                          <p>No secrets match the current filters.</p>
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
