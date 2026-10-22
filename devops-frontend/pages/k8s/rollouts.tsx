import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { DataTable, EmptyState, type DataTableColumn } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import K8sWorkspaceShell from '../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../context/ApiUrlContext';
import { buildK8sHref, fetchK8sWorkloads, K8sWorkloadsData, readQueryString } from '../../lib/k8sWorkspace';

type RolloutRow = K8sWorkloadsData['items'][number];

function rolloutTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'healthy') return 'low';
  if (normalized === 'failed' || normalized === 'critical' || normalized === 'unavailable') return 'danger';
  return 'medium';
}

export default function DevOpsK8sRolloutsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [overview, setOverview] = useState<K8sWorkloadsData | null>(null);
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

    fetchK8sWorkloads(apiUrl, {
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
        setError(err instanceof Error ? err.message : 'Failed to load rollout status');
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
      [item.name, item.namespace, item.cluster_name, item.status, item.image].join(' ').toLowerCase().includes(query),
    );
  }, [overview?.items, search]);

  const summary = useMemo(
    () => ({
      rollouts: visibleRows.length,
      healthy: visibleRows.filter((item) => item.status.toLowerCase() === 'healthy').length,
      unknown: visibleRows.filter((item) => {
        const status = item.status.toLowerCase();
        return status === '' || status === 'unknown';
      }).length,
      stalled: visibleRows.filter((item) => {
        const status = item.status.toLowerCase();
        return status !== 'healthy' && status !== '' && status !== 'unknown';
      }).length,
      clusters: new Set(visibleRows.map((item) => item.cluster_name)).size,
    }),
    [visibleRows],
  );

  const rolloutHref = (item: RolloutRow) =>
    buildK8sHref(`/k8s/workloads/${encodeURIComponent(item.name)}/rollout`, {
      project_id: projectId || undefined,
      cluster_name: item.cluster_name,
      namespace: item.namespace,
      environment: environment || undefined,
      workload_name: item.name,
    });

  const columns: DataTableColumn<RolloutRow>[] = [
    {
      id: 'workload',
      header: 'Workload',
      cell: (item) => (
        <Link className="ig-cell-stack ig-cell-link" href={rolloutHref(item)}>
          <span className="ig-cell-title">{item.name}</span>
          <span className="ig-cell-meta">Open rollout timeline and pod pressure</span>
        </Link>
      ),
    },
    { id: 'namespace', header: 'Namespace', cell: (item) => item.namespace },
    {
      id: 'ready',
      header: 'Ready',
      align: 'right',
      className: 'ig-cell-num',
      cell: (item) => `${item.ready_replicas}/${item.replicas}`,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (item) => <span className={`ig-chip ig-chip--${rolloutTone(item.status)}`}>{item.status}</span>,
    },
    { id: 'image', header: 'Image', cell: (item) => <span className="ig-mono">{item.image || '—'}</span> },
    { id: 'cluster', header: 'Cluster', cell: (item) => item.cluster_name },
  ];

  return (
    <>
      <Head>
        <title>Rollouts - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Rollouts"
          subtitle="Track workload rollout readiness, inspect replica health, and jump into the workload-specific rollout view before taking action."
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
                <span className="portal-surface__eyebrow">Rollout view</span>
                <h2 className="portal-surface__title">Workload rollout status</h2>
                <p className="portal-surface__subtitle">
                  Use this view when you want rollout state first, then drill into events, logs, and replica pressure for a single workload.
                </p>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Visible rollouts</span>
                <strong className="k8s-summary-card__value">{summary.rollouts}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Healthy</span>
                <strong className="k8s-summary-card__value">{summary.healthy}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Unknown</span>
                <strong className="k8s-summary-card__value">{summary.unknown}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Needs follow-up</span>
                <strong className="k8s-summary-card__value">{summary.stalled}</strong>
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
                  placeholder="Search workload, image, or rollout status"
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

            <div className="ig-legacy-table">
              <DataTable<RolloutRow>
                label="Workload rollout status"
                columns={columns}
                rows={visibleRows}
                rowKey={(item) => `${item.cluster_name}-${item.namespace}-${item.name}`}
                loading={loading}
                onRowOpen={(item) => void router.push(rolloutHref(item))}
                empty={<EmptyState title="No rollouts found" body="No rollout records match the current filters." />}
              />
            </div>
          </section>
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
