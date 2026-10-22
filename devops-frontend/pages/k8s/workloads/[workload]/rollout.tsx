import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../../../components/DevOpsLayout';
import K8sOperatorNextSteps from '../../../../components/K8sOperatorNextSteps';
import K8sWorkspaceShell from '../../../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../../../context/ApiUrlContext';
import { buildClusterWorkspaceEntry } from '../../../../lib/k8sWorkspaceNav';
import {
  buildK8sHref,
  fetchK8sActivity,
  fetchK8sRolloutDetail,
  formatDateTime,
  K8sActivityData,
  K8sRolloutDetailData,
  readQueryString,
} from '../../../../lib/k8sWorkspace';

function rolloutTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'healthy' || normalized === 'running') return 'k8s-data-pill k8s-data-pill--healthy';
  if (normalized === 'warning' || normalized === 'pending' || normalized === 'degraded') return 'k8s-data-pill k8s-data-pill--expiring';
  return 'k8s-data-pill k8s-data-pill--critical';
}

export default function DevOpsK8sWorkloadRolloutPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [detail, setDetail] = useState<K8sRolloutDetailData | null>(null);
  const [activity, setActivity] = useState<K8sActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectId, setProjectId] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [environment, setEnvironment] = useState('');
  const [workloadName, setWorkloadName] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    setProjectId(readQueryString(router.query.project_id));
    setClusterName(readQueryString(router.query.cluster_name));
    setNamespace(readQueryString(router.query.namespace));
    setEnvironment(readQueryString(router.query.environment));
    setWorkloadName(readQueryString(router.query.workload_name) || readQueryString(router.query.workload));
  }, [
    router.isReady,
    router.query.cluster_name,
    router.query.environment,
    router.query.namespace,
    router.query.project_id,
    router.query.workload,
    router.query.workload_name,
  ]);

  useEffect(() => {
    if (!router.isReady || !workloadName) return;
    let active = true;
    setLoading(true);
    setError('');

    Promise.all([
      fetchK8sRolloutDetail(apiUrl, {
        project_id: projectId || undefined,
        cluster_name: clusterName || undefined,
        namespace: namespace || undefined,
        environment: environment || undefined,
        workload_name: workloadName,
      }),
      fetchK8sActivity(apiUrl, {
        project_id: projectId || undefined,
        cluster_name: clusterName || undefined,
        namespace: namespace || undefined,
        environment: environment || undefined,
        workload_name: workloadName,
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
        setError(err instanceof Error ? err.message : 'Failed to load rollout detail');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [apiUrl, clusterName, environment, namespace, projectId, refreshKey, router.isReady, workloadName]);

  const workload = detail?.workload;
  const scopeProjectId = projectId || String(detail?.selected_project_id || '');
  const scopeCluster = clusterName || workload?.cluster_name || '';
  const scopeNamespace = namespace || workload?.namespace || '';
  const activityItems = activity?.items || [];
  const summary = useMemo(
    () => ({
      timeline: detail?.timeline.length || 0,
      replicasets: detail?.replicasets.length || 0,
      pods: detail?.pods.length || 0,
      services: detail?.services.length || 0,
    }),
    [detail],
  );
  const diagnostics = useMemo(() => {
    const unavailableReplicas = Math.max((workload?.replicas ?? 0) - (workload?.ready_replicas ?? 0), 0);
    const restartPressure = (detail?.pods || []).reduce((sum, item) => sum + item.restarts, 0);
    const eventWarnings = (detail?.recent_events || []).filter((item) => item.severity.trim().toLowerCase() === 'warning').length;
    const logSignals = (detail?.recent_logs || []).filter((item) =>
      ['warning', 'error', 'critical'].includes(item.level.trim().toLowerCase()),
    ).length;
    const rolloutStepsAtRisk = (detail?.timeline || []).filter((item) =>
      ['warning', 'pending', 'degraded', 'blocked', 'critical', 'failed'].includes(item.status.trim().toLowerCase()),
    ).length;
    return {
      unavailableReplicas,
      restartPressure,
      eventWarnings,
      logSignals,
      rolloutStepsAtRisk,
      operatorActions: activityItems.length,
    };
  }, [activityItems.length, detail, workload]);
  const revisionCompare = useMemo(() => {
    const current = detail?.replicasets?.[0];
    const previous = detail?.replicasets?.[1] || null;
    if (!current) return null;
    const currentGap = Math.max(current.desired_replicas - current.ready_replicas, 0);
    const previousGap = previous ? Math.max(previous.desired_replicas - previous.ready_replicas, 0) : 0;
    const replicaDelta = previous ? current.ready_replicas - previous.ready_replicas : current.ready_replicas;
    const restartDelta = (detail?.pods || []).reduce((sum, item) => sum + item.restarts, 0);
    return {
      current,
      previous,
      currentGap,
      previousGap,
      replicaDelta,
      restartDelta,
      latestCheckpoint: detail?.timeline?.[0]?.timestamp || '',
    };
  }, [detail]);
  const checkpointSummary = useMemo(() => {
    const steps = detail?.timeline || [];
    return {
      blocked: steps.filter((item) => ['blocked', 'failed', 'critical'].includes(item.status.trim().toLowerCase())).length,
      degraded: steps.filter((item) => ['warning', 'pending', 'degraded'].includes(item.status.trim().toLowerCase())).length,
      completed: steps.filter((item) => ['healthy', 'running', 'complete', 'completed'].includes(item.status.trim().toLowerCase())).length,
      latestTitle: steps[0]?.title || 'No checkpoint yet',
    };
  }, [detail]);
  const rolloutImpact = useMemo(() => {
    const services = detail?.services || [];
    const pods = detail?.pods || [];
    const exposedServices = services.filter((item) => {
      const exposure = item.exposure.trim().toLowerCase();
      return exposure !== '' && exposure !== 'internal' || item.ingress_host.trim() !== '' || item.external_ip.trim() !== '';
    });
    const unhealthyPods = pods.filter((item) => {
      const status = item.status.trim().toLowerCase();
      return status !== 'running' && status !== 'healthy' && status !== 'ready';
    });
    const namespaceRiskScore =
      Math.max((workload?.replicas ?? 0) - (workload?.ready_replicas ?? 0), 0) * 3 +
      unhealthyPods.length * 2 +
      exposedServices.length * 2 +
      diagnostics.eventWarnings +
      diagnostics.logSignals;
    return {
      serviceCount: services.length,
      exposedServices: exposedServices.length,
      unhealthyPods: unhealthyPods.length,
      namespaceRiskScore,
      topServiceTargets: services
        .map((item) => ({
          ...item,
          riskScore:
            ((item.exposure.trim().toLowerCase() !== '' && item.exposure.trim().toLowerCase() !== 'internal') ||
            item.ingress_host.trim() !== '' ||
            item.external_ip.trim() !== ''
              ? 3
              : 0) +
            (item.selector.trim() === '' ? 2 : 0) +
            (item.ingress_host.trim() !== '' ? 1 : 0),
        }))
        .sort((left, right) => right.riskScore - left.riskScore)
        .slice(0, 4),
    };
  }, [detail, diagnostics.eventWarnings, diagnostics.logSignals, workload]);
  const namespaceImpactGuidance = useMemo(() => {
    const items: string[] = [];
    if (rolloutImpact.exposedServices > 0) {
      items.push(
        `${rolloutImpact.exposedServices} service path(s) are externally reachable from this rollout scope. Validate service health before resuming more change.`,
      );
    }
    if (rolloutImpact.unhealthyPods > 0) {
      items.push(
        `${rolloutImpact.unhealthyPods} pod replica(s) are not healthy or running. That is the quickest sign the rollout blast radius is already leaking into runtime.`,
      );
    }
    if (rolloutImpact.namespaceRiskScore >= 8) {
      items.push('Namespace risk is elevated. Treat this rollout as a cross-signal issue, not just a ReplicaSet mismatch.');
    }
    if (items.length === 0) {
      items.push('Namespace impact is still contained. Use this as a controlled checkpoint before the next rollout action.');
    }
    return items;
  }, [rolloutImpact.exposedServices, rolloutImpact.namespaceRiskScore, rolloutImpact.unhealthyPods]);
  const guidance = useMemo(() => {
    const items: string[] = [];
    if (diagnostics.unavailableReplicas > 0) {
      items.push('Ready replicas are lagging the desired count. Keep the rollout under watch before resuming more changes.');
    }
    if (diagnostics.restartPressure > 0) {
      items.push('Pod restarts are already present in this revision. Check the pod drilldown before pushing another restart.');
    }
    if (diagnostics.eventWarnings > 0 || diagnostics.rolloutStepsAtRisk > 0) {
      items.push('Warning events or degraded timeline steps are active. Use the event trail to isolate which revision change introduced pressure.');
    }
    if (diagnostics.operatorActions === 0) {
      items.push('No recent operator actions are recorded for this workload, so the current state is likely coming from the rollout itself rather than a manual intervention.');
    }
    if (items.length === 0) {
      items.push('Rollout signals are stable right now. This is a good time to compare replicas, services, and recent logs before the next change window.');
    }
    return items;
  }, [diagnostics]);

  const scopeQuery = {
    project_id: scopeProjectId || undefined,
    cluster_name: scopeCluster || undefined,
    namespace: scopeNamespace || undefined,
    environment: environment || undefined,
  };

  const operatorLinks = [
    {
      href: buildK8sHref('/k8s/pods', scopeQuery),
      label: 'Backing pods',
      detail: 'Move into the pod list for this rollout scope and inspect which replicas are still carrying pressure.',
    },
    {
      href: buildK8sHref('/k8s/services', scopeQuery),
      label: 'Service impact',
      detail: 'Check the exposed services behind this rollout before sending more change into the workload.',
    },
    {
      href: buildK8sHref('/k8s/logs', scopeQuery),
      label: 'Runtime logs',
      detail: 'Confirm whether rollout warnings still show up in the latest cluster log stream.',
    },
    {
      href: buildK8sHref('/k8s/events', scopeQuery),
      label: 'Event trail',
      detail: 'Compare rollout checkpoints with the most recent event churn in this namespace.',
    },
    {
      href: buildClusterWorkspaceEntry(scopeCluster, {
        project_id: scopeProjectId || undefined,
        namespace: namespace || undefined,
        environment: environment || undefined,
      }),
      label: 'Cluster blast radius',
      detail: 'Step back to the cluster view when you need to understand whether rollout pressure is spreading outward.',
    },
  ];

  return (
    <>
      <Head>
        <title>Rollout Detail - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Rollout Detail"
          subtitle="Review rollout state, ReplicaSet readiness, and the event trail before you restart, scale, or resume the workload."
          queryState={{ project_id: projectId, cluster_name: clusterName, namespace, environment }}
          actions={
            <div className="k8s-action-buttons">
              <Link className="btn btn-secondary" href={buildK8sHref('/k8s/rollouts', { project_id: scopeProjectId, cluster_name: scopeCluster, namespace: scopeNamespace, environment })}>
                Back to rollouts
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

          {workload ? (
            <K8sOperatorNextSteps
              title="Operator handoff"
              subtitle="Keep the rollout scope and move directly into the next cluster surface that explains impact, signal pressure, or recovery options."
              items={operatorLinks}
            />
          ) : null}

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Rollout inspection</span>
                <h2 className="portal-surface__title">{workload?.name || workloadName || 'Rollout detail'}</h2>
                <p className="portal-surface__subtitle">
                  Keep rollout, event, and pod pressure signals together so operators can decide whether to wait, resume, restart, or scale.
                </p>
              </div>
            </div>

            <div className="k8s-detail-grid">
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Status</span>
                <div className="k8s-detail-card__value">
                  {workload ? <span className={rolloutTone(workload.status)}>{workload.status}</span> : '—'}
                </div>
                <span className="k8s-detail-card__meta">Cluster {workload?.cluster_name || '—'} · Namespace {workload?.namespace || '—'}</span>
              </div>
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Replica readiness</span>
                <span className="k8s-detail-card__value">{workload ? `${workload.ready_replicas}/${workload.replicas}` : '—'}</span>
                <span className="k8s-detail-card__meta">Updated replicas {workload?.updated_replicas ?? 0}</span>
              </div>
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Image</span>
                <span className="k8s-detail-card__value">{workload?.image || 'No image recorded'}</span>
                <span className="k8s-detail-card__meta">CPU {workload?.cpu_utilization_pct ?? 0}% · Memory {workload?.memory_utilization_gb ?? 0} GB</span>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Timeline steps</span>
                <strong className="k8s-summary-card__value">{summary.timeline}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">ReplicaSets</span>
                <strong className="k8s-summary-card__value">{summary.replicasets}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Pods</span>
                <strong className="k8s-summary-card__value">{summary.pods}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Services</span>
                <strong className="k8s-summary-card__value">{summary.services}</strong>
              </div>
            </div>

            <div className="k8s-diagnostic-grid">
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Unavailable replicas</span>
                <strong className="k8s-diagnostic-card__value">{diagnostics.unavailableReplicas}</strong>
                <span className="k8s-diagnostic-card__meta">Desired {workload?.replicas ?? 0} · Ready {workload?.ready_replicas ?? 0}</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Event pressure</span>
                <strong className="k8s-diagnostic-card__value">{diagnostics.eventWarnings}</strong>
                <span className="k8s-diagnostic-card__meta">{diagnostics.rolloutStepsAtRisk} rollout step(s) are still warning or pending</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Restart pressure</span>
                <strong className="k8s-diagnostic-card__value">{diagnostics.restartPressure}</strong>
                <span className="k8s-diagnostic-card__meta">{detail?.pods.length || 0} pod replica(s) contribute to this count</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Operator actions</span>
                <strong className="k8s-diagnostic-card__value">{diagnostics.operatorActions}</strong>
                <span className="k8s-diagnostic-card__meta">{diagnostics.logSignals} recent warning/error log signal(s)</span>
              </div>
            </div>

            <div className="k8s-detail-columns">
              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Timeline</span>
                    <h3 className="portal-surface__title">Rollout history</h3>
                  </div>
                </div>
                <div className="k8s-rollout-timeline">
                  {(detail?.timeline || []).map((item, index) => (
                    <div key={`${item.title}-${item.timestamp}-${index}`} className="k8s-rollout-step">
                      <div className="k8s-rollout-step__header">
                        <span className={rolloutTone(item.status)}>{item.status || 'info'}</span>
                        <span className="k8s-feed__meta">{formatDateTime(item.timestamp)}</span>
                      </div>
                      <div className="k8s-rollout-step__title">{item.title}</div>
                      <p className="k8s-rollout-step__detail">{item.detail}</p>
                    </div>
                  ))}
                  {!loading && (detail?.timeline.length || 0) === 0 ? (
                    <div className="portal-empty">
                      <p>No rollout steps are recorded for this workload yet.</p>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">ReplicaSets</span>
                    <h3 className="portal-surface__title">Revision pressure</h3>
                  </div>
                </div>
                <div className="k8s-feed">
                  {revisionCompare ? (
                    <div className="k8s-compare-grid">
                      <div className="k8s-compare-card">
                        <span className="k8s-compare-card__label">Current revision</span>
                        <strong className="k8s-compare-card__value">{revisionCompare.current.name}</strong>
                        <span className="k8s-compare-card__meta">
                          {revisionCompare.current.ready_replicas}/{revisionCompare.current.desired_replicas} ready · gap {revisionCompare.currentGap}
                        </span>
                      </div>
                      <div className="k8s-compare-card">
                        <span className="k8s-compare-card__label">Previous revision</span>
                        <strong className="k8s-compare-card__value">{revisionCompare.previous?.name || 'No prior revision'}</strong>
                        <span className="k8s-compare-card__meta">
                          {revisionCompare.previous
                            ? `${revisionCompare.previous.ready_replicas}/${revisionCompare.previous.desired_replicas} ready · gap ${revisionCompare.previousGap}`
                            : 'This is the only visible revision in scope.'}
                        </span>
                      </div>
                      <div className="k8s-compare-card">
                        <span className="k8s-compare-card__label">Shift signal</span>
                        <strong className="k8s-compare-card__value">
                          {revisionCompare.replicaDelta >= 0 ? '+' : ''}
                          {revisionCompare.replicaDelta} ready replica change
                        </strong>
                        <span className="k8s-compare-card__meta">
                          Restart pressure {revisionCompare.restartDelta} · latest checkpoint {formatDateTime(revisionCompare.latestCheckpoint)}
                        </span>
                      </div>
                    </div>
                  ) : null}
                  {(detail?.replicasets || []).map((item) => (
                    <div key={`${item.cluster_name}-${item.namespace}-${item.name}`} className="k8s-feed__item">
                      <div className="k8s-feed__header">
                        <div className="k8s-feed__title">{item.name}</div>
                        <span className={rolloutTone(item.ready_replicas === item.desired_replicas ? 'healthy' : 'warning')}>
                          {item.ready_replicas}/{item.desired_replicas}
                        </span>
                      </div>
                      <p className="k8s-feed__message">{item.namespace} · {item.age || 'Unknown age'} · Deployment {item.deployment}</p>
                    </div>
                  ))}
                </div>
              </section>
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
                          <span className={rolloutTone(item.action.includes('terminal') || item.action.includes('restart') ? 'warning' : 'healthy')}>
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
                    <p>No recent K8s operator actions are recorded for this rollout yet.</p>
                  </div>
                )}
              </section>

              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Rollout posture</span>
                    <h3 className="portal-surface__title">Change surface</h3>
                  </div>
                </div>
                <div className="k8s-guidance-list">
                  <div className="k8s-guidance-list__item">
                    Image {workload?.image || 'not recorded'}
                  </div>
                  <div className="k8s-guidance-list__item">
                    Cluster {scopeCluster || '—'} · Namespace {scopeNamespace || '—'}
                  </div>
                  <div className="k8s-guidance-list__item">
                    Updated replicas {workload?.updated_replicas ?? 0} · Services in scope {summary.services}
                  </div>
                  <div className="k8s-guidance-list__item">
                    Latest checkpoint {checkpointSummary.latestTitle} · blocked {checkpointSummary.blocked} · degraded {checkpointSummary.degraded}
                  </div>
                  <div className="k8s-guidance-list__item">
                    Healthy checkpoints {checkpointSummary.completed} · visible revisions {summary.replicasets}
                  </div>
                </div>
              </section>
            </div>

            <div className="k8s-diagnostic-grid">
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Namespace risk</span>
                <strong className="k8s-diagnostic-card__value">{rolloutImpact.namespaceRiskScore}</strong>
                <span className="k8s-diagnostic-card__meta">Combined rollout, service, pod, and signal pressure in this namespace scope.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Services in blast radius</span>
                <strong className="k8s-diagnostic-card__value">{rolloutImpact.serviceCount}</strong>
                <span className="k8s-diagnostic-card__meta">{rolloutImpact.exposedServices} externally reachable service path(s).</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Unhealthy pods</span>
                <strong className="k8s-diagnostic-card__value">{rolloutImpact.unhealthyPods}</strong>
                <span className="k8s-diagnostic-card__meta">Replica pressure that can spill directly into service behavior.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Top service traces</span>
                <strong className="k8s-diagnostic-card__value">{rolloutImpact.topServiceTargets.length}</strong>
                <span className="k8s-diagnostic-card__meta">Priority service paths to validate before more rollout change.</span>
              </div>
            </div>

            <div className="k8s-detail-columns">
              <div className="k8s-section-stack">
                <h3 className="k8s-section-stack__title">Namespace to rollout impact trace</h3>
                <div className="k8s-trace-list">
                  {rolloutImpact.topServiceTargets.map((service) => (
                    <article key={`${service.cluster_name}-${service.namespace}-${service.name}-impact`} className="k8s-trace-item">
                      <div className="k8s-trace-item__header">
                        <div className="k8s-trace-item__title">{service.name}</div>
                        <span className="portal-pill">Risk {service.riskScore}</span>
                      </div>
                      <p className="k8s-trace-item__meta">
                        {service.namespace} · {service.type || 'Service'} · {service.ports || 'Ports pending'} · {service.exposure || 'internal'}
                      </p>
                      <div className="k8s-trace-item__issues">
                        {(service.exposure.trim().toLowerCase() !== '' && service.exposure.trim().toLowerCase() !== 'internal') ||
                        service.ingress_host.trim() !== '' ||
                        service.external_ip.trim() !== '' ? (
                          <span className="k8s-trace-item__issue">Traffic can reach this rollout through an exposed service path.</span>
                        ) : null}
                        {service.selector.trim() === '' ? (
                          <span className="k8s-trace-item__issue">Selector ownership is unclear for this service.</span>
                        ) : null}
                        {service.ingress_host.trim() !== '' ? (
                          <span className="k8s-trace-item__issue">Ingress host {service.ingress_host}</span>
                        ) : null}
                      </div>
                    </article>
                  ))}
                  {!loading && rolloutImpact.topServiceTargets.length === 0 ? (
                    <div className="portal-empty">
                      <p>No service blast-radius targets are visible for this rollout right now.</p>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="k8s-section-stack">
                <h3 className="k8s-section-stack__title">Recommended namespace checks</h3>
                <div className="k8s-guidance-list">
                  {namespaceImpactGuidance.map((item) => (
                    <div key={item} className="k8s-guidance-list__item">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="k8s-spotlight-grid">
              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Pods</span>
                    <h3 className="portal-surface__title">Current replica view</h3>
                  </div>
                </div>
                {(detail?.pods || []).map((item) => (
                  <div key={`${item.cluster_name}-${item.namespace}-${item.name}`} className="k8s-log-feed__item">
                    <div className="k8s-log-feed__meta">
                      <span className={rolloutTone(item.status)}>{item.status}</span>
                      <span>{item.name}</span>
                      <span>{item.restarts} restart(s)</span>
                    </div>
                    <div className="k8s-log-feed__message">{item.node || 'No node assignment'} · {item.age || 'Unknown age'}</div>
                  </div>
                ))}
              </section>

              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Recent events</span>
                    <h3 className="portal-surface__title">Event trail</h3>
                  </div>
                </div>
                {(detail?.recent_events || []).map((item) => (
                  <div key={item.id || `${item.reason}-${item.timestamp}`} className="k8s-log-feed__item">
                    <div className="k8s-log-feed__meta">
                      <span className={rolloutTone(item.severity)}>{item.severity}</span>
                      <span>{item.reason}</span>
                      <span>{formatDateTime(item.timestamp)}</span>
                    </div>
                    <div className="k8s-log-feed__message">{item.message}</div>
                  </div>
                ))}
              </section>

              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Recent logs</span>
                    <h3 className="portal-surface__title">Workload signals</h3>
                  </div>
                </div>
                {(detail?.recent_logs || []).map((item, index) => (
                  <div key={`${item.timestamp}-${index}`} className="k8s-log-feed__item">
                    <div className="k8s-log-feed__meta">
                      <span className={rolloutTone(item.level)}>{item.level || 'info'}</span>
                      <span>{item.container || 'main'}</span>
                      <span>{formatDateTime(item.timestamp)}</span>
                    </div>
                    <div className="k8s-log-feed__message">{item.message}</div>
                  </div>
                ))}
              </section>
            </div>
          </section>
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
