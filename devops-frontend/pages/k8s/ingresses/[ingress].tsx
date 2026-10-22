import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import K8sWorkspaceShell from '../../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../../context/ApiUrlContext';
import {
  buildK8sHref,
  fetchK8sIngressDetail,
  formatDateTime,
  K8sIngressDetailData,
  readQueryString,
} from '../../../lib/k8sWorkspace';

function statusTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'healthy' || normalized === 'active' || normalized === 'managed' || normalized === 'internal' || normalized === 'cluster') {
    return 'k8s-data-pill k8s-data-pill--healthy';
  }
  if (normalized === 'external' || normalized === 'public') {
    return 'k8s-data-pill k8s-data-pill--normal';
  }
  if (normalized === 'warning' || normalized === 'expiring' || normalized === 'pending') {
    return 'k8s-data-pill k8s-data-pill--expiring';
  }
  return 'k8s-data-pill k8s-data-pill--critical';
}

function certificateCoversHost(hosts: string, host: string) {
  const normalizedHost = host.trim().toLowerCase();
  if (!normalizedHost) return false;
  return hosts
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === normalizedHost) return true;
      if (entry.startsWith('*.')) {
        const suffix = entry.slice(1);
        return normalizedHost.endsWith(suffix);
      }
      return false;
    });
}

export default function DevOpsK8sIngressDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [detail, setDetail] = useState<K8sIngressDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectId, setProjectId] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [environment, setEnvironment] = useState('');
  const [ingressName, setIngressName] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    setProjectId(readQueryString(router.query.project_id));
    setClusterName(readQueryString(router.query.cluster_name));
    setNamespace(readQueryString(router.query.namespace));
    setEnvironment(readQueryString(router.query.environment));
    setIngressName(readQueryString(router.query.ingress_name) || readQueryString(router.query.ingress));
  }, [
    router.isReady,
    router.query.cluster_name,
    router.query.environment,
    router.query.ingress,
    router.query.ingress_name,
    router.query.namespace,
    router.query.project_id,
  ]);

  useEffect(() => {
    if (!router.isReady || !ingressName) return;
    let active = true;
    setLoading(true);
    setError('');

    fetchK8sIngressDetail(apiUrl, {
      project_id: projectId || undefined,
      cluster_name: clusterName || undefined,
      namespace: namespace || undefined,
      environment: environment || undefined,
      ingress_name: ingressName,
    })
      .then((payload) => {
        if (!active) return;
        setDetail(payload);
      })
      .catch((err) => {
        if (!active) return;
        setDetail(null);
        setError(err instanceof Error ? err.message : 'Failed to load ingress detail');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [apiUrl, clusterName, environment, ingressName, namespace, projectId, refreshKey, router.isReady]);

  const ingress = detail?.ingress;
  const scopeProjectId = projectId || String(detail?.selected_project_id || '');
  const scopeCluster = clusterName || ingress?.cluster_name || '';
  const scopeNamespace = namespace || ingress?.namespace || '';
  const summary = useMemo(
    () => ({
      routes: detail?.routes.length || 0,
      services: detail?.services.length || 0,
      certificates: detail?.certificates.length || 0,
      events: detail?.recent_events.length || 0,
    }),
    [detail],
  );
  const routeTrace = useMemo(() => {
    const routes = detail?.routes || [];
    const services = detail?.services || [];
    const certificates = detail?.certificates || [];
    const primarySecret = detail?.secret?.name || ingress?.tls_secret || '';
    return routes.map((route) => {
      const matchedService = services.find((service) => service.name === route.service_name) || null;
      const hasTlsCoverage = route.host
        ? certificates.some((certificate) => certificateCoversHost(certificate.hosts, route.host))
        : certificates.length > 0;
      const secretAligned =
        !route.tls_secret ||
        route.tls_secret === primarySecret ||
        certificates.some((certificate) => certificate.secret_name === route.tls_secret);
      const issues: string[] = [];
      if (!route.service_name) issues.push('No backend service is mapped to this route.');
      if (route.service_name && !matchedService) issues.push('The mapped backend service is not visible in the current scope.');
      if (!route.target_address) issues.push('No resolved service address is available for this route.');
      if (route.host && certificates.length > 0 && !hasTlsCoverage) issues.push('The host is not covered by the current TLS certificates.');
      if (route.tls_secret && !secretAligned) issues.push('The route TLS secret does not line up with the ingress TLS attachments.');
      if (['critical', 'expired', 'error'].includes(route.certificate_status.trim().toLowerCase())) {
        issues.push('The certificate status for this route is degraded.');
      }
      return {
        route,
        matchedService,
        hasTlsCoverage,
        issues,
        status: issues.length === 0 ? 'healthy' : issues.length >= 3 ? 'critical' : 'warning',
      };
    });
  }, [detail, ingress?.tls_secret]);
  const diagnostics = useMemo(() => {
    const warningEvents = (detail?.recent_events || []).filter((item) => item.severity.trim().toLowerCase() === 'warning').length;
    const degradedCertificates = (detail?.certificates || []).filter((item) =>
      ['warning', 'expiring', 'critical', 'expired', 'error'].includes(item.status.trim().toLowerCase()),
    ).length;
    const missingBackends = routeTrace.filter((item) =>
      item.issues.some((issue) => issue.includes('backend service') || issue.includes('mapped backend service')),
    ).length;
    const uncoveredHosts = routeTrace.filter((item) => item.route.host && !item.hasTlsCoverage).length;
    const targetGaps = routeTrace.filter((item) => item.issues.some((issue) => issue.includes('resolved service address'))).length;
    return {
      warningEvents,
      degradedCertificates,
      missingBackends,
      uncoveredHosts,
      targetGaps,
      tracedRoutes: routeTrace.length,
    };
  }, [detail, routeTrace]);
  const guidance = useMemo(() => {
    const items: string[] = [];
    if (diagnostics.missingBackends > 0) {
      items.push('At least one ingress path does not have a visible backend service, so start with the route trace before chasing pod or rollout issues.');
    }
    if (diagnostics.uncoveredHosts > 0 || diagnostics.degradedCertificates > 0) {
      items.push('TLS coverage is incomplete or degraded for part of this ingress. Validate the certificate attachments before assuming the backend is the source of failure.');
    }
    if (diagnostics.targetGaps > 0) {
      items.push('One or more routes do not resolve to a target address, which usually points to service selector drift or missing endpoints.');
    }
    if (diagnostics.warningEvents > 0) {
      items.push('Recent ingress warning events are active. Use the event trail to confirm whether the edge problem is config, cert, or target related.');
    }
    if (items.length === 0) {
      items.push('The ingress edge looks well formed right now. Use the route trace to confirm path-to-service alignment before moving deeper into workloads.');
    }
    return items;
  }, [diagnostics]);
  const serviceBlastRadius = useMemo(() => {
    const serviceMap = new Map<
      string,
      {
        serviceName: string;
        namespace: string;
        routeCount: number;
        unresolvedRoutes: number;
        tlsRiskCount: number;
        selectorGap: boolean;
        exposure: string;
        ingressHosts: string[];
      }
    >();

    routeTrace.forEach((trace) => {
      const serviceName = trace.route.service_name || trace.matchedService?.name || 'Unmapped backend';
      const namespaceKey = trace.matchedService?.namespace || scopeNamespace || ingress?.namespace || 'default';
      const key = `${namespaceKey}:${serviceName}`;
      const summary = serviceMap.get(key) || {
        serviceName,
        namespace: namespaceKey,
        routeCount: 0,
        unresolvedRoutes: 0,
        tlsRiskCount: 0,
        selectorGap: trace.matchedService ? trace.matchedService.selector.trim() === '' : true,
        exposure: trace.matchedService?.exposure || trace.route.exposure || ingress?.exposure || 'internal',
        ingressHosts: [],
      };

      summary.routeCount += 1;
      summary.unresolvedRoutes += trace.issues.some((issue) => issue.includes('resolved service address')) ? 1 : 0;
      summary.tlsRiskCount +=
        trace.issues.some(
          (issue) =>
            issue.includes('TLS') ||
            issue.includes('certificate') ||
            issue.includes('host is not covered'),
        )
          ? 1
          : 0;
      if (trace.route.host) {
        summary.ingressHosts.push(trace.route.host);
      }
      serviceMap.set(key, summary);
    });

    const impactedServices = [...serviceMap.values()]
      .map((item) => ({
        ...item,
        ingressHosts: [...new Set(item.ingressHosts)].slice(0, 3),
        pressureScore:
          item.routeCount * 2 + item.unresolvedRoutes * 3 + item.tlsRiskCount * 2 + (item.selectorGap ? 2 : 0),
      }))
      .sort((left, right) => {
        if (right.pressureScore !== left.pressureScore) {
          return right.pressureScore - left.pressureScore;
        }
        return left.serviceName.localeCompare(right.serviceName);
      });

    return {
      impactedServices: impactedServices.filter((item) => item.pressureScore > 0).length,
      riskyRoutes: routeTrace.filter((item) => item.status !== 'healthy').length,
      namespaceSpread: new Set(impactedServices.map((item) => item.namespace)).size,
      topServices: impactedServices.filter((item) => item.pressureScore > 0).slice(0, 4),
    };
  }, [ingress?.exposure, ingress?.namespace, routeTrace, scopeNamespace]);

  return (
    <>
      <Head>
        <title>Ingress Detail - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Ingress Detail"
          subtitle="Trace hostnames, routes, services, and TLS material from one ingress surface so we can debug edge traffic without bouncing between pages."
          queryState={{ project_id: projectId, cluster_name: clusterName, namespace, environment }}
          actions={
            <div className="k8s-action-buttons">
              <Link
                className="btn btn-secondary"
                href={buildK8sHref('/k8s/ingresses', {
                  project_id: scopeProjectId || undefined,
                  cluster_name: scopeCluster || undefined,
                  namespace: scopeNamespace || undefined,
                  environment: environment || undefined,
                })}
              >
                Back to ingress
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
                <span className="portal-surface__eyebrow">Traffic drilldown</span>
                <h2 className="portal-surface__title">{ingress?.name || ingressName || 'Ingress detail'}</h2>
                <p className="portal-surface__subtitle">
                  Start at the ingress edge, then walk the route map, backing services, and TLS attachments without losing cluster context.
                </p>
              </div>
            </div>

            <div className="k8s-detail-grid">
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Host</span>
                <span className="k8s-detail-card__value">{ingress?.host || 'No host recorded'}</span>
                <span className="k8s-detail-card__meta">{ingress?.namespace || scopeNamespace || 'default'} namespace</span>
              </div>
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">TLS secret</span>
                <span className="k8s-detail-card__value">{ingress?.tls_secret || detail?.secret?.name || 'No TLS secret'}</span>
                <span className="k8s-detail-card__meta">{detail?.secret?.type || 'unmanaged secret'}</span>
              </div>
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Certificate status</span>
                <div className="k8s-detail-card__value">
                  <span className={statusTone(ingress?.certificate_status || detail?.certificates[0]?.status || 'unknown')}>
                    {ingress?.certificate_status || detail?.certificates[0]?.status || 'Unknown'}
                  </span>
                </div>
                <span className="k8s-detail-card__meta">{detail?.cluster?.cluster_name || scopeCluster || 'No cluster selected'}</span>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Routes</span>
                <strong className="k8s-summary-card__value">{summary.routes}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Services</span>
                <strong className="k8s-summary-card__value">{summary.services}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Certificates</span>
                <strong className="k8s-summary-card__value">{summary.certificates}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Recent events</span>
                <strong className="k8s-summary-card__value">{summary.events}</strong>
              </div>
            </div>

            <div className="k8s-diagnostic-grid">
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Routes traced</span>
                <strong className="k8s-diagnostic-card__value">{diagnostics.tracedRoutes}</strong>
                <span className="k8s-diagnostic-card__meta">End-to-end host and path checks in this ingress scope.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Missing backends</span>
                <strong className="k8s-diagnostic-card__value">{diagnostics.missingBackends}</strong>
                <span className="k8s-diagnostic-card__meta">{diagnostics.targetGaps} route(s) also lack a resolved address.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">TLS risk</span>
                <strong className="k8s-diagnostic-card__value">{diagnostics.degradedCertificates}</strong>
                <span className="k8s-diagnostic-card__meta">{diagnostics.uncoveredHosts} host(s) are not covered by visible TLS material.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Event pressure</span>
                <strong className="k8s-diagnostic-card__value">{diagnostics.warningEvents}</strong>
                <span className="k8s-diagnostic-card__meta">Recent ingress warning event(s) that can explain edge failures.</span>
              </div>
            </div>

            <section className="k8s-spotlight-card">
              <div className="k8s-spotlight-card__header">
                <div>
                  <span className="portal-surface__eyebrow">Route map</span>
                  <h3 className="portal-surface__title">Ingress routes</h3>
                </div>
              </div>
              <div className="k8s-route-grid">
                {routeTrace.map((trace, index) => (
                  <article key={`${trace.route.host}-${trace.route.path}-${trace.route.service_name}-${index}`} className="k8s-route-card">
                    <div className="k8s-route-card__header">
                      <div className="k8s-route-card__title">{trace.route.host || ingress?.host || 'Wildcard host'}</div>
                      <span className={statusTone(trace.status)}>
                        {trace.status}
                      </span>
                    </div>
                    <div className="k8s-route-card__path">{trace.route.path || '/'}</div>
                    <div className="k8s-route-card__meta">
                      <span>{trace.route.service_name || 'No service mapping'}</span>
                      <span>{trace.route.service_type || 'service'}</span>
                      <span>{trace.route.target_address || 'no target address'}</span>
                      <span>{trace.route.exposure || ingress?.exposure || 'internal'}</span>
                    </div>
                    {trace.issues.length > 0 ? (
                      <div className="k8s-trace-item__issues">
                        {trace.issues.map((issue) => (
                          <span key={issue} className="k8s-trace-item__issue">
                            {issue}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
                {!loading && (detail?.routes.length || 0) === 0 ? (
                  <div className="portal-empty">
                    <p>No ingress routes are recorded yet.</p>
                  </div>
                ) : null}
              </div>
            </section>

            <div className="k8s-diagnostic-grid">
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Impacted services</span>
                <strong className="k8s-diagnostic-card__value">{serviceBlastRadius.impactedServices}</strong>
                <span className="k8s-diagnostic-card__meta">Backend services currently carrying route, TLS, or selector pressure from this ingress.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Risky routes</span>
                <strong className="k8s-diagnostic-card__value">{serviceBlastRadius.riskyRoutes}</strong>
                <span className="k8s-diagnostic-card__meta">Ingress paths where the edge path no longer looks fully aligned with the backend.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Namespace spread</span>
                <strong className="k8s-diagnostic-card__value">{serviceBlastRadius.namespaceSpread}</strong>
                <span className="k8s-diagnostic-card__meta">Namespaces touched by the currently impacted backend services.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Top service traces</span>
                <strong className="k8s-diagnostic-card__value">{serviceBlastRadius.topServices.length}</strong>
                <span className="k8s-diagnostic-card__meta">Service blast-radius drilldowns ready for the next hop in the investigation.</span>
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
                    <span className="portal-surface__eyebrow">Failure trace</span>
                    <h3 className="portal-surface__title">Edge to service mapping</h3>
                  </div>
                </div>
                <div className="k8s-trace-list">
                  {routeTrace.length > 0 ? (
                    routeTrace.map((trace, index) => (
                      <div key={`${trace.route.host}-${trace.route.path}-${index}`} className="k8s-trace-item">
                        <div className="k8s-trace-item__header">
                          <div className="k8s-trace-item__title">
                            {(trace.route.host || ingress?.host || 'Wildcard host') + (trace.route.path || '/')}
                          </div>
                          <span className={statusTone(trace.status)}>{trace.status}</span>
                        </div>
                        <p className="k8s-trace-item__meta">
                          {trace.route.service_name || 'No service mapping'} · {trace.matchedService?.type || trace.route.service_type || 'service'} ·{' '}
                          {trace.route.target_address || 'No resolved target'}
                        </p>
                        {trace.issues.length > 0 ? (
                          <div className="k8s-trace-item__issues">
                            {trace.issues.map((issue) => (
                              <span key={issue} className="k8s-trace-item__issue">
                                {issue}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="k8s-guidance-list__item">This route currently has service, address, and TLS coverage aligned.</div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="portal-empty">
                      <p>No route trace is available until ingress paths are discovered.</p>
                    </div>
                  )}
                </div>
              </section>
            </div>

            <section className="k8s-spotlight-card">
              <div className="k8s-spotlight-card__header">
                <div>
                  <span className="portal-surface__eyebrow">Blast radius</span>
                  <h3 className="portal-surface__title">Service drilldown from this ingress</h3>
                </div>
              </div>
              <div className="k8s-trace-list">
                {serviceBlastRadius.topServices.length > 0 ? (
                  serviceBlastRadius.topServices.map((item) => (
                    <article key={`${item.namespace}-${item.serviceName}`} className="k8s-trace-item">
                      <div className="k8s-trace-item__header">
                        <div className="k8s-trace-item__title">{item.serviceName}</div>
                        <span className="portal-pill">Pressure {item.pressureScore}</span>
                      </div>
                      <p className="k8s-trace-item__meta">
                        {item.namespace} · {item.exposure || 'internal'} · {item.routeCount} mapped route(s)
                      </p>
                      <div className="k8s-trace-item__issues">
                        {item.unresolvedRoutes > 0 ? (
                          <span className="k8s-trace-item__issue">{item.unresolvedRoutes} route(s) have no resolved target</span>
                        ) : null}
                        {item.tlsRiskCount > 0 ? (
                          <span className="k8s-trace-item__issue">{item.tlsRiskCount} route(s) carry TLS risk</span>
                        ) : null}
                        {item.selectorGap ? <span className="k8s-trace-item__issue">Selector gap needs service ownership review</span> : null}
                        {item.ingressHosts.map((host) => (
                          <span key={`${item.serviceName}-${host}`} className="k8s-trace-item__issue">
                            Host {host}
                          </span>
                        ))}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="portal-empty">
                    <p>No backend blast-radius hotspots are visible for this ingress right now.</p>
                  </div>
                )}
              </div>
            </section>

            <div className="k8s-spotlight-grid">
              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Services</span>
                    <h3 className="portal-surface__title">Matched backends</h3>
                  </div>
                </div>
                {(detail?.services || []).length > 0 ? (
                  detail!.services.map((item) => (
                    <div key={`${item.cluster_name}-${item.namespace}-${item.name}`} className="k8s-feed__item">
                      <div className="k8s-feed__header">
                        <div className="k8s-feed__title">{item.name}</div>
                        <span className={statusTone(item.exposure || 'internal')}>{item.exposure || 'internal'}</span>
                      </div>
                      <p className="k8s-feed__message">
                        {item.type} · {item.ports || 'No ports'} · {item.external_ip || item.cluster_ip || 'No address'}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="portal-empty">
                    <p>No related services are visible for this ingress.</p>
                  </div>
                )}
              </section>

              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Certificates</span>
                    <h3 className="portal-surface__title">TLS attachments</h3>
                  </div>
                </div>
                {(detail?.certificates || []).length > 0 ? (
                  detail!.certificates.map((item) => (
                    <div key={`${item.cluster_name}-${item.namespace}-${item.name}`} className="k8s-feed__item">
                      <div className="k8s-feed__header">
                        <div className="k8s-feed__title">{item.name}</div>
                        <span className={statusTone(item.status)}>{item.status}</span>
                      </div>
                      <p className="k8s-feed__message">
                        {item.secret_name} · {item.hosts || 'No hosts'} · expires {item.expires_at || 'unknown'}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="portal-empty">
                    <p>No TLS certificates are linked to this ingress yet.</p>
                  </div>
                )}
              </section>

              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Recent events</span>
                    <h3 className="portal-surface__title">Ingress event trail</h3>
                  </div>
                </div>
                {(detail?.recent_events || []).length > 0 ? (
                  detail!.recent_events.map((item) => (
                    <div key={item.id || `${item.reason}-${item.timestamp}`} className="k8s-log-feed__item">
                      <div className="k8s-log-feed__meta">
                        <span className={statusTone(item.severity)}>{item.severity}</span>
                        <span>{item.reason}</span>
                        <span>{formatDateTime(item.timestamp)}</span>
                      </div>
                      <div className="k8s-log-feed__message">{item.message}</div>
                    </div>
                  ))
                ) : (
                  <div className="portal-empty">
                    <p>No ingress-specific events are available yet.</p>
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
