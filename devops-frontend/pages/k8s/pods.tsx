import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { DataTable, EmptyState, type DataTableColumn } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import K8sWorkspaceShell from '../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../context/ApiUrlContext';
import { buildK8sHref, fetchK8sPods, K8sPodsData, readQueryString } from '../../lib/k8sWorkspace';

type PodRow = K8sPodsData['items'][number];

function podTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'running' || normalized === 'succeeded' || normalized === 'completed') return 'low';
  if (['failed', 'error', 'crashloopbackoff', 'oomkilled', 'imagepullbackoff', 'errimagepull'].includes(normalized)) return 'danger';
  return 'medium';
}

function podMatchesSearch(
  query: string,
  item: K8sPodsData['items'][number],
) {
  if (!query) return true;
  return [item.name, item.namespace, item.cluster_name, item.status, item.node, item.deployment]
    .join(' ')
    .toLowerCase()
    .includes(query);
}

export default function DevOpsK8sPodsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [data, setData] = useState<K8sPodsData | null>(null);
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

    fetchK8sPods(apiUrl, {
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
        setError(err instanceof Error ? err.message : 'Failed to load pods');
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
    return (data?.items || []).filter((item) => podMatchesSearch(query, item));
  }, [data?.items, search]);

  const summary = useMemo(
    () => ({
      pods: visibleRows.length,
      running: visibleRows.filter((item) => item.status.toLowerCase() === 'running').length,
      restarting: visibleRows.filter((item) => item.restarts > 0).length,
      restarts: visibleRows.reduce((sum, item) => sum + item.restarts, 0),
    }),
    [visibleRows],
  );

  const scopeProjectId = projectId || String(data?.selected_project_id || '');

  const podHref = (item: PodRow) =>
    buildK8sHref(`/k8s/pods/${encodeURIComponent(item.name)}`, {
      project_id: scopeProjectId || undefined,
      cluster_name: item.cluster_name,
      namespace: item.namespace,
      environment: environment || undefined,
    });

  const columns: DataTableColumn<PodRow>[] = [
    {
      id: 'pod',
      header: 'Pod',
      cell: (item) => (
        <Link className="ig-cell-stack ig-cell-link" href={podHref(item)}>
          <span className="ig-cell-title">{item.name}</span>
          <span className="ig-cell-meta">{item.cluster_name}</span>
        </Link>
      ),
    },
    { id: 'namespace', header: 'Namespace', cell: (item) => item.namespace },
    { id: 'deployment', header: 'Deployment', cell: (item) => item.deployment || '—' },
    {
      id: 'status',
      header: 'Status',
      cell: (item) => <span className={`ig-chip ig-chip--${podTone(item.status)}`}>{item.status}</span>,
    },
    { id: 'restarts', header: 'Restarts', align: 'right', className: 'ig-cell-num', cell: (item) => item.restarts },
    { id: 'node', header: 'Node', cell: (item) => item.node || '—' },
    { id: 'age', header: 'Age', cell: (item) => item.age || '—' },
    { id: 'cluster', header: 'Cluster', cell: (item) => item.cluster_name },
  ];

  return (
    <>
      <Head>
        <title>Pods - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Pods"
          subtitle="Browse pod-level health and restart pressure without leaving the K8s workspace."
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
                <span className="portal-surface__eyebrow">Pod health</span>
                <h2 className="portal-surface__title">Runtime pods</h2>
                <p className="portal-surface__subtitle">
                  This view is for fast pod-level triage: search the pod, narrow the namespace, and confirm restarts before digging deeper.
                </p>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Visible pods</span>
                <strong className="k8s-summary-card__value">{summary.pods}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Running</span>
                <strong className="k8s-summary-card__value">{summary.running}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Restarting pods</span>
                <strong className="k8s-summary-card__value">{summary.restarting}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Total restarts</span>
                <strong className="k8s-summary-card__value">{summary.restarts}</strong>
              </div>
            </div>

            <div className="k8s-filterbar k8s-filterbar--resources">
              <label className="k8s-filterbar__field k8s-filterbar__field--search">
                <span className="k8s-filterbar__label">Search</span>
                <input
                  className="input k8s-filterbar__input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search pod, node, deployment, or status"
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

            <div className="ig-legacy-table">
              <DataTable<PodRow>
                label="Runtime pods"
                columns={columns}
                rows={visibleRows}
                rowKey={(item) => `${item.cluster_name}-${item.namespace}-${item.name}`}
                loading={loading}
                onRowOpen={(item) => void router.push(podHref(item))}
                empty={<EmptyState title="No pods found" body="No pods match the current filters." />}
              />
            </div>
          </section>
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
