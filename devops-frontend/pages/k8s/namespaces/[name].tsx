import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import K8sOperatorNextSteps from '../../../components/K8sOperatorNextSteps';
import K8sWorkspaceShell from '../../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { buildClusterWorkspaceEntry } from '../../../lib/k8sWorkspaceNav';
import {
  buildK8sHref,
  fetchK8sClusterDetail,
  formatDateTime,
  K8sClusterDetailData,
  readQueryString,
} from '../../../lib/k8sWorkspace';

function clusterStatusTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'healthy' || normalized === 'normal' || normalized === 'active' || normalized === 'ready') {
    return 'k8s-data-pill k8s-data-pill--normal';
  }
  if (normalized === 'warning' || normalized === 'degraded' || normalized === 'attention') {
    return 'k8s-data-pill k8s-data-pill--warning';
  }
  return 'k8s-data-pill';
}

export default function DevOpsK8sNamespaceDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [detail, setDetail] = useState<K8sClusterDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectId, setProjectId] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [environment, setEnvironment] = useState('');
  const [namespaceName, setNamespaceName] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    setProjectId(readQueryString(router.query.project_id));
    setClusterName(readQueryString(router.query.cluster_name));
    setEnvironment(readQueryString(router.query.environment));
    setNamespaceName(readQueryString(router.query.name));
  }, [
    router.isReady,
    router.query.cluster_name,
    router.query.environment,
    router.query.name,
    router.query.project_id,
  ]);

  useEffect(() => {
    if (!router.isReady || !clusterName || !namespaceName) return;
    let active = true;
    setLoading(true);
    setError('');

    fetchK8sClusterDetail(apiUrl, {
      project_id: projectId || undefined,
      cluster_name: clusterName || undefined,
      namespace: namespaceName || undefined,
      environment: environment || undefined,
    })
      .then((data) => {
        if (!active) return;
        setDetail(data);
      })
      .catch((err) => {
        if (!active) return;
        setDetail(null);
        setError(err instanceof Error ? err.message : 'Failed to load namespace detail');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [apiUrl, clusterName, environment, namespaceName, projectId, refreshKey, router.isReady]);

  const cluster = detail?.cluster;
  const namespaceItems = detail?.namespace_items || [];
  const namespaceHealth = detail?.namespace_health || [];
  const workloadSpotlights = detail?.workload_spotlights || [];
  const recentLogs = detail?.recent_logs || [];
  const recentEvents = detail?.events || [];
  const summary = detail?.summary;

  const namespaceItem =
    namespaceItems.find((item) => item.name === namespaceName) ||
    namespaceItems[0] ||
    null;
  const healthRow =
    namespaceHealth.find((item) => item.namespace === namespaceName) ||
    namespaceHealth[0] ||
    null;
  const namespaceWorkloads = workloadSpotlights.filter((item) => item.namespace === namespaceName);
  const namespaceLogs = recentLogs.filter((item) => item.namespace === namespaceName);
  const namespaceEvents = recentEvents.filter((item) => item.namespace === namespaceName);

  const scopeProjectId = projectId || String(detail?.selected_project_id || cluster?.project_id || '');
  const scopeCluster = clusterName || cluster?.cluster_name || '';
  const scopeEnvironment = environment || cluster?.environment || '';

  const incidentPosture = useMemo(() => {
    const warningEvents = namespaceEvents.filter((item) => {
      const severity = item.severity.trim().toLowerCase();
      return severity === 'warning' || severity === 'critical' || severity === 'error';
    });
    const warningLogs = namespaceLogs.filter((item) => {
      const level = item.level.trim().toLowerCase();
      return level === 'warning' || level === 'critical' || level === 'error';
    });
    const pressureScore =
      (healthRow?.issue_count || 0) * 3 +
      (healthRow?.restarting_pods || 0) * 2 +
      (healthRow?.warning_logs || 0) * 2 +
      (healthRow?.affected_deployments || 0) * 2 +
      warningEvents.length * 2 +
      warningLogs.length;

    const guidance: string[] = [];
    if (warningEvents.length > 0 && (healthRow?.restarting_pods || 0) > 0) {
      guidance.push('Start with the newest warning events, then compare them against restarting pods before changing service exposure.');
    }
    if (warningLogs.length > 0 && (healthRow?.affected_deployments || 0) > 0) {
      guidance.push('Review the impacted workloads first. This namespace is showing both runtime and deployment pressure.');
    }
    if ((healthRow?.issue_count || 0) === 0 && warningEvents.length === 0 && warningLogs.length === 0) {
      guidance.push('Signal pressure is low right now. Use this page as a quick namespace health checkpoint before moving back to the cluster view.');
    }
    if (guidance.length === 0) {
      guidance.push('Open logs and events next, then confirm whether service exposure and workload readiness point to the same issue path.');
    }

    return {
      warningEventCount: warningEvents.length,
      warningLogCount: warningLogs.length,
      pressureScore,
      guidance,
    };
  }, [healthRow, namespaceEvents, namespaceLogs]);

  const clusterHref = buildClusterWorkspaceEntry(scopeCluster, {
    project_id: scopeProjectId || undefined,
    namespace: namespaceName || undefined,
    environment: scopeEnvironment || undefined,
  });

  const namespaceHref = (path: string) =>
    buildK8sHref(path, {
      project_id: scopeProjectId || undefined,
      cluster_name: scopeCluster || undefined,
      namespace: namespaceName || undefined,
      environment: scopeEnvironment || undefined,
    });

  const operatorLinks = [
    {
      href: namespaceHref('/k8s/workloads'),
      label: 'Namespace workloads',
      detail: 'Pivot into workloads already scoped to this namespace and inspect rollout pressure.',
    },
    {
      href: namespaceHref('/k8s/pods'),
      label: 'Backing pods',
      detail: 'Open the live pod list for this namespace and move quickly into pod detail.',
    },
    {
      href: namespaceHref('/k8s/services'),
      label: 'Service exposure',
      detail: 'Review which services inside this namespace are carrying edge traffic or selector risk.',
    },
    {
      href: namespaceHref('/k8s/logs'),
      label: 'Runtime logs',
      detail: 'Jump straight into the namespace log stream to confirm whether signal pressure is still active.',
    },
    {
      href: namespaceHref('/k8s/events'),
      label: 'Event trail',
      detail: 'Use the namespace event feed to validate whether the issue is config, scheduling, or rollout related.',
    },
  ];

  return (
    <>
      <Head>
        <title>{namespaceName ? `${namespaceName} - Namespace` : 'Namespace'} - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title={namespaceName || 'Namespace'}
          subtitle="Use this namespace view to line up workload health, log pressure, and recent events before drilling into pods or services."
          queryState={{
            project_id: scopeProjectId,
            cluster_name: scopeCluster,
            namespace: namespaceName,
            environment: scopeEnvironment,
          }}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((value) => value + 1)}>
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <Link href={clusterHref} className="btn btn-secondary">
                Back to cluster
              </Link>
            </>
          }
        >
          {error ? (
            <div className="portal-table-state portal-table-state--error">
              <div className="portal-table-state__icon" aria-hidden>!</div>
              <h3 className="portal-table-state__title">We couldn’t load this namespace</h3>
              <p className="portal-table-state__copy">{error}</p>
              <div className="portal-table-state__actions">
                <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((value) => value + 1)}>
                  Try again
                </button>
              </div>
            </div>
          ) : null}

          {!loading && !error && !namespaceItem ? (
            <div className="portal-table-state">
              <div className="portal-table-state__icon" aria-hidden>?</div>
              <h3 className="portal-table-state__title">Namespace not found</h3>
              <p className="portal-table-state__copy">
                This namespace isn’t visible in the current cluster scope. Go back to the cluster and choose another namespace.
              </p>
              <div className="portal-table-state__actions">
                <Link href={clusterHref} className="btn btn-secondary">
                  Back to cluster
                </Link>
              </div>
            </div>
          ) : null}

          {namespaceItem ? (
            <>
              <K8sOperatorNextSteps
                title="Operator handoff"
                subtitle="Use the same namespace scope to move into the next operational surface without rebuilding filters by hand."
                items={operatorLinks}
              />

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Namespace workspace</span>
                    <h2 className="portal-surface__title">Operating context</h2>
                    <p className="portal-surface__subtitle">
                      This is the namespace landing page for health, workload pressure, service exposure, and recent signal review.
                    </p>
                  </div>
                </div>

                <div className="k8s-summary-strip">
                  <div className="k8s-summary-card">
                    <span className="k8s-summary-card__label">Workloads</span>
                    <strong className="k8s-summary-card__value">{summary?.deployment_count || namespaceWorkloads.length}</strong>
                  </div>
                  <div className="k8s-summary-card">
                    <span className="k8s-summary-card__label">Pods</span>
                    <strong className="k8s-summary-card__value">{namespaceItem.pod_count}</strong>
                  </div>
                  <div className="k8s-summary-card">
                    <span className="k8s-summary-card__label">Services</span>
                    <strong className="k8s-summary-card__value">{namespaceItem.service_count}</strong>
                  </div>
                  <div className="k8s-summary-card">
                    <span className="k8s-summary-card__label">Warning events</span>
                    <strong className="k8s-summary-card__value">{incidentPosture.warningEventCount}</strong>
                  </div>
                  <div className="k8s-summary-card">
                    <span className="k8s-summary-card__label">Warning logs</span>
                    <strong className="k8s-summary-card__value">{incidentPosture.warningLogCount}</strong>
                  </div>
                </div>

                <div className="k8s-detail-grid">
                  <div className="k8s-detail-card">
                    <span className="k8s-detail-card__label">Namespace</span>
                    <strong className="k8s-detail-card__value">{namespaceItem.name}</strong>
                    <span className="k8s-detail-card__meta">{namespaceItem.cluster_name}</span>
                  </div>
                  <div className="k8s-detail-card">
                    <span className="k8s-detail-card__label">Status</span>
                    <strong className="k8s-detail-card__value">{healthRow?.status || namespaceItem.status || 'Unknown'}</strong>
                    <span className={`portal-pill ${clusterStatusTone(healthRow?.status || namespaceItem.status || '')}`}>
                      {healthRow?.status || namespaceItem.status || 'Unknown'}
                    </span>
                  </div>
                  <div className="k8s-detail-card">
                    <span className="k8s-detail-card__label">Environment</span>
                    <strong className="k8s-detail-card__value">{namespaceItem.environment?.toUpperCase() || scopeEnvironment.toUpperCase() || '—'}</strong>
                    <span className="k8s-detail-card__meta">{cluster?.project_name || 'Project pending'}</span>
                  </div>
                  <div className="k8s-detail-card">
                    <span className="k8s-detail-card__label">Restarting pods</span>
                    <strong className="k8s-detail-card__value">{healthRow?.restarting_pods || 0}</strong>
                    <span className="k8s-detail-card__meta">Pods currently adding runtime pressure.</span>
                  </div>
                  <div className="k8s-detail-card">
                    <span className="k8s-detail-card__label">Affected deployments</span>
                    <strong className="k8s-detail-card__value">{healthRow?.affected_deployments || 0}</strong>
                    <span className="k8s-detail-card__meta">Deployments contributing to this namespace posture.</span>
                  </div>
                  <div className="k8s-detail-card">
                    <span className="k8s-detail-card__label">Last activity</span>
                    <strong className="k8s-detail-card__value">{formatDateTime(namespaceItem.last_activity)}</strong>
                    <span className="k8s-detail-card__meta">{scopeCluster || cluster?.cluster_name || 'Cluster pending'}</span>
                  </div>
                </div>

                <div className="portal-pill-row">
                  <Link className="btn btn-secondary btn-sm" href={namespaceHref('/k8s/workloads')}>
                    Workloads
                  </Link>
                  <Link className="btn btn-secondary btn-sm" href={namespaceHref('/k8s/pods')}>
                    Pods
                  </Link>
                  <Link className="btn btn-secondary btn-sm" href={namespaceHref('/k8s/logs')}>
                    Logs
                  </Link>
                  <Link className="btn btn-secondary btn-sm" href={namespaceHref('/k8s/services')}>
                    Services
                  </Link>
                  <Link className="btn btn-secondary btn-sm" href={namespaceHref('/k8s/events')}>
                    Events
                  </Link>
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Incident posture</span>
                    <h2 className="portal-surface__title">Namespace signal watch</h2>
                    <p className="portal-surface__subtitle">
                      This combines namespace health, event churn, and warning-heavy logs so we can see how close this namespace is to becoming an active incident.
                    </p>
                  </div>
                </div>

                <div className="k8s-diagnostic-grid">
                  <div className="k8s-diagnostic-card">
                    <span className="k8s-diagnostic-card__label">Pressure score</span>
                    <strong className="k8s-diagnostic-card__value">{incidentPosture.pressureScore}</strong>
                    <span className="k8s-diagnostic-card__meta">Combined runtime, deployment, event, and warning-log pressure for this namespace.</span>
                  </div>
                  <div className="k8s-diagnostic-card">
                    <span className="k8s-diagnostic-card__label">Issue count</span>
                    <strong className="k8s-diagnostic-card__value">{healthRow?.issue_count || 0}</strong>
                    <span className="k8s-diagnostic-card__meta">Tracked issues on the namespace health surface.</span>
                  </div>
                  <div className="k8s-diagnostic-card">
                    <span className="k8s-diagnostic-card__label">Warning events</span>
                    <strong className="k8s-diagnostic-card__value">{incidentPosture.warningEventCount}</strong>
                    <span className="k8s-diagnostic-card__meta">Events worth checking before this namespace affects more services.</span>
                  </div>
                  <div className="k8s-diagnostic-card">
                    <span className="k8s-diagnostic-card__label">Warning logs</span>
                    <strong className="k8s-diagnostic-card__value">{incidentPosture.warningLogCount}</strong>
                    <span className="k8s-diagnostic-card__meta">Recent warning or error logs from the namespace signal trail.</span>
                  </div>
                </div>

                <div className="k8s-detail-columns">
                  <div className="k8s-section-stack">
                    <h3 className="k8s-section-stack__title">Recommended next checks</h3>
                    <div className="k8s-guidance-list">
                      {incidentPosture.guidance.map((item) => (
                        <div key={item} className="k8s-guidance-list__item">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="k8s-section-stack">
                    <h3 className="k8s-section-stack__title">Workload watchlist</h3>
                    <div className="k8s-spotlight-grid">
                      {namespaceWorkloads.slice(0, 4).map((item) => (
                        <article key={`${item.cluster_name}-${item.namespace}-${item.name}`} className="k8s-spotlight-card">
                          <div className="k8s-spotlight-card__header">
                            <div>
                              <h3 className="k8s-spotlight-card__title">{item.name}</h3>
                              <p className="k8s-spotlight-card__meta">{item.namespace} · {item.cluster_name}</p>
                            </div>
                            <span className={`portal-pill ${clusterStatusTone(item.status)}`}>{item.status}</span>
                          </div>
                          <div className="k8s-spotlight-card__stats">
                            <span>Ready {item.ready_replicas}/{item.replicas}</span>
                            <span>Restarts {item.restart_count}</span>
                            <span>Warnings {item.warning_count}</span>
                          </div>
                        </article>
                      ))}
                      {namespaceWorkloads.length === 0 ? (
                        <div className="portal-empty">
                          <p>No workload spotlights are visible for this namespace right now.</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>

              <div className="k8s-detail-columns">
                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Recent events</span>
                      <h2 className="portal-surface__title">Namespace event feed</h2>
                    </div>
                  </div>
                  <div className="k8s-feed">
                    {namespaceEvents.map((event) => (
                      <article key={event.id} className="k8s-feed__item">
                        <div className="k8s-feed__header">
                          <span className={`portal-pill ${clusterStatusTone(event.severity)}`}>{event.severity}</span>
                          <span className="k8s-feed__meta">{formatDateTime(event.timestamp)}</span>
                        </div>
                        <strong className="k8s-feed__title">{event.reason} · {event.resource_kind} / {event.resource_name}</strong>
                        <p className="k8s-feed__message">{event.message}</p>
                        <span className="k8s-feed__meta">{event.namespace} · Count {event.occurrence_count}</span>
                      </article>
                    ))}
                    {!loading && namespaceEvents.length === 0 ? (
                      <div className="portal-empty">
                        <p>No recent namespace events are visible right now.</p>
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Recent logs</span>
                      <h2 className="portal-surface__title">Namespace warning signals</h2>
                    </div>
                  </div>
                  <div className="k8s-feed">
                    {namespaceLogs.map((log) => (
                      <article key={`${log.cluster_name}-${log.namespace}-${log.name}-${log.timestamp}`} className="k8s-feed__item">
                        <div className="k8s-feed__header">
                          <span className={`portal-pill ${clusterStatusTone(log.level)}`}>{log.level}</span>
                          <span className="k8s-feed__meta">{formatDateTime(log.timestamp)}</span>
                        </div>
                        <strong className="k8s-feed__title">{log.name} · {log.container}</strong>
                        <p className="k8s-feed__message">{log.message}</p>
                        <span className="k8s-feed__meta">{log.namespace} · {log.cluster_name}</span>
                      </article>
                    ))}
                    {!loading && namespaceLogs.length === 0 ? (
                      <div className="portal-empty">
                        <p>No recent namespace log signals are visible right now.</p>
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>
            </>
          ) : null}
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
