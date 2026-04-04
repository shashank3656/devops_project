import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import K8sWorkspaceShell from '../../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../../context/ApiUrlContext';
import {
  buildK8sHref,
  fetchK8sActivity,
  fetchK8sPodDetail,
  formatDateTime,
  K8sActivityData,
  K8sPodDetailData,
  readQueryString,
} from '../../../lib/k8sWorkspace';

function podStatusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'running') return 'k8s-data-pill k8s-data-pill--normal';
  if (normalized === 'warning' || normalized === 'pending') return 'k8s-data-pill k8s-data-pill--warning';
  return 'k8s-data-pill';
}

function buildScopedHref(
  path: string,
  projectId: string,
  clusterName: string,
  namespace: string,
  environment: string,
) {
  return buildK8sHref(path, {
    project_id: projectId || undefined,
    cluster_name: clusterName || undefined,
    namespace: namespace || undefined,
    environment: environment || undefined,
  });
}

export default function DevOpsK8sPodDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [detail, setDetail] = useState<K8sPodDetailData | null>(null);
  const [activity, setActivity] = useState<K8sActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectId, setProjectId] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [environment, setEnvironment] = useState('');
  const [podName, setPodName] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    setProjectId(readQueryString(router.query.project_id));
    setClusterName(readQueryString(router.query.cluster_name));
    setNamespace(readQueryString(router.query.namespace));
    setEnvironment(readQueryString(router.query.environment));
    setPodName(readQueryString(router.query.pod) || readQueryString(router.query.pod_name));
  }, [
    router.isReady,
    router.query.cluster_name,
    router.query.environment,
    router.query.namespace,
    router.query.pod,
    router.query.pod_name,
    router.query.project_id,
  ]);

  useEffect(() => {
    if (!router.isReady || !podName) return;
    let active = true;
    setLoading(true);
    setError('');

    Promise.all([
      fetchK8sPodDetail(apiUrl, {
        project_id: projectId || undefined,
        cluster_name: clusterName || undefined,
        namespace: namespace || undefined,
        environment: environment || undefined,
        pod_name: podName,
      }),
      fetchK8sActivity(apiUrl, {
        project_id: projectId || undefined,
        cluster_name: clusterName || undefined,
        namespace: namespace || undefined,
        environment: environment || undefined,
        pod_name: podName,
        workload_name: detail?.deployment?.name || undefined,
        limit: 8,
      }),
    ])
      .then(([detailPayload, activityPayload]) => {
        if (!active) return;
        setDetail(detailPayload);
        setActivity(activityPayload);
      })
      .catch((err) => {
        if (!active) return;
        setDetail(null);
        setActivity(null);
        setError(err instanceof Error ? err.message : 'Failed to load pod detail');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [apiUrl, clusterName, detail?.deployment?.name, environment, namespace, podName, projectId, refreshKey, router.isReady]);

  const pod = detail?.pod;
  const deployment = detail?.deployment;
  const siblingPods = detail?.sibling_pods || [];
  const recentLogs = detail?.recent_logs || [];
  const recentEvents = detail?.recent_events || [];
  const services = detail?.services || [];
  const activityItems = activity?.items || [];
  const containerCount = useMemo(() => new Set(recentLogs.map((item) => item.container).filter(Boolean)).size || 1, [recentLogs]);
  const warningCount = recentEvents.filter((item) => item.severity.toLowerCase() === 'warning').length;
  const scopeProjectId = projectId || String(detail?.selected_project_id || '');
  const scopeCluster = clusterName || pod?.cluster_name || '';
  const scopeNamespace = namespace || pod?.namespace || '';
  const diagnostics = useMemo(() => {
    const restartPressure = pod?.restarts ?? 0;
    const siblingRestartPressure = siblingPods.reduce((sum, item) => sum + item.restarts, 0);
    const warningLogs = recentLogs.filter((item) => ['warning', 'error', 'critical'].includes(item.level.trim().toLowerCase())).length;
    const serviceExposure = services.filter((item) => item.exposure.trim().toLowerCase() !== 'cluster').length;
    return {
      restartPressure,
      siblingRestartPressure,
      warningEvents: warningCount,
      warningLogs,
      operatorActions: activityItems.length,
      serviceExposure,
    };
  }, [activityItems.length, pod?.restarts, recentLogs, services, siblingPods, warningCount]);
  const guidance = useMemo(() => {
    const items: string[] = [];
    if (diagnostics.restartPressure > 0) {
      items.push('This pod has already restarted. Review recent logs before sending another restart or terminal command.');
    }
    if (diagnostics.warningEvents > 0) {
      items.push('Pod warning events are active. Use the event trail to confirm whether the issue is scheduling, readiness, or runtime related.');
    }
    if (diagnostics.warningLogs > 0) {
      items.push('Warning or error log lines are present in the latest signal set. Compare them with the rollout view before resuming changes.');
    }
    if (diagnostics.operatorActions === 0) {
      items.push('No recent operator actions were recorded for this pod, which helps separate automated rollout pressure from manual intervention.');
    }
    if (items.length === 0) {
      items.push('This pod looks steady right now. Use the terminal and logs views as confirmation tools rather than recovery tools.');
    }
    return items;
  }, [diagnostics]);

  return (
    <>
      <Head>
        <title>Pod Detail - DevOps</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Pod Detail"
          subtitle="Use the pod view to confirm restart pressure, related rollout activity, and the most recent runtime signals before stepping into a deeper debug flow."
          queryState={{ project_id: projectId, cluster_name: clusterName, namespace, environment }}
          actions={
            <div className="k8s-action-buttons">
              <Link className="btn btn-secondary" href={buildScopedHref('/k8s/pods', scopeProjectId, scopeCluster, scopeNamespace, environment)}>
                Back to pods
              </Link>
              <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((value) => value + 1)}>
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
                <span className="portal-surface__eyebrow">Pod inspection</span>
                <h2 className="portal-surface__title">{pod?.name || podName || 'Pod detail'}</h2>
                <p className="portal-surface__subtitle">
                  Review the pod status, rollout relationship, recent events, and latest log signals in one place.
                </p>
              </div>
            </div>

            <div className="k8s-detail-grid">
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Status</span>
                <div className="k8s-detail-card__value">
                  {pod ? <span className={`portal-pill ${podStatusTone(pod.status)}`}>{pod.status}</span> : '—'}
                </div>
                <span className="k8s-detail-card__meta">Cluster {pod?.cluster_name || '—'} · Namespace {pod?.namespace || '—'}</span>
              </div>
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Restarts</span>
                <span className="k8s-detail-card__value">{pod?.restarts ?? 0}</span>
                <span className="k8s-detail-card__meta">Current pod age {pod?.age || '—'}</span>
              </div>
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Node</span>
                <span className="k8s-detail-card__value">{pod?.node || 'Unscheduled'}</span>
                <span className="k8s-detail-card__meta">{containerCount} container signal(s) · {warningCount} warning event(s)</span>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Deployment</span>
                <strong className="k8s-summary-card__value">{deployment?.name || pod?.deployment || 'Standalone'}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Replica readiness</span>
                <strong className="k8s-summary-card__value">
                  {deployment ? `${deployment.ready_replicas}/${deployment.replicas}` : '—'}
                </strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Sibling pods</span>
                <strong className="k8s-summary-card__value">{siblingPods.length}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Services</span>
                <strong className="k8s-summary-card__value">{services.length}</strong>
              </div>
            </div>

            <div className="k8s-diagnostic-grid">
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Pod restarts</span>
                <strong className="k8s-diagnostic-card__value">{diagnostics.restartPressure}</strong>
                <span className="k8s-diagnostic-card__meta">Sibling restart pressure {diagnostics.siblingRestartPressure}</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Warning events</span>
                <strong className="k8s-diagnostic-card__value">{diagnostics.warningEvents}</strong>
                <span className="k8s-diagnostic-card__meta">{recentEvents.length} recent event(s) inspected</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Log pressure</span>
                <strong className="k8s-diagnostic-card__value">{diagnostics.warningLogs}</strong>
                <span className="k8s-diagnostic-card__meta">{containerCount} container signal stream(s) sampled</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Operator actions</span>
                <strong className="k8s-diagnostic-card__value">{diagnostics.operatorActions}</strong>
                <span className="k8s-diagnostic-card__meta">{diagnostics.serviceExposure} service exposure path(s) outside cluster-only scope</span>
              </div>
            </div>

            <div className="k8s-detail-grid">
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Workload context</span>
                <div className="k8s-link-cell__title">{deployment?.name || pod?.deployment || 'No deployment mapping'}</div>
                <div className="k8s-link-cell__meta">
                  {deployment ? `Image ${deployment.image} · CPU ${deployment.cpu_utilization_pct}% · Memory ${deployment.memory_utilization_gb} GB` : 'This pod is not tied to a deployment record in the current workspace scope.'}
                </div>
              </div>
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Quick links</span>
                <div className="k8s-action-buttons">
                  <Link className="btn btn-secondary btn-sm" href={buildScopedHref('/k8s/logs', scopeProjectId, scopeCluster, scopeNamespace, environment)}>
                    Open logs
                  </Link>
                  <Link
                    className="btn btn-secondary btn-sm"
                    href={buildK8sHref(`/k8s/pods/${encodeURIComponent(pod?.name || podName)}/terminal`, {
                      project_id: scopeProjectId || undefined,
                      cluster_name: scopeCluster || undefined,
                      namespace: scopeNamespace || undefined,
                      environment: environment || undefined,
                      pod_name: pod?.name || podName,
                    })}
                  >
                    Terminal
                  </Link>
                  <Link className="btn btn-secondary btn-sm" href={buildScopedHref('/k8s/events', scopeProjectId, scopeCluster, scopeNamespace, environment)}>
                    Open events
                  </Link>
                  <Link className="btn btn-secondary btn-sm" href={buildScopedHref('/k8s/workloads', scopeProjectId, scopeCluster, scopeNamespace, environment)}>
                    Open workloads
                  </Link>
                </div>
              </div>
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Service exposure</span>
                <div className="k8s-link-cell__title">{services[0]?.name || 'No related service'}</div>
                <div className="k8s-link-cell__meta">
                  {services[0] ? `${services[0].type} · ${services[0].ports} · ${services[0].cluster_ip || services[0].external_ip || 'no address'}` : 'No service selector matched this pod deployment in the current scope.'}
                </div>
              </div>
            </div>

            <div className="k8s-spotlight-grid">
              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Operator guidance</span>
                    <h3 className="portal-surface__title">Recommended next checks</h3>
                  </div>
                </div>
                <div className="k8s-guidance-list">
                  {guidance.map((item, index) => (
                    <div key={`${index}-${item}`} className="k8s-guidance-list__item">
                      {item}
                    </div>
                  ))}
                </div>
              </section>

              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Operator activity</span>
                    <h3 className="portal-surface__title">Recent interventions</h3>
                  </div>
                </div>
                {activityItems.length > 0 ? (
                  <div className="k8s-activity-feed">
                    {activityItems.map((item) => (
                      <div key={item.id} className="k8s-activity-item">
                        <div className="k8s-activity-item__header">
                          <span className={`portal-pill ${item.action.includes('restart') || item.action.includes('terminal') ? 'k8s-data-pill k8s-data-pill--warning' : 'k8s-data-pill k8s-data-pill--healthy'}`}>
                            {item.action.replace('k8s_', '').replaceAll('_', ' ')}
                          </span>
                          <span className="k8s-feed__meta">
                            {item.actor_name} · {formatDateTime(item.timestamp)}
                          </span>
                        </div>
                        <div className="k8s-activity-item__summary">{item.summary}</div>
                        <p className="k8s-activity-item__detail">{item.detail}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="portal-empty">
                    <p>No recent K8s operator actions are recorded for this pod yet.</p>
                  </div>
                )}
              </section>

              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Recent events</span>
                    <h3 className="portal-surface__title">Event trail</h3>
                  </div>
                </div>
                {recentEvents.length > 0 ? (
                  recentEvents.map((item) => (
                    <div key={item.id || `${item.reason}-${item.timestamp}`} className="k8s-log-feed__item">
                      <div className="k8s-log-feed__meta">
                        <span className={`portal-pill ${item.severity.toLowerCase() === 'warning' ? 'k8s-data-pill k8s-data-pill--warning' : 'k8s-data-pill k8s-data-pill--normal'}`}>
                          {item.severity}
                        </span>
                        <span>{item.reason}</span>
                        <span>{formatDateTime(item.timestamp)}</span>
                      </div>
                      <div className="k8s-log-feed__message">{item.message}</div>
                    </div>
                  ))
                ) : (
                  <div className="portal-empty">
                    <p>No pod-specific events are available yet.</p>
                  </div>
                )}
              </section>

              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Recent logs</span>
                    <h3 className="portal-surface__title">Container signals</h3>
                  </div>
                </div>
                {recentLogs.length > 0 ? (
                  recentLogs.map((item, index) => (
                    <div key={`${item.timestamp}-${index}`} className="k8s-log-feed__item">
                      <div className="k8s-log-feed__meta">
                        <span className={`portal-pill ${podStatusTone(item.level)}`}>{item.level || 'info'}</span>
                        <span>{item.container || 'main'}</span>
                        <span>{formatDateTime(item.timestamp)}</span>
                      </div>
                      <div className="k8s-log-feed__message">{item.message}</div>
                    </div>
                  ))
                ) : (
                  <div className="portal-empty">
                    <p>No recent logs are available for this pod yet.</p>
                  </div>
                )}
              </section>

              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Sibling pods</span>
                    <h3 className="portal-surface__title">Replica view</h3>
                  </div>
                </div>
                {siblingPods.length > 0 ? (
                  siblingPods.map((item) => (
                    <div key={`${item.cluster_name}-${item.namespace}-${item.name}`} className="k8s-log-feed__item">
                      <div className="k8s-log-feed__meta">
                        <span className={`portal-pill ${podStatusTone(item.status)}`}>{item.status}</span>
                        <span>{item.name}</span>
                        <span>{item.restarts} restart(s)</span>
                      </div>
                      <div className="k8s-log-feed__message">{item.node || 'No node assignment'} · {item.age || 'Unknown age'}</div>
                    </div>
                  ))
                ) : (
                  <div className="portal-empty">
                    <p>No sibling pods are visible for this deployment yet.</p>
                  </div>
                )}
              </section>
            </div>
          </section>
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
