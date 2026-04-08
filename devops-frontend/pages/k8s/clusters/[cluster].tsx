import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import K8sOperatorNextSteps from '../../../components/K8sOperatorNextSteps';
import K8sWorkspaceShell from '../../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../../context/ApiUrlContext';
import {
  buildK8sHref,
  fetchK8sClusterDetail,
  formatDateTime,
  K8sClusterDetailData,
  readQueryString,
} from '../../../lib/k8sWorkspace';

function clusterStatusTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'healthy' || normalized === 'normal' || normalized === 'active') {
    return 'k8s-data-pill k8s-data-pill--normal';
  }
  if (normalized === 'warning' || normalized === 'degraded' || normalized === 'attention') {
    return 'k8s-data-pill k8s-data-pill--warning';
  }
  return 'k8s-data-pill';
}

function buildResourceHref(
  path: string,
  projectId: string,
  clusterName: string,
  environment: string,
  namespace: string,
) {
  return buildK8sHref(path, {
    project_id: projectId || undefined,
    cluster_name: clusterName || undefined,
    environment: environment || undefined,
    namespace: namespace || undefined,
  });
}

export default function DevOpsK8sClusterDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [detail, setDetail] = useState<K8sClusterDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectId, setProjectId] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [environment, setEnvironment] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    const routeCluster = readQueryString(router.query.cluster);
    setProjectId(readQueryString(router.query.project_id));
    setClusterName(readQueryString(router.query.cluster_name) || routeCluster);
    setNamespace(readQueryString(router.query.namespace));
    setEnvironment(readQueryString(router.query.environment));
  }, [
    router.isReady,
    router.query.cluster,
    router.query.cluster_name,
    router.query.environment,
    router.query.namespace,
    router.query.project_id,
  ]);

  useEffect(() => {
    if (!router.isReady || !clusterName) return;
    let active = true;
    setLoading(true);
    setError('');

    fetchK8sClusterDetail(apiUrl, {
      project_id: projectId || undefined,
      cluster_name: clusterName || undefined,
      namespace: namespace || undefined,
      environment: environment || undefined,
    })
      .then((data) => {
        if (!active) return;
        setDetail(data);
      })
      .catch((err) => {
        if (!active) return;
        setDetail(null);
        setError(err instanceof Error ? err.message : 'Failed to load cluster detail');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [apiUrl, clusterName, environment, namespace, projectId, refreshKey, router.isReady]);

  const cluster = detail?.cluster;
  const summary = detail?.summary;
  const health = detail?.health_summary;
  const namespaces = detail?.namespace_items || [];
  const namespaceHealth = detail?.namespace_health || [];
  const workloadSpotlights = detail?.workload_spotlights || [];
  const recentLogs = detail?.recent_logs || [];
  const recentEvents = detail?.events || [];

  const scopeProjectId = projectId || String(detail?.selected_project_id || cluster?.project_id || '');
  const scopeCluster = clusterName || cluster?.cluster_name || '';
  const scopeEnvironment = environment || cluster?.environment || '';

  const healthyNamespaces = useMemo(
    () => namespaceHealth.filter((item) => item.status.toLowerCase() === 'healthy').length,
    [namespaceHealth],
  );

  const namespaceImpact = useMemo(() => {
    return namespaces
      .map((item) => {
        const healthRow = namespaceHealth.find((row) => row.namespace === item.name);
        const spotlightRows = workloadSpotlights.filter((row) => row.namespace === item.name);
        const namespaceEventCount = recentEvents.filter((row) => row.namespace === item.name).length;
        const namespaceLogCount = recentLogs.filter((row) => row.namespace === item.name).length;
        const issueCount = healthRow?.issue_count || 0;
        const restartingPods = healthRow?.restarting_pods || 0;
        const warningLogs = healthRow?.warning_logs || 0;
        const affectedDeployments = healthRow?.affected_deployments || 0;
        const pressureScore =
          issueCount * 3 +
          restartingPods * 2 +
          warningLogs * 2 +
          affectedDeployments * 2 +
          namespaceEventCount +
          namespaceLogCount;
        const primaryWorkload = [...spotlightRows].sort((left, right) => {
          const leftPressure = left.warning_count * 2 + left.restart_count + (left.replicas - left.ready_replicas) * 3;
          const rightPressure = right.warning_count * 2 + right.restart_count + (right.replicas - right.ready_replicas) * 3;
          return rightPressure - leftPressure;
        })[0];

        return {
          name: item.name,
          clusterName: item.cluster_name,
          status: (healthRow?.status || item.status || 'Unknown').trim(),
          issueCount,
          restartingPods,
          warningLogs,
          affectedDeployments,
          namespaceEventCount,
          namespaceLogCount,
          spotlightCount: spotlightRows.length,
          primaryWorkload: primaryWorkload?.name || 'No spotlight workload',
          pressureScore,
        };
      })
      .sort((left, right) => {
        if (right.pressureScore !== left.pressureScore) {
          return right.pressureScore - left.pressureScore;
        }
        return left.name.localeCompare(right.name);
      });
  }, [namespaceHealth, namespaces, recentEvents, recentLogs, workloadSpotlights]);

  const blastRadius = useMemo(() => {
    const impactedNamespaces = namespaceImpact.filter(
      (item) => item.pressureScore > 0 || item.status.toLowerCase() !== 'healthy',
    );
    const crossSignalNamespaces = impactedNamespaces.filter(
      (item) =>
        (item.warningLogs > 0 || item.restartingPods > 0) &&
        (item.namespaceEventCount > 0 || item.affectedDeployments > 0),
    );

    return {
      impactedNamespaceCount: impactedNamespaces.length,
      highPressureCount: impactedNamespaces.filter((item) => item.pressureScore >= 8).length,
      deploymentImpact: impactedNamespaces.reduce((total, item) => total + item.affectedDeployments, 0),
      noisySignalCount: impactedNamespaces.reduce(
        (total, item) => total + item.namespaceEventCount + item.namespaceLogCount,
        0,
      ),
      topNamespaces: impactedNamespaces.slice(0, 3),
      crossSignalCount: crossSignalNamespaces.length,
    };
  }, [namespaceImpact]);

  const blastGuidance = useMemo(() => {
    const guidance: string[] = [];
    if (blastRadius.highPressureCount > 0) {
      guidance.push(
        `${blastRadius.highPressureCount} namespaces are carrying stacked failure signals. Start with the highest-pressure namespace before the noise spreads.`,
      );
    }
    if (blastRadius.deploymentImpact > 0) {
      guidance.push(
        `${blastRadius.deploymentImpact} deployment slots are already affected. Check service entry points and rollout posture before adding more change.`,
      );
    }
    if (blastRadius.crossSignalCount > 0) {
      guidance.push(
        `${blastRadius.crossSignalCount} namespaces are showing both runtime pressure and event churn. Those are the best candidates for a focused incident review.`,
      );
    }
    if (guidance.length === 0) {
      guidance.push('Namespace pressure is low right now. Use this page as a steady-state health check before drilling into workloads.');
    }
    return guidance;
  }, [blastRadius.crossSignalCount, blastRadius.deploymentImpact, blastRadius.highPressureCount]);

  const incidentCorrelation = useMemo(() => {
    const correlatedNamespaces = namespaceImpact
      .map((item) => {
        const matchingEvents = recentEvents.filter((event) => event.namespace === item.name);
        const matchingLogs = recentLogs.filter((log) => log.namespace === item.name);
        const warningEvents = matchingEvents.filter((event) => {
          const severity = event.severity.trim().toLowerCase();
          return severity === 'warning' || severity === 'critical' || severity === 'error';
        });
        const warningLogs = matchingLogs.filter((log) => {
          const level = log.level.trim().toLowerCase();
          return level === 'warning' || level === 'critical' || level === 'error';
        });
        const correlationScore =
          item.pressureScore +
          warningEvents.length * 3 +
          warningLogs.length * 2 +
          (item.restartingPods > 0 ? 2 : 0) +
          (item.affectedDeployments > 0 ? 2 : 0);
        const likelyIncident =
          correlationScore >= 10 ||
          ((warningEvents.length > 0 || warningLogs.length > 0) &&
            (item.restartingPods > 0 || item.affectedDeployments > 0));

        let nextAction = 'Watch this namespace for another signal before escalating it to an incident.';
        if (warningEvents.length > 0 && item.restartingPods > 0) {
          nextAction = 'Start with pod restarts and the newest warning events, then confirm whether service traffic is degrading.';
        } else if (warningLogs.length > 0 && item.affectedDeployments > 0) {
          nextAction = 'Check the impacted deployment rollout and compare recent warnings against the current pod health.';
        } else if (item.namespaceEventCount > 0) {
          nextAction = 'Open the recent events first, then confirm whether logs and workload health tell the same story.';
        }

        return {
          ...item,
          warningEventCount: warningEvents.length,
          warningLogCount: warningLogs.length,
          correlationScore,
          likelyIncident,
          topEventReason: warningEvents[0]?.reason || matchingEvents[0]?.reason || 'No recent event reason',
          topLogSignal: warningLogs[0]?.name || matchingLogs[0]?.name || 'No recent warning log',
          nextAction,
        };
      })
      .filter((item) => item.correlationScore > 0)
      .sort((left, right) => {
        if (right.correlationScore !== left.correlationScore) {
          return right.correlationScore - left.correlationScore;
        }
        return left.name.localeCompare(right.name);
      });

    return {
      likelyIncidentCount: correlatedNamespaces.filter((item) => item.likelyIncident).length,
      crossSignalCount: correlatedNamespaces.filter(
        (item) => item.warningEventCount > 0 && item.warningLogCount > 0,
      ).length,
      restartLinkedCount: correlatedNamespaces.filter((item) => item.restartingPods > 0).length,
      deploymentLinkedCount: correlatedNamespaces.filter((item) => item.affectedDeployments > 0).length,
      topNamespaces: correlatedNamespaces.slice(0, 4),
    };
  }, [namespaceImpact, recentEvents, recentLogs]);

  const operatorLinks = [
    {
      href: buildResourceHref('/k8s/workloads', scopeProjectId, scopeCluster, scopeEnvironment, namespace),
      label: 'Workloads',
      detail: 'Inspect rollout posture and deployment pressure for the workloads running in this cluster.',
    },
    {
      href: buildResourceHref('/k8s/services', scopeProjectId, scopeCluster, scopeEnvironment, namespace),
      label: 'Services',
      detail: 'Check service exposure and dependency pressure across this cluster before following pod-level issues.',
    },
    {
      href: buildResourceHref('/k8s/pods', scopeProjectId, scopeCluster, scopeEnvironment, namespace),
      label: 'Pods',
      detail: 'Open the pod inventory for this cluster and move straight into workload or pod detail views.',
    },
    {
      href: buildResourceHref('/k8s/logs', scopeProjectId, scopeCluster, scopeEnvironment, namespace),
      label: 'Logs',
      detail: 'Use the live log surface for this cluster to confirm whether warning signals are still rising.',
    },
    {
      href: buildResourceHref('/k8s/events', scopeProjectId, scopeCluster, scopeEnvironment, namespace),
      label: 'Events',
      detail: 'Use the event trail to separate rollout noise from real cluster or namespace incidents.',
    },
  ];

  return (
    <>
      <Head>
        <title>{scopeCluster ? `${scopeCluster} - K8s Cluster` : 'K8s Cluster'} - DevOps</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title={scopeCluster || 'K8s Cluster'}
          subtitle="Use this as the cluster landing page: confirm health, scan namespace pressure, then jump into workloads, pods, services, configmaps, storage, or events."
          queryState={{ project_id: scopeProjectId, cluster_name: scopeCluster, namespace, environment: scopeEnvironment }}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((value) => value + 1)}>
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <Link href={buildK8sHref('/k8s/onboard', { project_id: scopeProjectId, environment: scopeEnvironment })} className="btn btn-primary">
                Onboard cluster
              </Link>
            </>
          }
        >
          {error ? (
            <div className="portal-table-state portal-table-state--error">
              <div className="portal-table-state__icon" aria-hidden>!</div>
              <h3 className="portal-table-state__title">We couldn’t load this cluster</h3>
              <p className="portal-table-state__copy">{error}</p>
              <div className="portal-table-state__actions">
                <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((value) => value + 1)}>
                  Try again
                </button>
              </div>
            </div>
          ) : null}

              <K8sOperatorNextSteps
                title="Operator handoff"
                subtitle="Use the cluster workspace as the top-level control point, then move directly into the K8s surface that explains the next signal."
                items={operatorLinks}
              />

              <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Cluster workspace</span>
                <h2 className="portal-surface__title">Overview and operating context</h2>
                <p className="portal-surface__subtitle">
                  This is the cluster home for the next layer of work: pods, workloads, services, config, storage, and event review.
                </p>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Namespaces</span>
                <strong className="k8s-summary-card__value">{summary?.namespace_count || namespaces.length}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Workloads</span>
                <strong className="k8s-summary-card__value">{summary?.deployment_count || 0}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Pods</span>
                <strong className="k8s-summary-card__value">{summary?.pod_count || 0}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Services</span>
                <strong className="k8s-summary-card__value">{summary?.service_count || 0}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Warnings</span>
                <strong className="k8s-summary-card__value">{summary?.warning_event_count || 0}</strong>
              </div>
            </div>

            <div className="k8s-filterbar k8s-filterbar--resources">
              <label className="k8s-filterbar__field">
                <span className="k8s-filterbar__label">Namespace</span>
                <select className="input k8s-filterbar__input" value={namespace} onChange={(event) => setNamespace(event.target.value)}>
                  <option value="">All namespaces</option>
                  {(detail?.namespaces || []).map((item) => (
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
                  value={scopeEnvironment}
                  onChange={(event) => setEnvironment(event.target.value)}
                >
                  <option value="">All environments</option>
                  {(detail?.environments || []).map((item) => (
                    <option key={item} value={item}>
                      {item.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>

              <div className="k8s-filterbar__actions">
                <span className="portal-pill">{namespaces.length} namespaces</span>
                {namespace || scopeEnvironment ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setNamespace('');
                      setEnvironment('');
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>

            <div className="k8s-detail-grid">
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Project</span>
                <strong className="k8s-detail-card__value">{cluster?.project_name || 'Unknown project'}</strong>
                <span className="k8s-detail-card__meta">{cluster?.project_code || 'n/a'}</span>
              </div>
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Environment</span>
                <strong className="k8s-detail-card__value">{cluster?.environment?.toUpperCase() || '—'}</strong>
                <span className="k8s-detail-card__meta">{cluster?.cloud?.toUpperCase() || '—'}</span>
              </div>
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Health</span>
                <strong className="k8s-detail-card__value">{cluster?.health_status || 'Unknown'}</strong>
                <span className={`portal-pill ${clusterStatusTone(cluster?.health_status || '')}`}>{cluster?.health_status || 'Unknown'}</span>
              </div>
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Kubernetes</span>
                <strong className="k8s-detail-card__value">{cluster?.kubernetes_version || '—'}</strong>
                <span className="k8s-detail-card__meta">{cluster?.location || 'Location pending'}</span>
              </div>
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Nodes</span>
                <strong className="k8s-detail-card__value">{cluster?.node_count || 0}</strong>
                <span className="k8s-detail-card__meta">{cluster?.node_pool || 'Default pool'}</span>
              </div>
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Endpoint</span>
                <strong className="k8s-detail-card__value">{cluster?.cluster_name || scopeCluster || '—'}</strong>
                <span className="k8s-detail-card__meta">{cluster?.cluster_endpoint || 'Endpoint unavailable'}</span>
              </div>
            </div>

            <div className="portal-pill-row">
              <Link className="btn btn-secondary btn-sm" href={buildResourceHref('/k8s/workloads', scopeProjectId, scopeCluster, scopeEnvironment, namespace)}>
                Workloads
              </Link>
              <Link className="btn btn-secondary btn-sm" href={buildResourceHref('/k8s/pods', scopeProjectId, scopeCluster, scopeEnvironment, namespace)}>
                Pods
              </Link>
              <Link className="btn btn-secondary btn-sm" href={buildResourceHref('/k8s/logs', scopeProjectId, scopeCluster, scopeEnvironment, namespace)}>
                Logs
              </Link>
              <Link className="btn btn-secondary btn-sm" href={buildResourceHref('/k8s/services', scopeProjectId, scopeCluster, scopeEnvironment, namespace)}>
                Services
              </Link>
              <Link className="btn btn-secondary btn-sm" href={buildResourceHref('/k8s/ingresses', scopeProjectId, scopeCluster, scopeEnvironment, namespace)}>
                Ingress
              </Link>
              <Link className="btn btn-secondary btn-sm" href={buildResourceHref('/k8s/secrets', scopeProjectId, scopeCluster, scopeEnvironment, namespace)}>
                Secrets
              </Link>
              <Link className="btn btn-secondary btn-sm" href={buildResourceHref('/k8s/configmaps', scopeProjectId, scopeCluster, scopeEnvironment, namespace)}>
                ConfigMaps
              </Link>
              <Link className="btn btn-secondary btn-sm" href={buildResourceHref('/k8s/storage', scopeProjectId, scopeCluster, scopeEnvironment, namespace)}>
                Storage
              </Link>
              <Link className="btn btn-secondary btn-sm" href={buildResourceHref('/k8s/events', scopeProjectId, scopeCluster, scopeEnvironment, namespace)}>
                Events
              </Link>
              <Link className="btn btn-secondary btn-sm" href={buildResourceHref('/k8s/certificates', scopeProjectId, scopeCluster, scopeEnvironment, namespace)}>
                Certificates
              </Link>
            </div>
          </section>

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Namespace health</span>
                <h2 className="portal-surface__title">Namespace watchlist</h2>
                <p className="portal-surface__subtitle">
                  Healthy namespaces stay quiet. This table helps us spot restart pressure and warning-heavy namespaces quickly.
                </p>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Healthy namespaces</span>
                <strong className="k8s-summary-card__value">{healthyNamespaces}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Degraded workloads</span>
                <strong className="k8s-summary-card__value">{health?.degraded_deployments || 0}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Restarting pods</span>
                <strong className="k8s-summary-card__value">{health?.restarting_pods || 0}</strong>
              </div>
            </div>

            <div className="table-scroll">
              <table className="templates-table k8s-data-table">
                <thead>
                  <tr>
                    <th>Namespace</th>
                    <th>Status</th>
                    <th>Issues</th>
                    <th>Restarting pods</th>
                    <th>Warning logs</th>
                    <th>Affected deployments</th>
                    <th>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {namespaces.map((item) => {
                    const healthRow = namespaceHealth.find((row) => row.namespace === item.name);
                    return (
                      <tr key={`${item.cluster_name}-${item.name}`}>
                        <td>
                          <Link
                            href={buildResourceHref(
                              `/k8s/namespaces/${encodeURIComponent(item.name)}`,
                              scopeProjectId,
                              scopeCluster,
                              scopeEnvironment,
                              item.name,
                            )}
                            className="k8s-link-cell"
                          >
                            <span className="k8s-link-cell__title">{item.name}</span>
                            <span className="k8s-link-cell__meta">{item.cluster_name}</span>
                          </Link>
                        </td>
                        <td><span className={`portal-pill ${clusterStatusTone(healthRow?.status || item.status)}`}>{healthRow?.status || item.status}</span></td>
                        <td>{healthRow?.issue_count || 0}</td>
                        <td>{healthRow?.restarting_pods || 0}</td>
                        <td>{healthRow?.warning_logs || 0}</td>
                        <td>{healthRow?.affected_deployments || 0}</td>
                        <td>{formatDateTime(item.last_activity)}</td>
                      </tr>
                    );
                  })}
                  {!loading && namespaces.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="portal-empty">
                          <p>No namespaces are available for this cluster and filter combination yet.</p>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Workload focus</span>
                <h2 className="portal-surface__title">Workload spotlights</h2>
                <p className="portal-surface__subtitle">
                  These are the workloads worth checking first when a cluster starts looking noisy.
                </p>
              </div>
            </div>

            <div className="k8s-spotlight-grid">
              {workloadSpotlights.map((item) => (
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
              {!loading && workloadSpotlights.length === 0 ? (
                <div className="portal-empty">
                  <p>No workload spotlights are available for this cluster yet.</p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Blast radius</span>
                <h2 className="portal-surface__title">Namespace dependency pressure</h2>
                <p className="portal-surface__subtitle">
                  This layer helps us see which namespaces are absorbing the most pressure across workloads, logs, and event flow before the issue fans out.
                </p>
              </div>
            </div>

            <div className="k8s-diagnostic-grid">
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Impacted namespaces</span>
                <strong className="k8s-diagnostic-card__value">{blastRadius.impactedNamespaceCount}</strong>
                <span className="k8s-diagnostic-card__meta">Namespaces carrying any warning, restart, or deployment pressure.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">High pressure</span>
                <strong className="k8s-diagnostic-card__value">{blastRadius.highPressureCount}</strong>
                <span className="k8s-diagnostic-card__meta">Namespaces where multiple signals are stacking at once.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Deployment impact</span>
                <strong className="k8s-diagnostic-card__value">{blastRadius.deploymentImpact}</strong>
                <span className="k8s-diagnostic-card__meta">Deployment slots already caught inside the current pressure band.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Noisy signals</span>
                <strong className="k8s-diagnostic-card__value">{blastRadius.noisySignalCount}</strong>
                <span className="k8s-diagnostic-card__meta">Recent event and log signals connected to impacted namespaces.</span>
              </div>
            </div>

            <div className="k8s-spotlight-grid">
              {blastRadius.topNamespaces.map((item) => (
                <article key={`${item.clusterName}-${item.name}`} className="k8s-spotlight-card">
                  <div className="k8s-spotlight-card__header">
                    <div>
                      <h3 className="k8s-spotlight-card__title">{item.name}</h3>
                      <p className="k8s-spotlight-card__meta">{item.clusterName} · primary workload {item.primaryWorkload}</p>
                    </div>
                    <span className={`portal-pill ${clusterStatusTone(item.status)}`}>{item.status}</span>
                  </div>
                  <div className="k8s-spotlight-card__stats">
                    <span>Pressure {item.pressureScore}</span>
                    <span>Deployments {item.affectedDeployments}</span>
                    <span>Restarts {item.restartingPods}</span>
                    <span>Events {item.namespaceEventCount}</span>
                  </div>
                </article>
              ))}
              {!loading && blastRadius.topNamespaces.length === 0 ? (
                <div className="portal-empty">
                  <p>No namespace blast-radius hotspots are visible for this cluster right now.</p>
                </div>
              ) : null}
            </div>

            <div className="k8s-guidance-list">
              {blastGuidance.map((item) => (
                <div key={item} className="k8s-guidance-list__item">
                  {item}
                </div>
              ))}
            </div>
          </section>

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Incident watchlist</span>
                <h2 className="portal-surface__title">Namespace incident correlation</h2>
                <p className="portal-surface__subtitle">
                  This lines up namespace pressure with event and log signals so we can see which cluster areas are closest to becoming active incidents.
                </p>
              </div>
            </div>

            <div className="k8s-diagnostic-grid">
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Likely incidents</span>
                <strong className="k8s-diagnostic-card__value">{incidentCorrelation.likelyIncidentCount}</strong>
                <span className="k8s-diagnostic-card__meta">Namespaces where runtime pressure already lines up with event or log evidence.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Cross-signal namespaces</span>
                <strong className="k8s-diagnostic-card__value">{incidentCorrelation.crossSignalCount}</strong>
                <span className="k8s-diagnostic-card__meta">Namespaces showing both event churn and warning-heavy log flow.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Restart-linked</span>
                <strong className="k8s-diagnostic-card__value">{incidentCorrelation.restartLinkedCount}</strong>
                <span className="k8s-diagnostic-card__meta">Namespaces where pod restart pressure is part of the current incident picture.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Deployment-linked</span>
                <strong className="k8s-diagnostic-card__value">{incidentCorrelation.deploymentLinkedCount}</strong>
                <span className="k8s-diagnostic-card__meta">Namespaces where deployment degradation is already part of the correlation trail.</span>
              </div>
            </div>

            <div className="k8s-trace-list">
              {incidentCorrelation.topNamespaces.map((item) => (
                <article key={`${item.clusterName}-${item.name}-incident`} className="k8s-trace-item">
                  <div className="k8s-trace-item__header">
                    <strong className="k8s-trace-item__title">{item.name}</strong>
                    <span className="portal-pill">Correlation {item.correlationScore}</span>
                  </div>
                  <p className="k8s-trace-item__meta">
                    {item.clusterName} · workload {item.primaryWorkload} · events {item.warningEventCount} · warning logs {item.warningLogCount}
                  </p>
                  <div className="k8s-trace-item__issues">
                    <span className="k8s-trace-item__issue">Top event: {item.topEventReason}</span>
                    <span className="k8s-trace-item__issue">Top log signal: {item.topLogSignal}</span>
                    <span className="k8s-trace-item__issue">{item.nextAction}</span>
                  </div>
                </article>
              ))}
              {!loading && incidentCorrelation.topNamespaces.length === 0 ? (
                <div className="portal-empty">
                  <p>No namespace incident correlations are visible for this cluster right now.</p>
                </div>
              ) : null}
            </div>
          </section>

          <div className="k8s-detail-columns">
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Recent events</span>
                  <h2 className="portal-surface__title">Cluster event feed</h2>
                </div>
              </div>
              <div className="k8s-feed">
                {recentEvents.map((event) => (
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
                {!loading && recentEvents.length === 0 ? (
                  <div className="portal-empty">
                    <p>No recent events for this cluster yet.</p>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Recent logs</span>
                  <h2 className="portal-surface__title">Warning and rollout signals</h2>
                </div>
              </div>
              <div className="k8s-feed">
                {recentLogs.map((log) => (
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
                {!loading && recentLogs.length === 0 ? (
                  <div className="portal-empty">
                    <p>No recent logs are available for this cluster yet.</p>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
