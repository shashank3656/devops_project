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
  fetchK8sEvents,
  fetchK8sIngresses,
  fetchK8sLogs,
  fetchK8sPods,
  fetchK8sServices,
  fetchK8sWorkloads,
  formatDateTime,
  K8sEventsData,
  K8sIngressesData,
  K8sLogsData,
  K8sPodsData,
  K8sServicesData,
  K8sWorkloadsData,
  readQueryString,
} from '../../../lib/k8sWorkspace';

function normalizeDependencyName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

type K8sServiceRow = K8sServicesData['items'][number];

function describeServiceRisk(item: K8sServiceRow) {
  const exposure = item.exposure.trim().toLowerCase();
  const type = item.type.trim().toLowerCase();
  const ingressBacked = item.ingress_host.trim() !== '';
  const isExternal =
    (exposure !== '' && exposure !== 'internal') || ingressBacked || item.external_ip.trim() !== '';
  const noSelector = item.selector.trim() === '';
  const addressGap =
    !item.cluster_ip.trim() &&
    !item.external_ip.trim() &&
    !item.ingress_host.trim() &&
    type !== 'externalname';
  const issues: string[] = [];

  if (isExternal) {
    issues.push(
      ingressBacked
        ? 'Traffic can reach this service through an ingress route.'
        : 'Traffic can reach this service directly from outside the cluster.',
    );
  }
  if (noSelector) {
    issues.push('Selector is missing, so backend ownership is unclear.');
  }
  if (addressGap) {
    issues.push('No cluster or external address is published yet.');
  }
  if (type === 'externalname') {
    issues.push('This service depends on an external name outside the cluster boundary.');
  }

  const riskScore =
    (isExternal ? 3 : 0) +
    (ingressBacked ? 2 : 0) +
    (noSelector ? 3 : 0) +
    (addressGap ? 2 : 0) +
    (type === 'externalname' ? 1 : 0);

  return {
    ingressBacked,
    isExternal,
    noSelector,
    addressGap,
    riskScore,
    issues,
  };
}

function statusTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'running' || normalized === 'healthy' || normalized === 'ready' || normalized === 'internal') {
    return 'k8s-data-pill k8s-data-pill--healthy';
  }
  if (normalized === 'warning' || normalized === 'degraded' || normalized === 'pending' || normalized === 'expiring') {
    return 'k8s-data-pill k8s-data-pill--expiring';
  }
  if (normalized === 'external' || normalized === 'public' || normalized === 'clusterip') {
    return 'k8s-data-pill k8s-data-pill--normal';
  }
  return 'k8s-data-pill';
}

export default function DevOpsK8sServiceDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [serviceOverview, setServiceOverview] = useState<K8sServicesData | null>(null);
  const [workloadOverview, setWorkloadOverview] = useState<K8sWorkloadsData | null>(null);
  const [podOverview, setPodOverview] = useState<K8sPodsData | null>(null);
  const [ingressOverview, setIngressOverview] = useState<K8sIngressesData | null>(null);
  const [logOverview, setLogOverview] = useState<K8sLogsData | null>(null);
  const [eventOverview, setEventOverview] = useState<K8sEventsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectId, setProjectId] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [environment, setEnvironment] = useState('');
  const [serviceName, setServiceName] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    setProjectId(readQueryString(router.query.project_id));
    setClusterName(readQueryString(router.query.cluster_name));
    setNamespace(readQueryString(router.query.namespace));
    setEnvironment(readQueryString(router.query.environment));
    setServiceName(readQueryString(router.query.name));
  }, [
    router.isReady,
    router.query.cluster_name,
    router.query.environment,
    router.query.name,
    router.query.namespace,
    router.query.project_id,
  ]);

  useEffect(() => {
    if (!router.isReady || !serviceName) return;
    let active = true;
    setLoading(true);
    setError('');

    Promise.all([
      fetchK8sServices(apiUrl, {
        project_id: projectId || undefined,
        cluster_name: clusterName || undefined,
        namespace: namespace || undefined,
        environment: environment || undefined,
      }),
      fetchK8sWorkloads(apiUrl, {
        project_id: projectId || undefined,
        cluster_name: clusterName || undefined,
        namespace: namespace || undefined,
        environment: environment || undefined,
      }),
      fetchK8sPods(apiUrl, {
        project_id: projectId || undefined,
        cluster_name: clusterName || undefined,
        namespace: namespace || undefined,
        environment: environment || undefined,
      }),
      fetchK8sIngresses(apiUrl, {
        project_id: projectId || undefined,
        cluster_name: clusterName || undefined,
        namespace: namespace || undefined,
        environment: environment || undefined,
      }),
      fetchK8sLogs(apiUrl, {
        project_id: projectId || undefined,
        cluster_name: clusterName || undefined,
        namespace: namespace || undefined,
        environment: environment || undefined,
      }),
      fetchK8sEvents(apiUrl, {
        project_id: projectId || undefined,
        cluster_name: clusterName || undefined,
        namespace: namespace || undefined,
        environment: environment || undefined,
      }),
    ])
      .then(([services, workloads, pods, ingresses, logs, events]) => {
        if (!active) return;
        setServiceOverview(services);
        setWorkloadOverview(workloads);
        setPodOverview(pods);
        setIngressOverview(ingresses);
        setLogOverview(logs);
        setEventOverview(events);
      })
      .catch((err) => {
        if (!active) return;
        setServiceOverview(null);
        setWorkloadOverview(null);
        setPodOverview(null);
        setIngressOverview(null);
        setLogOverview(null);
        setEventOverview(null);
        setError(err instanceof Error ? err.message : 'Failed to load service detail');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [apiUrl, clusterName, environment, namespace, projectId, refreshKey, router.isReady, serviceName]);

  const activeService = useMemo(() => {
    const items = serviceOverview?.items || [];
    return (
      items.find(
        (item) =>
          item.name === serviceName &&
          (!namespace || item.namespace === namespace) &&
          (!clusterName || item.cluster_name === clusterName),
      ) ||
      items.find((item) => item.name === serviceName) ||
      null
    );
  }, [clusterName, namespace, serviceName, serviceOverview?.items]);

  const scopeCluster = clusterName || activeService?.cluster_name || '';
  const scopeNamespace = namespace || activeService?.namespace || '';
  const scopeQuery = {
    project_id: projectId || undefined,
    cluster_name: scopeCluster || undefined,
    namespace: scopeNamespace || undefined,
    environment: environment || undefined,
  };

  const servicesHref = buildK8sHref('/k8s/services', scopeQuery);
  const namespaceHref = scopeNamespace
    ? buildK8sHref(`/k8s/namespaces/${encodeURIComponent(scopeNamespace)}`, {
        project_id: projectId || undefined,
        cluster_name: scopeCluster || undefined,
        environment: environment || undefined,
      })
    : '/k8s/services';

  const serviceTrace = useMemo(() => {
    if (!activeService) return null;
    const workloads = workloadOverview?.items || [];
    const pods = podOverview?.items || [];
    const ingresses = ingressOverview?.items || [];
    const logs = logOverview?.items || [];
    const events = eventOverview?.items || [];
    const risk = describeServiceRisk(activeService);
    const normalizedService = normalizeDependencyName(activeService.name);
    const selectorTokens = activeService.selector
      .split(/[,\s=]+/)
      .map((item) => normalizeDependencyName(item))
      .filter(Boolean);

    const matchedWorkloads = workloads.filter((workload) => {
      if (workload.namespace !== activeService.namespace || workload.cluster_name !== activeService.cluster_name) return false;
      const normalizedWorkload = normalizeDependencyName(workload.name);
      return (
        normalizedWorkload.includes(normalizedService) ||
        normalizedService.includes(normalizedWorkload) ||
        selectorTokens.some(
          (token) => token && (normalizedWorkload.includes(token) || token.includes(normalizedWorkload)),
        )
      );
    });

    const matchedPods = pods.filter((pod) => {
      if (pod.namespace !== activeService.namespace || pod.cluster_name !== activeService.cluster_name) return false;
      const normalizedPod = normalizeDependencyName(pod.name);
      return (
        normalizedPod.includes(normalizedService) ||
        matchedWorkloads.some((workload) => normalizedPod.includes(normalizeDependencyName(workload.name)))
      );
    });

    const unhealthyPods = matchedPods.filter((pod) => {
      const status = pod.status.trim().toLowerCase();
      return status !== 'running' && status !== 'healthy' && status !== 'ready';
    });

    const relatedIngresses = ingresses.filter((ingress) => {
      if (ingress.namespace !== activeService.namespace || ingress.cluster_name !== activeService.cluster_name) return false;
      const ingressFingerprint = normalizeDependencyName(`${ingress.name} ${ingress.host} ${ingress.paths}`);
      const serviceIngressHost = activeService.ingress_host.trim().toLowerCase();
      return (
        (!!serviceIngressHost &&
          (ingress.host.trim().toLowerCase().includes(serviceIngressHost) ||
            serviceIngressHost.includes(ingress.host.trim().toLowerCase()))) ||
        ingressFingerprint.includes(normalizedService)
      );
    });

    const peerServices = (serviceOverview?.items || [])
      .filter(
        (item) =>
          item.namespace === activeService.namespace &&
          item.cluster_name === activeService.cluster_name &&
          item.name !== activeService.name,
      )
      .map((item) => ({
        ...item,
        ...describeServiceRisk(item),
      }))
      .sort((left, right) => {
        if (right.riskScore !== left.riskScore) return right.riskScore - left.riskScore;
        return left.name.localeCompare(right.name);
      });

    const dependencyTokens = [
      normalizedService,
      ...matchedWorkloads.map((item) => normalizeDependencyName(item.name)),
      ...matchedPods.map((item) => normalizeDependencyName(item.name)),
    ].filter(Boolean);

    const serviceLogs = logs
      .filter((item) => {
        if (item.namespace !== activeService.namespace || item.cluster_name !== activeService.cluster_name) return false;
        const fingerprint = normalizeDependencyName(`${item.name} ${item.container} ${item.message}`);
        return dependencyTokens.some((token) => fingerprint.includes(token));
      })
      .slice(0, 6);

    const serviceEvents = events
      .filter((item) => {
        if (item.namespace !== activeService.namespace || item.cluster_name !== activeService.cluster_name) return false;
        const fingerprint = normalizeDependencyName(
          `${item.resource_kind} ${item.resource_name} ${item.reason} ${item.message}`,
        );
        return dependencyTokens.some((token) => fingerprint.includes(token));
      })
      .slice(0, 6);

    return {
      service: {
        ...activeService,
        ...risk,
      },
      matchedWorkloads,
      matchedPods,
      unhealthyPods,
      relatedIngresses,
      peerServices,
      serviceLogs,
      serviceEvents,
      restartPressure: matchedPods.reduce((sum, pod) => sum + pod.restarts, 0),
    };
  }, [
    activeService,
    eventOverview?.items,
    ingressOverview?.items,
    logOverview?.items,
    podOverview?.items,
    serviceOverview?.items,
    workloadOverview?.items,
  ]);

  const blastRadius = useMemo(() => {
    if (!serviceTrace) return null;
    const riskyPeers = serviceTrace.peerServices.filter((item) => item.riskScore > 0);
    const degradedIngresses = serviceTrace.relatedIngresses.filter((item) => {
      const status = `${item.status} ${item.certificate_status}`.trim().toLowerCase();
      return status.includes('warning') || status.includes('critical') || status.includes('expired') || status.includes('error');
    });
    const warningEvents = serviceTrace.serviceEvents.filter((item) => {
      const severity = item.severity.trim().toLowerCase();
      return severity === 'warning' || severity === 'critical' || severity === 'error';
    });
    const warningLogs = serviceTrace.serviceLogs.filter((item) => {
      const level = item.level.trim().toLowerCase();
      return level === 'warning' || level === 'critical' || level === 'error';
    });

    const guidance: string[] = [];
    if (serviceTrace.service.noSelector) {
      guidance.push('Selector ownership is missing here, so validate the backing workloads before treating this as only an ingress or DNS issue.');
    }
    if (serviceTrace.service.addressGap) {
      guidance.push('The service does not currently publish a stable address. Confirm whether this is an intentional staging point or incomplete service wiring.');
    }
    if (degradedIngresses.length > 0) {
      guidance.push('Ingress coverage is degraded for this service path. Review route and certificate posture before changing pod or rollout state.');
    }
    if (serviceTrace.unhealthyPods.length > 0 || serviceTrace.restartPressure > 0) {
      guidance.push('Pod health pressure is visible behind this service. Validate the backing pod set and rollout posture together.');
    }
    if (warningEvents.length > 0 || warningLogs.length > 0) {
      guidance.push('Recent events and logs line up with this service path. Use those signals first before widening the blast radius to the cluster.');
    }
    if (guidance.length === 0) {
      guidance.push('The service path looks stable right now. Use this page as a quick exposure checkpoint before moving back to namespace-level review.');
    }

    return {
      riskyPeers,
      degradedIngresses,
      warningEvents,
      warningLogs,
      guidance,
    };
  }, [serviceTrace]);

  const operatorLinks = [
    {
      href: namespaceHref,
      label: 'Namespace workspace',
      detail: 'Step back into the namespace view to compare this service with peer pressure and incident posture.',
    },
    {
      href: buildK8sHref('/k8s/ingresses', scopeQuery),
      label: 'Ingress coverage',
      detail: 'Check whether route, TLS, or edge exposure issues are shaping the current service blast radius.',
    },
    {
      href: buildK8sHref('/k8s/pods', scopeQuery),
      label: 'Backing pods',
      detail: 'Open the scoped pod list and move from this service into the live backing workload set.',
    },
    {
      href: buildK8sHref('/k8s/logs', scopeQuery),
      label: 'Runtime logs',
      detail: 'Use the same scope to validate whether the service path is still generating warning or error signals.',
    },
    {
      href: buildK8sHref('/k8s/events', scopeQuery),
      label: 'Recent events',
      detail: 'Compare event churn against the service path before widening the investigation into cluster-level issues.',
    },
  ];

  return (
    <>
      <Head>
        <title>{serviceName ? `${serviceName} - Service` : 'Service'} - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title={serviceName || 'Service'}
          subtitle="Use the service detail page to line up exposure, ingress posture, backing workloads, and live runtime signals in one place."
          queryState={{
            project_id: projectId,
            cluster_name: scopeCluster,
            namespace: scopeNamespace,
            environment,
          }}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((value) => value + 1)}>
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <Link href={servicesHref} className="btn btn-secondary">
                Back to services
              </Link>
            </>
          }
        >
          {error ? (
            <div className="portal-table-state portal-table-state--error">
              <div className="portal-table-state__icon" aria-hidden>!</div>
              <h3 className="portal-table-state__title">We couldn’t load this service</h3>
              <p className="portal-table-state__copy">{error}</p>
              <div className="portal-table-state__actions">
                <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((value) => value + 1)}>
                  Try again
                </button>
              </div>
            </div>
          ) : null}

          {loading && !error && !activeService ? (
            <div className="portal-table-state">
              <div className="portal-table-state__icon" aria-hidden>…</div>
              <h3 className="portal-table-state__title">Loading service detail</h3>
              <p className="portal-table-state__copy">
                We’re pulling the service path, backing workloads, ingress posture, and recent runtime signals now.
              </p>
            </div>
          ) : null}

          {!loading && !error && !serviceTrace ? (
            <div className="portal-table-state">
              <div className="portal-table-state__icon" aria-hidden>?</div>
              <h3 className="portal-table-state__title">Service not found</h3>
              <p className="portal-table-state__copy">
                This service is not visible in the current scope. Go back to the services list and reopen it from the current cluster and namespace context.
              </p>
              <div className="portal-table-state__actions">
                <Link href={servicesHref} className="btn btn-secondary">
                  Back to services
                </Link>
              </div>
            </div>
          ) : null}

          {serviceTrace && blastRadius ? (
            <>
              <K8sOperatorNextSteps
                title="Operator handoff"
                subtitle="Keep the same service scope and move directly into the next K8s surface without reapplying filters."
                items={operatorLinks}
              />

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Service workspace</span>
                    <h2 className="portal-surface__title">Operating context</h2>
                    <p className="portal-surface__subtitle">
                      This service view lines up exposure, namespace ownership, ingress reach, and runtime pressure without leaving the K8s workspace.
                    </p>
                  </div>
                </div>

                <div className="k8s-summary-strip">
                  <div className="k8s-summary-card">
                    <span className="k8s-summary-card__label">Matched workloads</span>
                    <strong className="k8s-summary-card__value">{serviceTrace.matchedWorkloads.length}</strong>
                  </div>
                  <div className="k8s-summary-card">
                    <span className="k8s-summary-card__label">Backing pods</span>
                    <strong className="k8s-summary-card__value">{serviceTrace.matchedPods.length}</strong>
                  </div>
                  <div className="k8s-summary-card">
                    <span className="k8s-summary-card__label">Ingress routes</span>
                    <strong className="k8s-summary-card__value">{serviceTrace.relatedIngresses.length}</strong>
                  </div>
                  <div className="k8s-summary-card">
                    <span className="k8s-summary-card__label">Restart pressure</span>
                    <strong className="k8s-summary-card__value">{serviceTrace.restartPressure}</strong>
                  </div>
                  <div className="k8s-summary-card">
                    <span className="k8s-summary-card__label">Warning signals</span>
                    <strong className="k8s-summary-card__value">
                      {blastRadius.warningEvents.length + blastRadius.warningLogs.length}
                    </strong>
                  </div>
                </div>

                <div className="k8s-detail-grid">
                  <div className="k8s-detail-card">
                    <span className="k8s-detail-card__label">Service</span>
                    <strong className="k8s-detail-card__value">{serviceTrace.service.name}</strong>
                    <span className="k8s-detail-card__meta">{serviceTrace.service.type || 'Service'}</span>
                  </div>
                  <div className="k8s-detail-card">
                    <span className="k8s-detail-card__label">Exposure</span>
                    <strong className="k8s-detail-card__value">{serviceTrace.service.exposure || 'internal'}</strong>
                    <span className={`portal-pill ${statusTone(serviceTrace.service.exposure || 'internal')}`}>
                      {serviceTrace.service.ingress_host || serviceTrace.service.exposure || 'internal'}
                    </span>
                  </div>
                  <div className="k8s-detail-card">
                    <span className="k8s-detail-card__label">Network path</span>
                    <strong className="k8s-detail-card__value">{serviceTrace.service.cluster_ip || 'Address pending'}</strong>
                    <span className="k8s-detail-card__meta">
                      {serviceTrace.service.external_ip || serviceTrace.service.ports || 'Ports pending'}
                    </span>
                  </div>
                  <div className="k8s-detail-card">
                    <span className="k8s-detail-card__label">Namespace</span>
                    <strong className="k8s-detail-card__value">{serviceTrace.service.namespace}</strong>
                    <span className="k8s-detail-card__meta">{serviceTrace.service.cluster_name}</span>
                  </div>
                  <div className="k8s-detail-card">
                    <span className="k8s-detail-card__label">Selector</span>
                    <strong className="k8s-detail-card__value">{serviceTrace.service.selector || 'Missing selector'}</strong>
                    <span className="k8s-detail-card__meta">
                      {serviceTrace.service.noSelector ? 'Ownership is unclear from the selector.' : 'Selector wiring is visible.'}
                    </span>
                  </div>
                  <div className="k8s-detail-card">
                    <span className="k8s-detail-card__label">Next checks</span>
                    <strong className="k8s-detail-card__value">{serviceTrace.service.riskScore > 0 ? 'Attention needed' : 'Stable path'}</strong>
                    <span className="k8s-detail-card__meta">
                      <Link href={namespaceHref}>Namespace workspace</Link> ·{' '}
                      <Link href={buildK8sHref('/k8s/logs', scopeQuery)}>Logs</Link> ·{' '}
                      <Link href={buildK8sHref('/k8s/events', scopeQuery)}>Events</Link>
                    </span>
                  </div>
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Ingress and blast radius</span>
                    <h2 className="portal-surface__title">Edge linkage and operator guidance</h2>
                    <p className="portal-surface__subtitle">
                      This is where we line up ingress reach, peer-service exposure, and runtime pressure before widening the investigation.
                    </p>
                  </div>
                </div>

                <div className="k8s-diagnostic-grid">
                  <div className="k8s-diagnostic-card">
                    <span className="k8s-diagnostic-card__label">Risk score</span>
                    <strong className="k8s-diagnostic-card__value">{serviceTrace.service.riskScore}</strong>
                    <span className="k8s-diagnostic-card__meta">Service exposure and selector pressure rolled into one operator score.</span>
                  </div>
                  <div className="k8s-diagnostic-card">
                    <span className="k8s-diagnostic-card__label">Degraded ingresses</span>
                    <strong className="k8s-diagnostic-card__value">{blastRadius.degradedIngresses.length}</strong>
                    <span className="k8s-diagnostic-card__meta">Ingress routes that still look unstable for this service path.</span>
                  </div>
                  <div className="k8s-diagnostic-card">
                    <span className="k8s-diagnostic-card__label">Risky peer services</span>
                    <strong className="k8s-diagnostic-card__value">{blastRadius.riskyPeers.length}</strong>
                    <span className="k8s-diagnostic-card__meta">Neighbor services in this namespace that carry their own exposure pressure.</span>
                  </div>
                  <div className="k8s-diagnostic-card">
                    <span className="k8s-diagnostic-card__label">Unhealthy pods</span>
                    <strong className="k8s-diagnostic-card__value">{serviceTrace.unhealthyPods.length}</strong>
                    <span className="k8s-diagnostic-card__meta">Pods currently sitting behind the service that need closer runtime review.</span>
                  </div>
                </div>

                <div className="k8s-detail-columns">
                  <div className="k8s-section-stack">
                    <h3 className="k8s-section-stack__title">Recommended next checks</h3>
                    <div className="k8s-trace-list">
                      {blastRadius.guidance.map((item) => (
                        <article key={item} className="k8s-trace-item">
                          <div className="k8s-trace-item__header">
                            <strong className="k8s-trace-item__title">Operator guidance</strong>
                          </div>
                          <p className="k8s-trace-item__meta">{item}</p>
                        </article>
                      ))}
                    </div>
                  </div>

                  <div className="k8s-section-stack">
                    <h3 className="k8s-section-stack__title">Namespace peer services</h3>
                    <div className="k8s-service-chip-list">
                      {serviceTrace.peerServices.slice(0, 6).map((item) => (
                        <Link
                          key={`${item.cluster_name}-${item.namespace}-${item.name}`}
                          href={buildK8sHref(`/k8s/services/${encodeURIComponent(item.name)}`, {
                            project_id: projectId || undefined,
                            cluster_name: item.cluster_name || undefined,
                            namespace: item.namespace || undefined,
                            environment: environment || undefined,
                          })}
                          className="k8s-service-chip"
                        >
                          <strong>{item.name}</strong>
                          <span>{item.type || 'Service'}</span>
                          <span>{item.ingress_host || item.exposure || 'internal'}</span>
                        </Link>
                      ))}
                      {serviceTrace.peerServices.length === 0 ? (
                        <div className="portal-empty">
                          <p>No other peer services are visible in this namespace right now.</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="k8s-route-grid">
                  {serviceTrace.relatedIngresses.map((item) => (
                    <Link
                      key={`${item.cluster_name}-${item.namespace}-${item.name}`}
                      href={buildK8sHref(`/k8s/ingresses/${encodeURIComponent(item.name)}`, {
                        project_id: projectId || undefined,
                        cluster_name: item.cluster_name || undefined,
                        namespace: item.namespace || undefined,
                        environment: environment || undefined,
                      })}
                      className="k8s-route-card"
                    >
                      <div className="k8s-route-card__header">
                        <strong className="k8s-route-card__title">{item.name}</strong>
                        <span className={`portal-pill ${statusTone(item.status || item.certificate_status || '')}`}>
                          {item.status || item.certificate_status || 'Unknown'}
                        </span>
                      </div>
                      <p className="k8s-route-card__meta">{item.host || 'Host pending'} · {item.paths || 'Paths pending'}</p>
                      <div className="k8s-route-card__chips">
                        <span className="portal-pill">{item.exposure || 'internal'}</span>
                        {item.tls_secret ? <span className="portal-pill">{item.tls_secret}</span> : null}
                      </div>
                    </Link>
                  ))}
                  {serviceTrace.relatedIngresses.length === 0 ? (
                    <div className="portal-empty">
                      <p>No ingress objects line up with this service in the current scope.</p>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Runtime backing</span>
                    <h2 className="portal-surface__title">Workloads, pods, and recent signals</h2>
                    <p className="portal-surface__subtitle">
                      We’re tying the service back to the workloads and pods most likely carrying the live traffic path.
                    </p>
                  </div>
                </div>

                <div className="k8s-spotlight-grid">
                  {serviceTrace.matchedWorkloads.map((item) => (
                    <Link
                      key={`${item.cluster_name}-${item.namespace}-${item.name}`}
                      href={buildK8sHref(`/k8s/workloads/${encodeURIComponent(item.name)}/rollout`, {
                        project_id: projectId || undefined,
                        cluster_name: item.cluster_name || undefined,
                        namespace: item.namespace || undefined,
                        environment: environment || undefined,
                      })}
                      className="k8s-spotlight-card"
                    >
                      <div className="k8s-spotlight-card__header">
                        <div>
                          <span className="portal-surface__eyebrow">Matched workload</span>
                          <h3 className="k8s-spotlight-card__title">{item.name}</h3>
                          <p className="k8s-spotlight-card__meta">{item.namespace} · {item.cluster_name}</p>
                        </div>
                        <span className={`portal-pill ${statusTone(item.status)}`}>{item.status || 'Unknown'}</span>
                      </div>
                      <div className="k8s-spotlight-card__metrics">
                        <div>
                          <span>Ready replicas</span>
                          <strong>{item.ready_replicas}/{item.replicas}</strong>
                        </div>
                        <div>
                          <span>Image</span>
                          <strong>{item.image || 'Pending image'}</strong>
                        </div>
                      </div>
                    </Link>
                  ))}
                  {serviceTrace.matchedWorkloads.length === 0 ? (
                    <div className="portal-empty">
                      <p>No workload could be matched to this service from the current selector and naming signals.</p>
                    </div>
                  ) : null}
                </div>

                <div className="k8s-detail-columns">
                  <div className="k8s-section-stack">
                    <h3 className="k8s-section-stack__title">Backing pods</h3>
                    <div className="k8s-service-chip-list">
                      {serviceTrace.matchedPods.map((item) => (
                        <Link
                          key={`${item.cluster_name}-${item.namespace}-${item.name}`}
                          href={buildK8sHref(`/k8s/pods/${encodeURIComponent(item.name)}`, {
                            project_id: projectId || undefined,
                            cluster_name: item.cluster_name || undefined,
                            namespace: item.namespace || undefined,
                            environment: environment || undefined,
                          })}
                          className="k8s-service-chip"
                        >
                          <strong>{item.name}</strong>
                          <span>{item.status || 'Unknown'}</span>
                          <span>Restarts {item.restarts}</span>
                        </Link>
                      ))}
                      {serviceTrace.matchedPods.length === 0 ? (
                        <div className="portal-empty">
                          <p>No pod matches were visible for this service in the current scope.</p>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="k8s-section-stack">
                    <h3 className="k8s-section-stack__title">Recent events</h3>
                    <div className="k8s-trace-list">
                      {serviceTrace.serviceEvents.map((item) => (
                        <article key={item.id} className="k8s-trace-item">
                          <div className="k8s-trace-item__header">
                            <strong className="k8s-trace-item__title">{item.reason || item.resource_name}</strong>
                            <span className={`portal-pill ${statusTone(item.severity)}`}>{item.severity || 'Info'}</span>
                          </div>
                          <p className="k8s-trace-item__meta">
                            {item.resource_kind} · {item.resource_name} · {formatDateTime(item.timestamp)}
                          </p>
                          <div className="k8s-trace-item__issues">
                            <span className="k8s-trace-item__issue">{item.message}</span>
                          </div>
                        </article>
                      ))}
                      {serviceTrace.serviceEvents.length === 0 ? (
                        <div className="portal-empty">
                          <p>No recent events are currently tied to this service path.</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="k8s-section-stack">
                  <h3 className="k8s-section-stack__title">Recent logs</h3>
                  <div className="k8s-trace-list">
                    {serviceTrace.serviceLogs.map((item) => (
                      <article
                        key={`${item.timestamp}-${item.name}-${item.container}`}
                        className="k8s-trace-item"
                      >
                        <div className="k8s-trace-item__header">
                          <strong className="k8s-trace-item__title">{item.name}</strong>
                          <span className={`portal-pill ${statusTone(item.level)}`}>{item.level || 'Info'}</span>
                        </div>
                        <p className="k8s-trace-item__meta">
                          {item.container || 'container'} · {formatDateTime(item.timestamp)}
                        </p>
                        <div className="k8s-trace-item__issues">
                          <span className="k8s-trace-item__issue">{item.message}</span>
                        </div>
                      </article>
                    ))}
                    {serviceTrace.serviceLogs.length === 0 ? (
                      <div className="portal-empty">
                        <p>No recent log signal is currently tied to this service path.</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            </>
          ) : null}
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
