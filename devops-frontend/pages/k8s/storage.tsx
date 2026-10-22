import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { DataTable, EmptyState, type DataTableColumn } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import K8sWorkspaceShell from '../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../context/ApiUrlContext';
import { fetchK8sStorage, K8sStorageData, readQueryString } from '../../lib/k8sWorkspace';

type StorageRow = K8sStorageData['items'][number];

function storageTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'bound' || normalized === 'available' || normalized === 'healthy') return 'low';
  if (normalized === 'failed' || normalized === 'lost') return 'danger';
  if (normalized === 'pending' || normalized === 'released') return 'medium';
  return 'neutral';
}

const STORAGE_COLUMNS: DataTableColumn<StorageRow>[] = [
  {
    id: 'volume',
    header: 'Volume',
    cell: (item) => (
      <div className="ig-cell-stack">
        <span className="ig-cell-title">{item.name}</span>
        <span className="ig-cell-meta">{item.type || 'Unknown type'}</span>
      </div>
    ),
  },
  { id: 'namespace', header: 'Namespace', cell: (item) => item.namespace },
  { id: 'storage_class', header: 'Storage class', cell: (item) => item.storage_class || '—' },
  { id: 'capacity', header: 'Capacity', align: 'right', className: 'ig-cell-num', cell: (item) => item.capacity || '—' },
  { id: 'access_mode', header: 'Access mode', cell: (item) => item.access_mode || '—' },
  { id: 'claim', header: 'Claim', cell: (item) => item.claim || '—' },
  {
    id: 'status',
    header: 'Status',
    cell: (item) => <span className={`ig-chip ig-chip--${storageTone(item.status || '')}`}>{item.status || 'unknown'}</span>,
  },
  {
    id: 'mounted_by',
    header: 'Mounted by',
    cell: (item) => (item.mounted_by ? item.mounted_by : <span className="ig-chip ig-chip--neutral">Not mounted</span>),
  },
  { id: 'cluster', header: 'Cluster', cell: (item) => item.cluster_name },
];

export default function DevOpsK8sStoragePage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [overview, setOverview] = useState<K8sStorageData | null>(null);
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

    fetchK8sStorage(apiUrl, {
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
        setError(err instanceof Error ? err.message : 'Failed to load storage');
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
      [item.name, item.namespace, item.cluster_name, item.type, item.claim, item.status, item.mounted_by]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [overview?.items, search]);

  const summary = useMemo(
    () => ({
      volumes: visibleRows.length,
      mounted: visibleRows.filter((item) => item.mounted_by.trim().length > 0).length,
      namespaces: new Set(visibleRows.map((item) => item.namespace)).size,
      clusters: new Set(visibleRows.map((item) => item.cluster_name)).size,
    }),
    [visibleRows],
  );

  return (
    <>
      <Head>
        <title>Storage - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Storage"
          subtitle="Inspect persistent storage from the same cluster workspace, with cluster and namespace filters kept compact and easy to scan."
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
                <span className="portal-surface__eyebrow">Storage view</span>
                <h2 className="portal-surface__title">Persistent volumes and claims</h2>
                <p className="portal-surface__subtitle">
                  Review cluster storage with the same cluster-first flow instead of digging through one mixed dashboard.
                </p>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Volumes</span>
                <strong className="k8s-summary-card__value">{summary.volumes}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Mounted</span>
                <strong className="k8s-summary-card__value">{summary.mounted}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Namespaces</span>
                <strong className="k8s-summary-card__value">{summary.namespaces}</strong>
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
                  placeholder="Search volume, claim, or mount target"
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
              <DataTable<StorageRow>
                label="Persistent volumes and claims"
                columns={STORAGE_COLUMNS}
                rows={visibleRows}
                rowKey={(item) => `${item.cluster_name}-${item.namespace}-${item.name}`}
                loading={loading}
                empty={<EmptyState title="No storage found" body="No storage items match the current filters." />}
              />
            </div>
          </section>
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
