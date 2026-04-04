import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import K8sWorkspaceShell from '../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../context/ApiUrlContext';
import { fetchK8sLogs, formatDateTime, K8sLogsData, readQueryString, streamK8sLogAttach } from '../../lib/k8sWorkspace';

function logTone(level: string) {
  const normalized = level.toLowerCase();
  if (normalized === 'info' || normalized === 'normal') {
    return 'k8s-data-pill k8s-data-pill--normal';
  }
  if (normalized === 'warning' || normalized === 'warn') {
    return 'k8s-data-pill k8s-data-pill--warning';
  }
  return 'k8s-data-pill';
}

function logMatchesSearch(query: string, item: K8sLogsData['items'][number]) {
  if (!query) return true;
  return [item.name, item.namespace, item.cluster_name, item.container, item.level, item.message]
    .join(' ')
    .toLowerCase()
    .includes(query);
}

function getLogKey(item: K8sLogsData['items'][number]) {
  return [item.cluster_name, item.namespace, item.name, item.container, item.timestamp, item.message].join('::');
}

function getLatestLogCursor(items: K8sLogsData['items']) {
  let latest = '';
  let latestTime = 0;
  for (const item of items) {
    const timestamp = new Date(item.timestamp).getTime();
    if (Number.isNaN(timestamp)) continue;
    if (timestamp >= latestTime) {
      latest = item.timestamp;
      latestTime = timestamp;
    }
  }
  return latest;
}

function mergeLogItems(current: K8sLogsData['items'], incoming: K8sLogsData['items']) {
  const seen = new Set<string>();
  const merged: K8sLogsData['items'] = [];
  for (const item of [...incoming, ...current]) {
    const key = getLogKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export default function DevOpsK8sLogsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [data, setData] = useState<K8sLogsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectId, setProjectId] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [environment, setEnvironment] = useState('');
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');
  const [liveMode, setLiveMode] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');
  const [streamStatus, setStreamStatus] = useState('snapshot');
  const [liveIntervalSeconds, setLiveIntervalSeconds] = useState(5);
  const [newEntries, setNewEntries] = useState(0);

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

    fetchK8sLogs(apiUrl, {
      project_id: projectId || undefined,
      cluster_name: clusterName || undefined,
      namespace: namespace || undefined,
      environment: environment || undefined,
    })
      .then((payload) => {
        if (!active) return;
        setData(payload);
        setLastUpdated(new Date().toISOString());
        setStreamStatus('snapshot');
        setNewEntries(0);
      })
      .catch((err) => {
        if (!active) return;
        setData(null);
        setError(err instanceof Error ? err.message : 'Failed to load cluster logs');
        setStreamStatus('degraded');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [apiUrl, clusterName, environment, namespace, projectId, refreshKey, router.isReady]);

  useEffect(() => {
    if (!liveMode || !router.isReady) return;
    const controller = new AbortController();

    void streamK8sLogAttach(
      apiUrl,
      {
        project_id: projectId || undefined,
        cluster_name: clusterName || undefined,
        namespace: namespace || undefined,
        environment: environment || undefined,
        level: level || undefined,
      },
      (event) => {
        if (!event.data) return;
        setStreamStatus(event.data.stream_status || 'live');
        setLiveIntervalSeconds(event.data.live_interval_seconds || 5);
        setLastUpdated(new Date().toISOString());
        setData((current) => {
          if (event.type === 'snapshot' || !current) {
            setLoading(false);
            setNewEntries(0);
            return {
              ...event.data,
              items: event.data.items,
            };
          }
          if (event.data.items.length === 0) {
            return current;
          }
          setNewEntries((count) => count + event.data.items.length);
          return {
            ...current,
            ...event.data,
            items: mergeLogItems(current.items, event.data.items),
          };
        });
      },
      controller.signal,
    ).catch((err) => {
      if (controller.signal.aborted) return;
      setStreamStatus('degraded');
      setError(err instanceof Error ? err.message : 'Failed to stream cluster logs');
      setLoading(false);
    });

    return () => {
      controller.abort();
    };
  }, [apiUrl, clusterName, environment, level, liveMode, namespace, projectId, router.isReady]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.items || []).filter((item) => {
      if (level && item.level.toLowerCase() !== level) return false;
      return logMatchesSearch(query, item);
    });
  }, [data?.items, level, search]);

  const summary = useMemo(
    () => ({
      logs: visibleRows.length,
      warnings: visibleRows.filter((item) => item.level.toLowerCase() === 'warning').length,
      errors: visibleRows.filter((item) => item.level.toLowerCase() === 'error').length,
      workloads: new Set(visibleRows.map((item) => item.name)).size,
    }),
    [visibleRows],
  );

  return (
    <>
      <Head>
        <title>Logs - DevOps</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Logs"
          subtitle="Use the logs view for rollout warnings, crash loops, and readiness noise without leaving the K8s workspace."
          queryState={{ project_id: projectId, cluster_name: clusterName, namespace, environment }}
          actions={
            <div className="k8s-action-buttons">
              <span className="portal-pill">{liveMode ? `Live every ${liveIntervalSeconds}s` : 'Manual refresh'}</span>
              <span className="portal-pill">{streamStatus}</span>
              {newEntries > 0 ? <span className="portal-pill">{newEntries} new entries</span> : null}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setLiveMode((value) => !value);
                  setNewEntries(0);
                }}
              >
                {liveMode ? 'Pause live' : 'Start live'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setNewEntries(0);
                  setRefreshKey((value) => value + 1);
                }}
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
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
                <span className="portal-surface__eyebrow">Cluster logs</span>
                <h2 className="portal-surface__title">Operational log stream</h2>
                <p className="portal-surface__subtitle">
                  Filter by cluster, namespace, and log level to focus on the warnings and rollout signals that matter.
                </p>
                {lastUpdated ? <p className="k8s-link-cell__meta">Last refreshed {formatDateTime(lastUpdated)}</p> : null}
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Visible logs</span>
                <strong className="k8s-summary-card__value">{summary.logs}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Warnings</span>
                <strong className="k8s-summary-card__value">{summary.warnings}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Errors</span>
                <strong className="k8s-summary-card__value">{summary.errors}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Workloads</span>
                <strong className="k8s-summary-card__value">{summary.workloads}</strong>
              </div>
            </div>

            <div className="k8s-filterbar k8s-filterbar--resources">
              <label className="k8s-filterbar__field k8s-filterbar__field--search">
                <span className="k8s-filterbar__label">Search</span>
                <input
                  className="input k8s-filterbar__input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search workload, namespace, container, or message"
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

              <label className="k8s-filterbar__field">
                <span className="k8s-filterbar__label">Level</span>
                <select className="input k8s-filterbar__input" value={level} onChange={(event) => setLevel(event.target.value)}>
                  <option value="">All levels</option>
                  <option value="warning">Warning</option>
                  <option value="error">Error</option>
                  <option value="info">Info</option>
                </select>
              </label>

              <div className="k8s-filterbar__actions">
                <span className="portal-pill">{visibleRows.length} visible</span>
                {(search || clusterName || namespace || environment || level) ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setSearch('');
                      setClusterName('');
                      setNamespace('');
                      setEnvironment('');
                      setLevel('');
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
                    <th>Level</th>
                    <th>Workload</th>
                    <th>Container</th>
                    <th>Namespace</th>
                    <th>Cluster</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((item) => (
                    <tr key={`${item.cluster_name}-${item.namespace}-${item.name}-${item.container}-${item.timestamp}`}>
                      <td>{formatDateTime(item.timestamp)}</td>
                      <td><span className={`portal-pill ${logTone(item.level)}`}>{item.level || 'info'}</span></td>
                      <td>
                        <div className="k8s-link-cell">
                          <span className="k8s-link-cell__title">{item.name || 'Workload'}</span>
                          <span className="k8s-link-cell__meta">{item.namespace}</span>
                        </div>
                      </td>
                      <td>{item.container || 'main'}</td>
                      <td>{item.namespace}</td>
                      <td>{item.cluster_name}</td>
                      <td>{item.message}</td>
                    </tr>
                  ))}
                  {!loading && visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="portal-empty">
                          <p>No logs match the current cluster, namespace, and level filters.</p>
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
