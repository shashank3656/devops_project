import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import K8sWorkspaceShell from '../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../context/ApiUrlContext';
import { fetchK8sEvents, formatDateTime, K8sEventsData, readQueryString } from '../../lib/k8sWorkspace';

function eventTone(severity: string) {
  return severity.toLowerCase() === 'normal' ? 'k8s-data-pill k8s-data-pill--normal' : 'k8s-data-pill k8s-data-pill--warning';
}

function eventMatchesSearch(query: string, item: K8sEventsData['items'][number]) {
  if (!query) return true;
  return [item.reason, item.message, item.resource_kind, item.resource_name, item.namespace, item.cluster_name]
    .join(' ')
    .toLowerCase()
    .includes(query);
}

export default function DevOpsK8sEventsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [data, setData] = useState<K8sEventsData | null>(null);
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

    fetchK8sEvents(apiUrl, {
      project_id: projectId || undefined,
      cluster_name: clusterName || undefined,
      namespace: namespace || undefined,
      environment: environment || undefined,
    })
      .then((payload) => {
        if (!active) return;
        setData(payload);
      })
      .catch((err) => {
        if (!active) return;
        setData(null);
        setError(err instanceof Error ? err.message : 'Failed to load cluster events');
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
    return (data?.items || []).filter((item) => eventMatchesSearch(query, item));
  }, [data?.items, search]);

  const summary = useMemo(
    () => ({
      events: visibleRows.length,
      warnings: visibleRows.filter((item) => item.severity.toLowerCase() !== 'normal').length,
      normal: visibleRows.filter((item) => item.severity.toLowerCase() === 'normal').length,
      namespaces: new Set(visibleRows.map((item) => item.namespace)).size,
    }),
    [visibleRows],
  );

  return (
    <>
      <Head>
        <title>Events - DevOps</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Events"
          subtitle="Use the event stream to spot rollout warnings, readiness failures, and noisy resources without leaving the K8s workspace."
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
                <span className="portal-surface__eyebrow">Cluster events</span>
                <h2 className="portal-surface__title">Event stream</h2>
                <p className="portal-surface__subtitle">
                  This keeps the event trail readable: filter the cluster, narrow the namespace, then sort out warning-heavy resources quickly.
                </p>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Visible events</span>
                <strong className="k8s-summary-card__value">{summary.events}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Warnings</span>
                <strong className="k8s-summary-card__value">{summary.warnings}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Normal</span>
                <strong className="k8s-summary-card__value">{summary.normal}</strong>
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
                  placeholder="Search reason, resource, namespace, or message"
                />
              </label>

              <label className="k8s-filterbar__field">
                <span className="k8s-filterbar__label">K8s cluster</span>
                <select className="input k8s-filterbar__input" value={clusterName} onChange={(event) => setClusterName(event.target.value)}>
                  <option value="">All clusters</option>
                  {(data?.clusters || []).map((item) => (
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
                  {(data?.namespaces || []).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="k8s-filterbar__field">
                <span className="k8s-filterbar__label">Environment</span>
                <select className="input k8s-filterbar__input" value={environment} onChange={(event) => setEnvironment(event.target.value)}>
                  <option value="">All environments</option>
                  {(data?.environments || []).map((item) => (
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
                    <th>Time</th>
                    <th>Severity</th>
                    <th>Reason</th>
                    <th>Resource</th>
                    <th>Namespace</th>
                    <th>Cluster</th>
                    <th>Count</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((item) => (
                    <tr key={item.id}>
                      <td>{formatDateTime(item.timestamp)}</td>
                      <td><span className={`portal-pill ${eventTone(item.severity)}`}>{item.severity}</span></td>
                      <td>{item.reason || '—'}</td>
                      <td>
                        <div className="k8s-link-cell">
                          <span className="k8s-link-cell__title">{item.resource_name || 'Resource'}</span>
                          <span className="k8s-link-cell__meta">{item.resource_kind || 'Unknown kind'}</span>
                        </div>
                      </td>
                      <td>{item.namespace}</td>
                      <td>{item.cluster_name}</td>
                      <td>{item.occurrence_count}</td>
                      <td>{item.message}</td>
                    </tr>
                  ))}
                  {!loading && visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={8}>
                        <div className="portal-empty">
                          <p>No events match the current filters.</p>
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
