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
  if (normalized === 'healthy' || normalized === 'active' || normalized === 'managed') {
    return 'k8s-data-pill k8s-data-pill--healthy';
  }
  if (normalized === 'warning' || normalized === 'expiring' || normalized === 'pending') {
    return 'k8s-data-pill k8s-data-pill--expiring';
  }
  return 'k8s-data-pill k8s-data-pill--critical';
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

  return (
    <>
      <Head>
        <title>Ingress Detail - DevOps</title>
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

            <section className="k8s-spotlight-card">
              <div className="k8s-spotlight-card__header">
                <div>
                  <span className="portal-surface__eyebrow">Route map</span>
                  <h3 className="portal-surface__title">Ingress routes</h3>
                </div>
              </div>
              <div className="k8s-route-grid">
                {(detail?.routes || []).map((item, index) => (
                  <article key={`${item.host}-${item.path}-${item.service_name}-${index}`} className="k8s-route-card">
                    <div className="k8s-route-card__header">
                      <div className="k8s-route-card__title">{item.host || ingress?.host || 'Wildcard host'}</div>
                      <span className={statusTone(item.certificate_status || ingress?.certificate_status || 'unknown')}>
                        {item.certificate_status || ingress?.certificate_status || 'unknown'}
                      </span>
                    </div>
                    <div className="k8s-route-card__path">{item.path || '/'}</div>
                    <div className="k8s-route-card__meta">
                      <span>{item.service_name || 'No service mapping'}</span>
                      <span>{item.service_type || 'service'}</span>
                      <span>{item.target_address || 'no target address'}</span>
                      <span>{item.exposure || ingress?.exposure || 'internal'}</span>
                    </div>
                  </article>
                ))}
                {!loading && (detail?.routes.length || 0) === 0 ? (
                  <div className="portal-empty">
                    <p>No ingress routes are recorded yet.</p>
                  </div>
                ) : null}
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
