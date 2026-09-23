import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { DataTable, EmptyState, type DataTableColumn } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import K8sWorkspaceShell from '../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  DEVOPS_USER_KEY,
  buildK8sHref,
  fetchK8sWorkloads,
  K8sWorkloadsData,
  readQueryString,
  triggerK8sWorkloadAction,
} from '../../lib/k8sWorkspace';

type WorkloadRow = K8sWorkloadsData['items'][number];

function workloadRowKey(item: WorkloadRow) {
  return `${item.cluster_name}-${item.namespace}-${item.name}`;
}

function workloadTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'healthy') return 'low';
  if (normalized === 'failed' || normalized === 'critical' || normalized === 'unavailable') return 'danger';
  return 'medium';
}

export default function DevOpsK8sWorkloadsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [overview, setOverview] = useState<K8sWorkloadsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectId, setProjectId] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [environment, setEnvironment] = useState('');
  const [search, setSearch] = useState('');
  const [isManager, setIsManager] = useState(false);
  const [submittingKey, setSubmittingKey] = useState('');
  const [scaleTargetKey, setScaleTargetKey] = useState('');
  const [scaleReplicas, setScaleReplicas] = useState('');

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
    if (typeof window === 'undefined') return;
    try {
      const rawUser = window.localStorage.getItem(DEVOPS_USER_KEY);
      if (!rawUser) {
        setIsManager(false);
        return;
      }
      const parsed = JSON.parse(rawUser) as { devops_profile?: { is_manager?: boolean } } | null;
      setIsManager(Boolean(parsed?.devops_profile?.is_manager));
    } catch {
      setIsManager(false);
    }
  }, []);

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
        setError(err instanceof Error ? err.message : 'Failed to load workloads');
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
      [item.name, item.namespace, item.cluster_name, item.image, item.status].join(' ').toLowerCase().includes(query),
    );
  }, [overview?.items, search]);

  const summary = useMemo(
    () => ({
      workloads: visibleRows.length,
      healthy: visibleRows.filter((item) => item.status.toLowerCase() === 'healthy').length,
      degraded: visibleRows.filter((item) => item.status.toLowerCase() !== 'healthy').length,
      namespaces: new Set(visibleRows.map((item) => item.namespace)).size,
    }),
    [visibleRows],
  );

  const buildScopedHref = (path: string, item: K8sWorkloadsData['items'][number]) =>
    buildK8sHref(path, {
      project_id: projectId || String(projectIdByRowKey.get(`${item.cluster_name}-${item.namespace}-${item.name}`) || ''),
      cluster_name: item.cluster_name,
      namespace: item.namespace,
      environment: environment || undefined,
    });

  const projectIdByRowKey = useMemo(() => {
    const mapping = new Map<string, number>();
    const selectedProjectId = overview?.selected_project_id || 0;
    for (const item of overview?.items || []) {
      const rowKey = `${item.cluster_name}-${item.namespace}-${item.name}`;
      if (selectedProjectId > 0) {
        mapping.set(rowKey, selectedProjectId);
        continue;
      }
      const matchedConnection = (overview?.connections || []).find(
        (connection) =>
          connection.cluster_name === item.cluster_name &&
          (!environment || connection.environment === environment) &&
          (!namespace || connection.namespace === item.namespace || connection.namespace === ''),
      );
      if (matchedConnection?.project_id) {
        mapping.set(rowKey, matchedConnection.project_id);
      }
    }
    return mapping;
  }, [environment, namespace, overview]);

  const handleRestart = async (rowKey: string, item: K8sWorkloadsData['items'][number]) => {
    const targetProjectId = projectIdByRowKey.get(rowKey) || 0;
    if (targetProjectId <= 0) {
      setNotice('');
      setError('Select a project-scoped cluster before running a workload action.');
      return;
    }

    setSubmittingKey(rowKey);
    setScaleTargetKey('');
    setNotice('');
    setError('');
    try {
      const response = await triggerK8sWorkloadAction(apiUrl, {
        project_id: targetProjectId,
        cluster_name: item.cluster_name,
        namespace: item.namespace,
        environment: environment || undefined,
        workload_name: item.name,
        action: 'restart',
        reason: 'Requested from the DevOps K8s workloads workspace',
      });
      setNotice(response || `Restart request queued for ${item.name}.`);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to restart ${item.name}`);
    } finally {
      setSubmittingKey('');
    }
  };

  const handleResumeRollout = async (rowKey: string, item: K8sWorkloadsData['items'][number]) => {
    const targetProjectId = projectIdByRowKey.get(rowKey) || 0;
    if (targetProjectId <= 0) {
      setNotice('');
      setError('Select a project-scoped cluster before running a workload action.');
      return;
    }

    setSubmittingKey(rowKey);
    setScaleTargetKey('');
    setNotice('');
    setError('');
    try {
      const response = await triggerK8sWorkloadAction(apiUrl, {
        project_id: targetProjectId,
        cluster_name: item.cluster_name,
        namespace: item.namespace,
        environment: environment || undefined,
        workload_name: item.name,
        action: 'resume',
        reason: 'Requested from the DevOps K8s workloads workspace',
      });
      setNotice(response || `Rollout resume queued for ${item.name}.`);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to resume rollout for ${item.name}`);
    } finally {
      setSubmittingKey('');
    }
  };

  const handleScaleSubmit = async (rowKey: string, item: K8sWorkloadsData['items'][number]) => {
    const targetProjectId = projectIdByRowKey.get(rowKey) || 0;
    if (targetProjectId <= 0) {
      setNotice('');
      setError('Select a project-scoped cluster before running a workload action.');
      return;
    }
    const replicas = Number.parseInt(scaleReplicas, 10);
    if (!Number.isFinite(replicas) || replicas < 0) {
      setNotice('');
      setError('Enter a valid replica count of 0 or greater.');
      return;
    }

    setSubmittingKey(rowKey);
    setNotice('');
    setError('');
    try {
      const response = await triggerK8sWorkloadAction(apiUrl, {
        project_id: targetProjectId,
        cluster_name: item.cluster_name,
        namespace: item.namespace,
        environment: environment || undefined,
        workload_name: item.name,
        action: 'scale',
        replicas,
        reason: 'Requested from the DevOps K8s workloads workspace',
      });
      setNotice(response || `Scale request queued for ${item.name}.`);
      setScaleTargetKey('');
      setScaleReplicas('');
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to scale ${item.name}`);
    } finally {
      setSubmittingKey('');
    }
  };

  const rolloutHref = (item: WorkloadRow) =>
    buildK8sHref(`/k8s/workloads/${encodeURIComponent(item.name)}/rollout`, {
      project_id: projectId || String(projectIdByRowKey.get(workloadRowKey(item)) || ''),
      cluster_name: item.cluster_name,
      namespace: item.namespace,
      environment: environment || undefined,
      workload_name: item.name,
    });

  const scaleTarget = isManager && scaleTargetKey
    ? visibleRows.find((item) => workloadRowKey(item) === scaleTargetKey) || null
    : null;
  const scaleBusy = scaleTarget ? submittingKey === scaleTargetKey : false;

  const columns: DataTableColumn<WorkloadRow>[] = [
    {
      id: 'workload',
      header: 'Workload',
      cell: (item) => (
        <Link className="ig-cell-stack ig-cell-link" href={rolloutHref(item)}>
          <span className="ig-cell-title">{item.name}</span>
          <span className="ig-cell-meta">{item.image || 'No image detail'} · Open rollout view</span>
        </Link>
      ),
    },
    { id: 'namespace', header: 'Namespace', cell: (item) => item.namespace },
    { id: 'cpu_util', header: 'CPU util.', align: 'right', className: 'ig-cell-num', cell: (item) => `${item.cpu_utilization_pct}%` },
    { id: 'cpu_hours', header: 'CPU hours', align: 'right', className: 'ig-cell-num', cell: (item) => item.cpu_hours },
    { id: 'memory_gb', header: 'Memory (GB)', align: 'right', className: 'ig-cell-num', cell: (item) => item.memory_utilization_gb },
    { id: 'memory_hours', header: 'Memory hours', align: 'right', className: 'ig-cell-num', cell: (item) => item.memory_hours },
    {
      id: 'ready',
      header: 'Ready',
      align: 'right',
      className: 'ig-cell-num',
      cell: (item) => `${item.ready_replicas}/${item.updated_replicas}`,
    },
    { id: 'cluster', header: 'Cluster', cell: (item) => item.cluster_name },
    {
      id: 'status',
      header: 'Status',
      cell: (item) => <span className={`ig-chip ig-chip--${workloadTone(item.status)}`}>{item.status}</span>,
    },
  ];

  if (isManager) {
    columns.push({
      id: 'actions',
      header: 'Actions',
      className: 'k8s-action-cell',
      cell: (item) => {
        const rowKey = workloadRowKey(item);
        const actionBusy = submittingKey === rowKey;
        const canRunActions = (projectIdByRowKey.get(rowKey) || 0) > 0;
        return (
          <div className="ig-cell-stack">
            <div className="k8s-action-buttons">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={actionBusy || !canRunActions}
                onClick={() => handleRestart(rowKey, item)}
              >
                {actionBusy ? 'Working...' : 'Restart'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={actionBusy || !canRunActions}
                onClick={() => {
                  setNotice('');
                  setError('');
                  setScaleTargetKey(rowKey);
                  setScaleReplicas(String(item.replicas));
                }}
              >
                Scale
              </button>
              <Link className="btn btn-secondary btn-sm" href={buildScopedHref(`/k8s/workloads/${encodeURIComponent(item.name)}/rollout`, item)}>
                Rollout
              </Link>
              {item.status.toLowerCase() !== 'healthy' ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={actionBusy || !canRunActions}
                  onClick={() => handleResumeRollout(rowKey, item)}
                >
                  Resume rollout
                </button>
              ) : null}
            </div>
            {!canRunActions ? <span className="ig-cell-meta">Choose a project-scoped cluster to run actions.</span> : null}
          </div>
        );
      },
    });
  }

  return (
    <>
      <Head>
        <title>Workloads - DevOps</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Workloads"
          subtitle="Review workloads the way teams usually do inside a cluster console: pick the cluster, narrow the namespace, then inspect workload status."
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

          {notice ? (
            <div className="alert alert-success" role="status">
              {notice}
            </div>
          ) : null}

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Cluster view</span>
                <h2 className="portal-surface__title">Deployment workloads</h2>
                <p className="portal-surface__subtitle">
                  Start from a cluster and namespace, then inspect deployment readiness without leaving the cluster workspace.
                </p>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Visible workloads</span>
                <strong className="k8s-summary-card__value">{summary.workloads}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Healthy</span>
                <strong className="k8s-summary-card__value">{summary.healthy}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Needs attention</span>
                <strong className="k8s-summary-card__value">{summary.degraded}</strong>
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
                  placeholder="Search workload, image, or status"
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

            {scaleTarget ? (
              <div className="ig-legacy-inline-action" role="region" aria-label={`Scale ${scaleTarget.name}`}>
                <div className="k8s-inline-action">
                  <div className="k8s-inline-action__copy">
                    <strong>Scale {scaleTarget.name}</strong>
                    <p>Queue a replica update for this workload without leaving the cluster workspace.</p>
                  </div>
                  <div className="k8s-inline-action__controls">
                    <label className="k8s-inline-action__label">
                      <span>Replicas</span>
                      <input
                        type="number"
                        min={0}
                        className="input k8s-inline-action__input"
                        value={scaleReplicas}
                        onChange={(event) => setScaleReplicas(event.target.value)}
                        autoFocus
                      />
                    </label>
                    <div className="k8s-inline-action__actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={scaleBusy}
                        onClick={() => handleScaleSubmit(scaleTargetKey, scaleTarget)}
                      >
                        {scaleBusy ? 'Applying...' : 'Apply scale'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={scaleBusy}
                        onClick={() => {
                          setScaleTargetKey('');
                          setScaleReplicas('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="ig-legacy-table">
              <DataTable<WorkloadRow>
                label="Deployment workloads"
                columns={columns}
                rows={visibleRows}
                rowKey={workloadRowKey}
                loading={loading}
                rowClassName={(item) => (scaleTarget && workloadRowKey(item) === scaleTargetKey ? 'is-active' : undefined)}
                onRowOpen={(item) => void router.push(rolloutHref(item))}
                empty={<EmptyState title="No workloads found" body="No workloads match the current filters." />}
              />
            </div>
          </section>
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
